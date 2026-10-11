from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch
from scripts import export_private_parent_snapshot as export
from scripts.ssb_private_parent_inventory import CONTRACT


class PrivateParentExportTests(unittest.TestCase):
    def setUp(self):
        self.path = Path('/private/review/source')
        self.pin = 'a' * 64
        self.checked = {'evidenceKind': 'verified_private_parent_api_source_only', 'files': 85,
            'fingerprint': self.pin, 'sourceRequests': 0, 'candidateModulesImported': False,
            'workerExecuted': False, 'completeRuntimeSealed': False, **CONTRACT}
        self.record = {'evidenceKind': 'unselected_private_parent_api_source_preparation',
            'recordedAt': '2026-10-03T13:18:47.332434+00:00', 'privateSnapshot': str(self.path),
            'originalSourcesRetainedAndUnchanged': True, 'reviewPinDerivedForPreparationOnly': True,
            'independentReviewComplete': False, 'externalBackup': False,
            'verification': deepcopy(self.checked)}
        self.now = datetime(2026, 10, 3, 14, tzinfo=timezone.utc)

    def build(self, record=None, checked=None):
        return export.build_snapshot(self.record if record is None else record,
            self.checked if checked is None else checked, expected_snapshot=self.path,
            expected_pin=self.pin, now=self.now)

    def test_projection_preserves_held_state_without_private_identity(self):
        result = self.build()
        self.assertEqual(result['sourceFiles'], 85)
        self.assertEqual(result['state'], 'held')
        self.assertNotIn(str(self.path), str(result))
        self.assertNotIn(self.pin, str(result))
        self.assertFalse(result['deploymentReviewComplete'])
        self.assertFalse(result['collectionPermissionIssued'])
        self.assertEqual(result['sourceRequests'], 0)

    def test_saved_record_identity_and_claims_cannot_be_substituted(self):
        for key, value in [('privateSnapshot', '/another/source'), ('evidenceKind', 'approved'),
            ('originalSourcesRetainedAndUnchanged', 1), ('reviewPinDerivedForPreparationOnly', 1),
            ('independentReviewComplete', True), ('externalBackup', True), ('extra', 'secret')]:
            with self.subTest(key=key):
                record = deepcopy(self.record); record[key] = value
                with self.assertRaises(ValueError): self.build(record=record)

    def test_checked_context_cannot_issue_grants_or_use_numeric_booleans(self):
        for key in (*[key for key, value in CONTRACT.items() if value is False],
                    'candidateModulesImported', 'workerExecuted', 'completeRuntimeSealed'):
            for value in (True, 0):
                with self.subTest(key=key, value=value):
                    checked = deepcopy(self.checked); checked[key] = value
                    record = deepcopy(self.record); record['verification'] = checked
                    with self.assertRaises(ValueError): self.build(record, checked)

    def test_checked_and_recorded_verifications_must_match_exactly(self):
        for key, value in [('fingerprint', 'b'*64), ('files', True), ('files', 133),
                           ('sourceRequests', False), ('sourceRequests', 1), ('purpose', 'runner'),
                           ('extra', 'private')]:
            with self.subTest(key=key, value=value):
                checked = deepcopy(self.checked); checked[key] = value
                record = deepcopy(self.record); record['verification'] = checked
                with self.assertRaises(ValueError): self.build(record, checked)
        record = deepcopy(self.record); record['verification']['files'] = 84
        with self.assertRaises(ValueError): self.build(record=record)

    def test_real_utc_calendar_and_nonfuture_time_are_required(self):
        for stamp in ('0000-01-01T00:00:00Z', '2026-02-30T00:00:00Z',
            '2026-10-03T14:00:01Z', '2026-10-03T13:00:00+01:00',
            '2026-10-03T13:00:00', '2026-10-03T13:00:00.1234567Z', 0):
            with self.subTest(stamp=stamp):
                record = deepcopy(self.record); record['recordedAt'] = stamp
                with self.assertRaises((ValueError, TypeError)): self.build(record=record)
        record = deepcopy(self.record); record['recordedAt'] = '2026-10-03T13:00:00Z'
        self.assertEqual(self.build(record=record)['recordedAt'], '2026-10-03T13:00:00+00:00')

    def test_extra_arguments_refused_before_any_saved_read(self):
        with patch.object(export.sys, 'argv', ['export', 'selector']), \
                patch.object(export, '_read') as read, patch.object(export, 'verify') as verify:
            with self.assertRaises(ValueError): export.main()
            read.assert_not_called(); verify.assert_not_called()


if __name__ == '__main__': unittest.main()
