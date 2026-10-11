"""Journal-bound read-only recovery; invented native/raw evidence, no SQL."""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from tests.frozen_ssb_support import admitted_context
from tests import test_private_attempt_recovery as recovery_support
from tests.test_native_client_cleanup_state import UnconfirmedProcess
from workers.bounded_native_client import BoundedNativeClient
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.private_admission_journal import record_private_admission
from workers.private_custodian_journal import START, FINISH, record_private_custodian_start, record_private_custodian_finish
from workers.private_attempt_recovery import inspect_journaled_private_attempt_recovery
from workers.ssb_14059_raw_custody import PrivateRawCustody


class JournaledPrivateRecoveryTests(unittest.TestCase):
    def setUp(self):
        helper = recovery_support.PrivateAttemptRecoveryTests(); helper.setUp(); self.addCleanup(helper.doCleanups)
        self.helper = helper; self.journal = Path(helper.temp.name)/'journal'; self.journal.mkdir(mode=0o700)
        self.context, _ = admitted_context('a'*64, now=helper.start)
        self.client = BoundedNativeClient(('/bin/false',)); self.addCleanup(self.client.cancel)
        self.backend = PrivatePairNativeBackend(self.client, helper.custody, self.context, 'a'*64, utc_now=lambda:helper.start)
        self.start_raw = record_private_custodian_start(self.journal, 'a'*64, self.context, now=helper.start)

    def finish(self, *, admitted=True, unknown=False, now=None):
        if admitted: record_private_admission(self.journal, self.helper.admission_raw)
        process = UnconfirmedProcess() if unknown else None
        if process is not None: self.client._active = process
        self.client.cancel(); self.backend.closed = True
        record_private_custodian_finish(self.journal, self.start_raw, self.helper.admission_raw if admitted else None,
            self.backend, outcome='failed_held', now=self.helper.now if now is None else now)
        if process is not None:
            process.returncode = -9; self.assertTrue(self.client.confirm_cleanup())

    def inspect(self, native=True, *, value=None, now=None):
        raw = json.dumps(self.helper.value if value is None else value).encode() if native else None
        return inspect_journaled_private_attempt_recovery(self.journal, raw, self.helper.custody,
            now=self.helper.now if now is None else now)

    def test_missing_finish_suppresses_native_classifier_and_raw_payload_reads(self):
        with patch('workers.private_attempt_recovery.classify_private_attempt_recovery', side_effect=AssertionError('classified')), \
                patch.object(PrivateRawCustody, 'read', side_effect=AssertionError('raw opened')):
            result = self.inspect()
        self.assertEqual(result['state'], 'journal_requires_inspection')
        self.assertEqual(result['journalState'], 'outcome_not_recorded'); self.assertFalse(result['nativeSnapshotChecked'])
        self.assertIsNone(result['nativeRecovery']); self.assertTrue(result['rawAccessWithheldByJournal'])

    def test_saved_unknown_cleanup_remains_held_after_actual_client_state_is_confirmed(self):
        self.finish(unknown=True)
        self.assertTrue(self.client.cleanup_confirmed)
        with patch('workers.private_attempt_recovery.classify_private_attempt_recovery', side_effect=AssertionError('classified')), \
                patch.object(PrivateRawCustody, 'read', side_effect=AssertionError('raw opened')):
            result = self.inspect()
        self.assertEqual(result['journalState'], 'local_cleanup_unconfirmed')
        self.assertEqual(result['state'], 'journal_requires_inspection')

    def test_finish_without_saved_admission_and_missing_snapshot_require_separate_readback(self):
        self.finish(admitted=False)
        self.assertEqual(self.inspect()['state'], 'no_saved_native_admission')
        other = self.journal.parent/'other-journal'; other.mkdir(mode=0o700); self.journal = other
        self.start_raw = record_private_custodian_start(other, 'a'*64, self.context, now=self.helper.start)
        self.finish()
        result = self.inspect(native=False); self.assertEqual(result['state'], 'fresh_native_snapshot_required')
        self.assertFalse(result['nativeSnapshotChecked']); self.assertTrue(result['rawAccessWithheldByJournal'])

    def test_known_local_cleanup_reuses_exact_native_raw_integrity_checks_without_repair(self):
        self.finish(); result = self.inspect()
        self.assertEqual(result['state'], 'stored_pending_closeout_confirmed')
        self.assertEqual(result['journalState'], 'failed_held'); self.assertTrue(result['nativeSnapshotChecked'])
        self.assertTrue(result['nativeRecovery']['rawIntegrityChecked'])
        for key in ('currentAdmissionIssued', 'sourceOriginVerified', 'automaticRetry', 'repairPerformed',
                'checkpointAdvanced', 'publicationEnabled'): self.assertIs(result[key], False)
        output = json.dumps(result)
        for private in (str(self.journal), self.helper.saved.attempt_id, self.helper.admission['runId'], self.helper.admission['principal']):
            self.assertNotIn(private, output)

    def test_stale_or_substituted_native_snapshot_and_snapshot_before_terminal_finish_are_refused(self):
        self.finish()
        for mutate in (lambda x:x.update(observedAt=(self.helper.now-timedelta(seconds=1)).isoformat()),
                lambda x:x.update(pairId='00000000-0000-4000-8000-000000000999'),
                lambda x:x['counts'].update(publications=1)):
            changed = deepcopy(self.helper.value); mutate(changed)
            with self.assertRaises(ValueError): self.inspect(value=changed)
        with self.assertRaises(ValueError): self.inspect(now=self.helper.now+timedelta(seconds=4))

    def test_changed_journal_after_native_raw_classification_withholds_its_result(self):
        self.finish()
        from workers import private_attempt_recovery as recovery
        original = recovery.classify_private_attempt_recovery
        def changed(*args, **options):
            result = original(*args, **options)
            path = self.journal/START; path.write_bytes(path.read_bytes()+b' ')
            return result
        with patch.object(recovery, 'classify_private_attempt_recovery', side_effect=changed):
            with self.assertRaises(ValueError): self.inspect()
        self.assertTrue((self.journal/FINISH).exists()); self.assertEqual(self.helper.custody.attempt_names(), (self.helper.saved.attempt_id,))

    def test_invalid_time_future_history_and_oversized_input_never_gain_a_native_read(self):
        with self.assertRaises(ValueError): self.inspect(now=self.helper.start-timedelta(seconds=1))
        with self.assertRaises(ValueError): self.inspect(now=self.helper.now.replace(tzinfo=None))
        with self.assertRaises(ValueError):
            inspect_journaled_private_attempt_recovery(self.journal, b'x'*32769, self.helper.custody, now=self.helper.now)

    def test_existing_raw_expiry_and_corruption_remain_held_without_rewriting_bytes(self):
        self.finish(); path = self.helper.saved.directory/'data.json'; path.write_bytes(b'{}')
        result = self.inspect(); self.assertEqual(result['state'], 'raw_pair_unavailable')
        self.assertFalse(result['nativeRecovery']['rawIntegrityChecked']); self.assertEqual(path.read_bytes(), b'{}')
        later = self.helper.saved.expires_at; value = deepcopy(self.helper.value); value['observedAt'] = later.isoformat()
        with patch.object(PrivateRawCustody, 'read', side_effect=AssertionError('expired raw opened')):
            result = self.inspect(value=value, now=later)
        self.assertEqual(result['state'], 'expired_access_held'); self.assertTrue(path.exists())


if __name__ == '__main__': unittest.main()
