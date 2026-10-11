"""Private journal crash/acknowledgement faults with invented context only."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tests.frozen_ssb_support import admitted_context
from tests.test_native_pair_admission import admission_fixture
from tests.test_native_client_cleanup_state import UnconfirmedProcess
from workers.bounded_native_client import BoundedNativeClient
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.ssb_14059_raw_custody import PrivateRawCustody
from workers.private_admission_journal import FILENAME, record_private_admission
from workers.private_custodian_journal import (START, FINISH, record_private_custodian_start,
    record_private_custodian_finish, read_private_custodian_journal)


class PrivateCustodianJournalTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name); self.journal = self.base/'journal'; self.journal.mkdir(mode=0o700)
        self.now = datetime(2026, 10, 3, 12, tzinfo=timezone.utc); self.pin = 'a'*64
        self.context, _ = admitted_context(self.pin, now=self.now)
        self.custody = self.enterContext(PrivateRawCustody(self.base/'raw', utc_now=lambda:self.now))
        self.client = BoundedNativeClient(('/bin/false',)); self.addCleanup(self.client.cancel)
        self.backend = PrivatePairNativeBackend(self.client, self.custody, self.context, self.pin, utc_now=lambda:self.now)
        self.admission = json.dumps(admission_fixture(self.context, self.pin, self.now)).encode()

    def start(self):
        return record_private_custodian_start(self.journal, self.pin, self.context, now=self.now)

    def finish(self, start, *, admitted=False, outcome='failed_held', now=None):
        self.client.cancel(); self.backend.closed = True
        return record_private_custodian_finish(self.journal, start, self.admission if admitted else None,
            self.backend, outcome=outcome, now=self.now if now is None else now)

    def test_start_is_private_reopened_and_missing_finish_remains_unknown(self):
        start = self.start(); self.assertEqual((self.journal/START).read_bytes(), start)
        self.assertEqual((self.journal/START).stat().st_mode & 0o777, 0o600)
        read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'outcome_not_recorded'); self.assertIsNone(read['nativeCleanupConfirmed'])
        self.assertFalse(read['finishRecorded']); self.assertFalse(read['automaticRetry'])
        self.assertFalse(self.client.closed); self.assertEqual(self.client.calls, 0)

    def test_finished_before_admission_is_a_held_historical_cleanup_record(self):
        start = self.start(); finish = self.finish(start)
        self.assertEqual((self.journal/FINISH).read_bytes(), finish)
        read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'failed_held'); self.assertTrue(read['nativeCleanupConfirmed'])
        self.assertFalse(read['admissionRecorded']); self.assertTrue(read['historicalObservationOnly'])
        self.assertFalse(read['remoteWriteOutcomeVerified']); self.assertFalse(read['publicationEnabled'])

    def test_admission_and_terminal_hashes_bind_the_exact_saved_start(self):
        start = self.start(); record_private_admission(self.journal, self.admission)
        finish = json.loads(self.finish(start, admitted=True, outcome='pending_held'))
        self.assertEqual(finish['startReceiptSha256'], sha256(start).hexdigest())
        self.assertEqual(finish['admissionReceiptSha256'], sha256(self.admission).hexdigest())
        read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'pending_held'); self.assertTrue(read['admissionRecorded'])

    def test_unknown_owned_cleanup_is_preserved_in_finish_and_does_not_become_pending(self):
        start = self.start(); process = UnconfirmedProcess()
        self.client._active = process; self.client.cancel(); self.backend.closed = True
        with self.assertRaises(ValueError):
            record_private_custodian_finish(self.journal, start, None, self.backend, outcome='pending_held', now=self.now)
        self.assertFalse((self.journal/FINISH).exists())
        self.finish(start)
        read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'local_cleanup_unconfirmed'); self.assertFalse(read['nativeCleanupConfirmed'])
        process.returncode = -9; self.assertTrue(self.client.confirm_cleanup())
        self.assertEqual(read_private_custodian_journal(self.journal)['state'], 'local_cleanup_unconfirmed')

    def test_previous_start_or_any_other_entry_stops_without_overwriting(self):
        start = self.start(); original_inode = (self.journal/START).stat().st_ino
        with self.assertRaises(ValueError): self.start()
        self.assertEqual((self.journal/START).read_bytes(), start)
        self.assertEqual((self.journal/START).stat().st_ino, original_inode)
        (self.journal/'unrelated.log').write_text('preserve')
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)
        self.assertEqual((self.journal/'unrelated.log').read_text(), 'preserve')

    def test_existing_finish_is_not_rewritten_after_later_cleanup_confirmation(self):
        start = self.start(); finish = self.finish(start)
        with self.assertRaises(ValueError): self.finish(start)
        self.assertEqual((self.journal/FINISH).read_bytes(), finish)

    def test_start_fsync_loss_preserves_witness_and_prevents_reuse(self):
        with patch('workers.private_admission_journal.os.fsync', side_effect=OSError('private-fsync-canary')):
            with self.assertRaises(ValueError) as error: self.start()
        self.assertNotIn('canary', str(error.exception)); self.assertTrue((self.journal/START).exists())
        with self.assertRaises(ValueError): self.start()
        self.assertEqual(read_private_custodian_journal(self.journal)['state'], 'outcome_not_recorded')

    def test_finish_fsync_loss_is_not_acceptance_and_keeps_its_bytes(self):
        start = self.start()
        with patch('workers.private_admission_journal.os.fsync', side_effect=OSError('private-fsync-canary')):
            with self.assertRaises(ValueError): self.finish(start)
        saved = (self.journal/FINISH).read_bytes()
        with self.assertRaises(ValueError): self.finish(start)
        self.assertEqual((self.journal/FINISH).read_bytes(), saved)

    def test_changed_start_or_admission_readback_withholds_finish(self):
        start = self.start(); record_private_admission(self.journal, self.admission)
        for name in (START, FILENAME):
            path = self.journal/name; original = path.read_bytes(); path.write_bytes(original+b' ')
            with self.assertRaises(ValueError): self.finish(start, admitted=True)
            self.assertFalse((self.journal/FINISH).exists()); path.write_bytes(original)

    def test_same_source_pin_different_admitted_pair_is_rejected(self):
        start = self.start(); other = json.loads(self.admission); other['pairId'] = '00000000-0000-4000-8000-000000000999'
        raw = json.dumps(other).encode(); record_private_admission(self.journal, raw)
        self.client.cancel(); self.backend.closed = True
        with self.assertRaises(ValueError):
            record_private_custodian_finish(self.journal, start, raw, self.backend, outcome='failed_held', now=self.now)
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)

    def test_earlier_finish_and_admission_substitution_are_refused(self):
        start = self.start(); record_private_admission(self.journal, self.admission)
        with self.assertRaises(ValueError): self.finish(start, admitted=True, now=self.now-timedelta(seconds=1))
        self.assertFalse((self.journal/FINISH).exists())
        self.finish(start, admitted=True)
        value = json.loads((self.journal/FINISH).read_bytes()); value['admissionReceiptSha256'] = 'b'*64
        (self.journal/FINISH).write_text(json.dumps(value))
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)

    def test_symlinks_hardlinks_public_modes_and_oversized_records_are_refused(self):
        start = self.start(); path = self.journal/START
        path.chmod(0o644)
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)
        path.chmod(0o600); os.link(path, self.base/'linked-start')
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)
        (self.base/'linked-start').unlink(); path.write_bytes(b'x'*4097)
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)
        path.write_bytes(start); path.unlink(); path.symlink_to(self.base/'missing')
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)

    def test_open_backend_unknown_fields_duplicate_keys_and_grants_are_refused(self):
        start = self.start()
        with self.assertRaises(ValueError):
            record_private_custodian_finish(self.journal, start, None, self.backend, outcome='failed_held', now=self.now)
        self.finish(start); path = self.journal/FINISH; original = path.read_bytes()
        for mutate in (lambda x:{**x, 'publicationEnabled':True}, lambda x:{**x, 'nativeProcessCalls':True},
                lambda x:{**x, 'nativeCleanupConfirmed':False}, lambda x:{**x, 'error':'private-canary'}):
            path.write_text(json.dumps(mutate(json.loads(original))))
            with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)
        path.write_bytes(original.rstrip()[:-1]+b',"schemaVersion":1}')
        with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)

    def test_late_mutation_of_an_earlier_record_during_last_reopen_is_refused(self):
        start = self.start(); record_private_admission(self.journal, self.admission)
        self.finish(start, admitted=True, outcome='pending_held')
        from workers import private_custodian_journal as journal_module
        original = journal_module.private_read; reads = []
        def changed(path, **options):
            raw = original(path, **options); reads.append(path)
            if len(reads) == 6:
                earlier = reads[3]
                earlier.write_bytes(earlier.read_bytes()+b' ')
            return raw
        with patch.object(journal_module, 'private_read', side_effect=changed):
            with self.assertRaises(ValueError): read_private_custodian_journal(self.journal)

    def test_swapped_journal_directory_cannot_receive_or_acknowledge_finish(self):
        start = self.start(); record_private_admission(self.journal, self.admission)
        self.client.cancel(); self.backend.closed = True
        from workers import private_custodian_journal as journal_module
        original = journal_module._record_private_record; old = self.base/'preserved-old-journal'
        def replaced(directory, filename, raw, **options):
            if filename == FINISH:
                directory.rename(old); directory.mkdir(mode=0o700)
            return original(directory, filename, raw, **options)
        with patch.object(journal_module, '_record_private_record', side_effect=replaced):
            with self.assertRaises(ValueError):
                record_private_custodian_finish(self.journal, start, self.admission, self.backend,
                    outcome='pending_held', now=self.now)
        self.assertEqual((old/START).read_bytes(), start)
        self.assertFalse((self.journal/FINISH).exists())

    def test_start_final_reopen_cannot_acknowledge_an_unsynced_replacement_directory(self):
        from workers import private_admission_journal as writer
        original = writer.private_read; old = self.base/'preserved-start-directory'
        def replaced(path, **options):
            raw = original(path, **options)
            self.journal.rename(old); self.journal.mkdir(mode=0o700)
            target = self.journal/START; target.write_bytes(raw); target.chmod(0o600)
            return raw
        with patch.object(writer, 'private_read', side_effect=replaced):
            with self.assertRaises(ValueError): self.start()
        self.assertTrue((old/START).exists()); self.assertTrue((self.journal/START).exists())


if __name__ == '__main__': unittest.main()
