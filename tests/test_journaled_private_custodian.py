"""Journaled parent finalization seams; no collector, SQL or source starts."""
from datetime import datetime, timezone
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
from workers.private_collector_custodian import CheckedPrivateCollectorResult, run_journaled_private_collector
from workers.private_custodian_journal import START, FINISH, read_private_custodian_journal
from workers.ssb_14059_raw_custody import PrivateRawCustody


class JournaledPrivateCustodianTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name); self.journal = self.base/'journal'; self.journal.mkdir(mode=0o700)
        self.now = datetime(2026, 10, 3, 12, tzinfo=timezone.utc); self.pin = 'a'*64
        self.context, _ = admitted_context(self.pin, now=self.now)
        self.custody = self.enterContext(PrivateRawCustody(self.base/'raw', utc_now=lambda:self.now))
        self.client = BoundedNativeClient(('/bin/false',)); self.addCleanup(self.client.cancel)
        self.backend = PrivatePairNativeBackend(self.client, self.custody, self.context, self.pin, utc_now=lambda:self.now)
        self.admission = json.dumps(admission_fixture(self.context, self.pin, self.now)).encode()
        # This injected result covers wrapper finalization only; it supplies no
        # usable pair, source coverage, SQL store or semantic acceptance.
        self.result = CheckedPrivateCollectorResult(None, {}, {}, 0, 'a'*64, ())

    def collect(self):
        return run_journaled_private_collector(None, self.backend, journal_directory=self.journal, utc_now=lambda:self.now)

    def admitted_body(self, _source, backend, *, on_admitted, **_options):
        self.assertTrue((self.journal/START).exists(), 'Start must be acknowledged before any native admission')
        self.assertFalse((self.journal/FINISH).exists())
        backend.admission_receipt = self.admission
        self.assertEqual(on_admitted(self.admission), self.admission)
        return self.result

    def test_start_admission_and_finish_are_bound_before_result_returns(self):
        with patch('workers.private_collector_custodian._run_owned_private_collector', side_effect=self.admitted_body):
            self.assertIs(self.collect(), self.result)
        read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'pending_held'); self.assertTrue(read['admissionRecorded'])
        self.assertTrue(read['nativeCleanupConfirmed']); self.assertEqual(self.client.calls, 0)

    def test_existing_journal_prevents_native_admission_or_worker_start(self):
        (self.journal/'unrelated').write_text('preserve')
        with patch('workers.private_collector_custodian._run_owned_private_collector') as body:
            with self.assertRaises(ValueError): self.collect()
            body.assert_not_called()
        self.assertEqual((self.journal/'unrelated').read_text(), 'preserve')
        self.assertTrue(self.client.closed); self.assertEqual(self.client.calls, 0)

    def test_start_fsync_loss_stops_before_body_and_keeps_incomplete_start(self):
        with patch('workers.private_admission_journal.os.fsync', side_effect=OSError('private-start-canary')), \
                patch('workers.private_collector_custodian._run_owned_private_collector') as body:
            with self.assertRaises(ValueError) as error: self.collect()
            body.assert_not_called(); self.assertNotIn('canary', str(error.exception))
        self.assertTrue((self.journal/START).exists()); self.assertFalse((self.journal/FINISH).exists())
        self.assertTrue(self.client.closed)

    def test_error_before_admission_records_held_cleanup_without_private_diagnostics(self):
        with patch('workers.private_collector_custodian._run_owned_private_collector', side_effect=OSError('private-body-canary')):
            with self.assertRaises(ValueError) as error: self.collect()
        self.assertNotIn('canary', str(error.exception)); read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'failed_held'); self.assertFalse(read['admissionRecorded'])
        self.assertTrue(read['nativeCleanupConfirmed'])

    def test_interrupt_records_interrupted_state_and_is_not_converted_into_success(self):
        with patch('workers.private_collector_custodian._run_owned_private_collector', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt): self.collect()
        self.assertEqual(read_private_custodian_journal(self.journal)['state'], 'interrupted_held')
        self.assertTrue(self.client.closed); self.assertTrue(self.backend.closed)

    def test_unknown_cleanup_is_durable_and_blocks_result_or_reuse(self):
        process = UnconfirmedProcess()
        def pending_with_unknown(*args, **options):
            result = self.admitted_body(*args, **options); self.client._active = process
            return result
        with patch('workers.private_collector_custodian._run_owned_private_collector', side_effect=pending_with_unknown):
            with self.assertRaisesRegex(RuntimeError, 'cleanup is not confirmed'): self.collect()
        read = read_private_custodian_journal(self.journal)
        self.assertEqual(read['state'], 'local_cleanup_unconfirmed'); self.assertFalse(read['nativeCleanupConfirmed'])
        process.returncode = -9; self.assertTrue(self.client.confirm_cleanup())
        self.assertEqual(read_private_custodian_journal(self.journal), read)
        replacement = BoundedNativeClient(('/bin/false',)); self.addCleanup(replacement.cancel)
        backend = PrivatePairNativeBackend(replacement, self.custody, self.context, self.pin, utc_now=lambda:self.now)
        with patch('workers.private_collector_custodian._run_owned_private_collector') as body:
            with self.assertRaises(ValueError):
                run_journaled_private_collector(None, backend, journal_directory=self.journal, utc_now=lambda:self.now)
            body.assert_not_called()

    def test_finish_acknowledgement_loss_withholds_result_and_preserves_finish(self):
        original = os.fsync; calls = []
        def sync(fd):
            calls.append(fd)
            if len(calls) == 5: raise OSError('private-finish-canary')
            original(fd)
        with patch('workers.private_admission_journal.os.fsync', side_effect=sync), \
                patch('workers.private_collector_custodian._run_owned_private_collector', side_effect=self.admitted_body):
            with self.assertRaises(ValueError) as error: self.collect()
        self.assertNotIn('canary', str(error.exception)); self.assertTrue((self.journal/FINISH).exists())
        self.assertTrue(self.client.closed); self.assertTrue(self.backend.closed)

    def test_unknown_result_type_never_records_pending(self):
        with patch('workers.private_collector_custodian._run_owned_private_collector', return_value='private-canary'):
            with self.assertRaises(ValueError) as error: self.collect()
        self.assertNotIn('canary', str(error.exception))
        self.assertEqual(read_private_custodian_journal(self.journal)['state'], 'failed_held')

    def test_terminal_clock_failure_is_generic_and_keeps_outcome_unrecorded(self):
        calls = []
        def clock():
            calls.append(True)
            if len(calls) == 2: raise RuntimeError('private-terminal-clock-canary')
            return self.now
        with patch('workers.private_collector_custodian._run_owned_private_collector', side_effect=self.admitted_body):
            with self.assertRaises(ValueError) as error:
                run_journaled_private_collector(None, self.backend, journal_directory=self.journal, utc_now=clock)
        self.assertNotIn('canary', str(error.exception)); self.assertTrue(self.client.cleanup_confirmed)
        self.assertEqual(read_private_custodian_journal(self.journal)['state'], 'outcome_not_recorded')


if __name__ == '__main__': unittest.main()
