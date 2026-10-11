"""Saved machine outcome export is bounded, historical and never a grant."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from scripts.export_private_attempt_readiness import build_snapshot, main, SOURCE

class ReadinessExportTests(unittest.TestCase):
    def setUp(self):
        # This fixture is a checked redacted saved observation. It contains no
        # installed module, raw body, private path, role or executable identity.
        self.value=json.loads((Path(__file__).resolve().parents[1]/'fixtures/private_readiness_observation_minimal.json').read_bytes())

    def test_whitelist_preserves_observed_and_pending_meanings_without_private_fields(self):
        out=build_snapshot(self.value)
        self.assertEqual(out['state'],'held');self.assertIs(out['liveStatus'],False)
        self.assertEqual(len(out['checks']),5);self.assertEqual(out['copyScope'],'owner_context_pending')
        self.assertIs(out['collectionPermissionIssued'],False)
        text=json.dumps(out)
        self.assertNotIn('runId',text);self.assertNotIn('ageSeconds',text)
        self.assertNotIn('rclone',text);self.assertNotIn('finishedAt',text)

    def test_grants_boolean_counts_unsupported_state_and_extra_fields_are_refused(self):
        for key,value in (('machinePermissionIssued',True),('publicationEnabled',True),
            ('sourceRequests',False),('acceptedRetentionDays',30.0),('state','ready'),
            ('pointInTimeOnly',False),('privatePath','private-canary')):
            bad={**self.value,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):build_snapshot(bad)

    def test_stale_future_inconsistent_age_and_recorded_privacy_canary_are_refused(self):
        for key,value in (('finishedAt','2026-10-01T06:15:00.914065+00:00'),
            ('finishedAt','2026-10-02T07:15:00.914065+00:00'),('ageSeconds',True),
            ('ageSeconds',float('nan')),('activeAttemptsRemaining',False),('privatePath','canary')):
            bad=deepcopy(self.value);bad['checks']['cleanupHistory'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):build_snapshot(bad)

    def test_held_health_and_folder_can_be_shown_without_claiming_a_success(self):
        bad=deepcopy(self.value)
        bad['checks']['cleanupHistory']={'state':'held','reason':'cleanup_records_unavailable_or_inconsistent'}
        bad['checks']['selectedRawFolder']={'state':'held','reason':'selected_folder_requires_reconciliation','empty':False,'rawFilesRead':False}
        out=build_snapshot(bad)
        self.assertEqual([x['state'] for x in out['checks']][-2:],['held','held'])
        self.assertIs(out['collectionPermissionIssued'],False)

    def test_unit_overrides_copy_proof_and_inconsistent_empty_folder_are_refused(self):
        cases=(('cleanupManager','state','observed'),('cleanupManager','reason','other'),
            ('configuredCopies','allCopyPathsVerified',True),('selectedRawFolder','rawFilesRead',True),
            ('selectedRawFolder','empty',False))
        for group,key,value in cases[1:]:
            bad=deepcopy(self.value);bad['checks'][group][key]=value
            with self.subTest(group=group,key=key),self.assertRaises(ValueError):build_snapshot(bad)
        bad=deepcopy(self.value);bad['checks']['cleanupManager']['canary']='other'
        with self.assertRaises(ValueError):build_snapshot(bad)

    def test_fixed_entry_refuses_selectors_before_any_source_read(self):
        with patch('scripts.export_private_attempt_readiness.sys.argv',['export','--source','other']), \
                patch.object(Path,'read_bytes') as read,self.assertRaises(ValueError):main()
        read.assert_not_called()

if __name__=='__main__':unittest.main()
