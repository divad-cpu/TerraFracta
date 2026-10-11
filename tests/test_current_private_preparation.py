"""Current observation is read-only, bounded, dated and always collection-held."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from scripts import inspect_current_private_preparation as current


class CurrentPreparationTests(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/private_readiness_observation_minimal.json').read_bytes())
        self.now = datetime.fromisoformat(self.record['observedAt'])

    def test_reuses_full_whitelist_and_does_not_promote_good_checks_to_a_grant(self):
        result = current.build_current_observation(self.record, now=self.now + timedelta(seconds=3))
        self.assertEqual(result['evidenceKind'], 'current_local_preparation_observation')
        self.assertIs(result['pointInTimeOnly'], True)
        self.assertEqual(result['state'], 'held')
        self.assertIs(result['collectionPermissionIssued'], False)
        for private in ('finishedAt', 'ageSeconds', 'rclone', 'privatePath', 'activeAttempts'):
            self.assertNotIn(private, json.dumps(result))

    def test_stale_future_naive_non_utc_and_excess_precision_observations_are_refused(self):
        for now in (self.now - timedelta(microseconds=1), self.now + timedelta(seconds=30, microseconds=1),
                    self.now.replace(tzinfo=None), self.now.astimezone(timezone(timedelta(hours=2)))):
            with self.subTest(now=now), self.assertRaises(ValueError):
                current.build_current_observation(self.record, now=now)
        bad = deepcopy(self.record); bad['observedAt'] = self.record['observedAt'].replace('+00:00', '7+00:00')
        with self.assertRaises(ValueError): current.build_current_observation(bad, now=self.now)

    def test_private_data_unknown_checks_and_permissions_cannot_leave_read_only_entry(self):
        for key, value in (('machinePermissionIssued', True), ('sourceRequests', False),
                           ('privatePath', 'private-canary'), ('contentScheduleEnabled', True)):
            bad = {**self.record, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                current.build_current_observation(bad, now=self.now)

    def test_fixed_main_rejects_selectors_before_observation_and_has_no_evidence_writer(self):
        with patch.object(current.sys, 'argv', ['observer', '--source', 'private-canary']), \
                patch.object(current, 'observe') as observe, patch('sys.stderr', io.StringIO()):
            self.assertEqual(current.main(), 2); observe.assert_not_called()
        with patch.object(current.sys, 'argv', ['observer']), patch.object(current, 'observe', side_effect=OSError('private-canary')), \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(current.main(), 0)
            self.assertEqual(json.loads(output.getvalue()), {'state': 'held', 'reason': 'local_observation_unavailable'})


if __name__ == '__main__': unittest.main()
