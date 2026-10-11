"""Whitelist consistency and held outcomes; no private/native file is opened."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import unittest

from scripts.export_journaled_guarded_trial_snapshot import build_snapshot


class JournaledGuardedExportTests(unittest.TestCase):
    def setUp(self):
        now = datetime(2026, 10, 4, 5, tzinfo=timezone.utc)
        labels = ('retained_nominal', 'store_receipt_lost', 'journal_finish_receipt_lost', 'owned_cancellation')
        journals = ('pending_held', 'failed_held', 'pending_held', 'interrupted_held')
        states = ('stored_pending_closeout_confirmed', 'stored_pending_closeout_unconfirmed',
            'stored_pending_closeout_confirmed', 'incomplete_before_private_store')
        self.trials = []; self.reads = []; self.journals = []; self.terminals = []
        for index in range(4):
            saved = index < 3; finished = index in (0, 2); stamp = (now+timedelta(seconds=index)).isoformat()
            trial = {'case': labels[index], 'temporaryAccountsRetired': True, 'ownedCloneStopped': True,
                'simulatedHttpTransport': True, 'journaledGuardedMode': True, 'nativeParentLifetimeRequested': True,
                'primaryChanged': False, 'originalHttpModuleExecuted': False, 'actualTlsAcceptance': False,
                'actualSourceRequests': 0, 'retainedStoreTransaction': index == 0,
                'nativeWriteReplayed': False, 'workerTerminalResultAccepted': index == 0,
                'validationState': 'pending', 'runState': 'partial',
                'counts': {'pairs': 1, 'checks': 2, 'bindings': 1, 'versions': 2, 'manifests': 1},
                'state': {'publications': 0}, 'closeoutState': {'closeouts': int(finished),
                    'checkpoints': 0, 'usablePairs': 0, 'publications': 0}}
            self.trials.append(trial)
            self.journals.append({'state': journals[index], 'recordedAt': stamp, 'admissionRecorded': True,
                'finishRecorded': True, 'nativeCleanupConfirmed': True, 'historicalObservationOnly': True,
                'sourcePermissionIssued': False, 'remoteWriteOutcomeVerified': False,
                'automaticRetry': False, 'publicationEnabled': False, 'nativeProcessCalls': (18, 16, 19, 5)[index]})
            self.terminals.append({'backendClosed': True, 'nativeClientClosed': True,
                'nativeParentLifetimeRequested': True, 'journaledGuardedMode': True, 'nativeProcessActive': False,
                'rawBodyOutputRetained': False, 'credentialOutputIncluded': False, 'liveRawRootTouched': False,
                'storeConsumed': saved, 'rawAttempts': int(saved), 'nativeProcessCalls': (18, 16, 19, 5)[index]})
            native = {'state': states[index], 'retainedRawPairs': int(saved), 'rawIntegrityChecked': saved,
                'nativeCloseoutPresent': finished, 'historicalAdmissionOnly': True, 'currentAdmissionIssued': False,
                'sourceOriginVerified': False, 'automaticRetry': False, 'repairPerformed': False,
                'checkpointAdvanced': False, 'publicationEnabled': False}
            self.reads.append({'case': labels[index], 'journalState': journals[index], 'state': states[index],
                'journalRecordedAt': stamp, 'observedAt': (now+timedelta(seconds=5)).isoformat(),
                'nativeSnapshotChecked': True, 'historicalObservationOnly': True, 'rawAccessWithheldByJournal': False,
                'currentAdmissionIssued': False, 'sourceOriginVerified': False, 'automaticRetry': False,
                'repairPerformed': False, 'checkpointAdvanced': False, 'publicationEnabled': False, 'nativeRecovery': native})
        self.integration = {'evidenceKind': 'actual_invented_journaled_guarded_integration',
            'creatingParentGuardTargetsLocalDockerCli': True, 'originalHttpModuleExecuted': False,
            'primaryChanged': False, 'publicationEnabled': False, 'scheduleEnabled': False,
            'remoteRollbackAttested': False, 'actualSourceRequests': 0,
            'observedAt': (now+timedelta(seconds=8)).isoformat(), 'trials': self.trials,
            'recovery': {'evidenceKind': 'actual_fresh_process_journaled_guarded_recovery',
                'observedAt': (now+timedelta(seconds=6)).isoformat(), 'runtimeAccountsStayedRetired': True,
                'ownedCloneStopped': True, 'primaryChanged': False, 'writeReplayed': False,
                'repairPerformed': False, 'publicationEnabled': False, 'localDockerCliGuardProvesRemoteRollback': False,
                'historicalJournalIssuedCurrentPermission': False, 'sourceRequests': 0, 'cases': self.reads}}

    def project(self): return build_snapshot(self.integration, self.journals, self.terminals)

    def test_projection_preserves_unaccepted_finish_reply_despite_durable_pending_journal(self):
        result = self.project(); entry = result['entries'][2]
        self.assertEqual(entry['journalState'], 'pending_held'); self.assertTrue(entry['nativeCloseoutPresent'])
        self.assertFalse(entry['returnedResultAccepted']); self.assertFalse(result['liveStatus'])
        self.assertEqual([x['savedPairs'] for x in result['entries']], [1, 1, 1, 0])

    def test_additional_private_values_are_never_copied_to_projection(self):
        for record in (self.integration, self.trials[0], self.reads[1], self.journals[2], self.terminals[3]):
            record.update(privateEvidenceDirectory='/private-canary', rawBody='private-canary', principal='private-canary')
        encoded = json.dumps(self.project())
        for value in ('private-canary', 'privateEvidenceDirectory', 'rawBody', 'principal', 'nativeProcessCalls'):
            self.assertNotIn(value, encoded)

    def test_live_retry_cleanup_and_readback_claims_are_refused(self):
        for target, key, value in ((self.integration, 'actualSourceRequests', True),
                (self.integration, 'remoteRollbackAttested', True), (self.reads[0], 'currentAdmissionIssued', True),
                (self.journals[1], 'nativeCleanupConfirmed', False), (self.terminals[2], 'nativeProcessActive', True),
                (self.reads[3]['nativeRecovery'], 'retainedRawPairs', 1)):
            original = target[key]; target[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.project()
            target[key] = original

    def test_mixed_chronology_counts_or_missing_case_cannot_appear_checked(self):
        original = deepcopy(self.integration)
        for mutate in (lambda: self.trials[0]['counts'].update(pairs=True),
                lambda: self.reads[1].update(journalRecordedAt='2026-10-04T05:00:00Z'),
                lambda: self.trials.reverse(), lambda: self.trials.pop()):
            mutate()
            with self.assertRaises(ValueError): self.project()
            self.integration = deepcopy(original); self.trials = self.integration['trials']; self.reads = self.integration['recovery']['cases']


if __name__ == '__main__': unittest.main()
