from copy import deepcopy
from datetime import datetime, timezone
import io
import unittest
from unittest.mock import patch
from scripts import weekly_rehearsal_status as monitor


class WeeklyRehearsalStatusTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 5, 7, 30, tzinfo=timezone.utc)
        self.receipt = {'trigger': 'scheduled', 'scope': 'fictional-country',
            'executedAt': '2026-10-05T06:10:00Z', 'runState': 'completed',
            'coveredSourceKeys': ['fictional-source'], 'fixtureDueAt': '2026-10-05T06:00:00Z'}

    def value(self, receipts=(), **changes):
        return {'schemaVersion': 1, 'readComplete': True, 'totalReceipts': len(receipts),
            'unreadableReceipts': 0, 'pendingReceipts': 0, 'receipts': list(receipts), **changes}

    def check(self, value, now=None): return monitor.classify_inventory(value, now=now or self.now)

    def test_complete_in_time_fixture_window_is_not_live_schedule_or_publication_authority(self):
        result = self.check(self.value([self.receipt]))
        self.assertEqual((result['state'], result['reason'], result['coverage']), ('healthy', 'due_window_completed', 'complete'))
        self.assertEqual(result['windowKey'], '2026-W41')
        self.assertFalse(result['realScheduleEnabled']); self.assertFalse(result['trustedRunLedger'])
        self.assertFalse(result['publicationEnabled']); self.assertEqual(result['sourceRequests'], 0)
        self.assertEqual(result['alertsSent'], 0); self.assertNotIn('receipts', result)

    def test_absence_is_pending_before_due_and_in_grace_then_attention(self):
        for now, state, reason in [(datetime(2026, 10, 5, 5, 55, tzinfo=timezone.utc), 'pending', 'not_due'),
            (datetime(2026, 10, 5, 6, 30, tzinfo=timezone.utc), 'pending', 'within_grace_window'),
            (self.now, 'attention', 'scheduled_run_missing')]:
            result = self.check(self.value(), now)
            self.assertEqual((result['state'], result['reason']), (state, reason))

    def test_manual_catchup_can_cover_the_example_without_hiding_a_missing_weekly_trigger(self):
        receipt = {**self.receipt, 'trigger': 'manual', 'fixtureDueAt': None, 'executedAt': '2026-10-05T07:10:00Z'}
        result = self.check(self.value([receipt]))
        self.assertEqual((result['state'], result['reason'], result['coverage']),
            ('attention', 'scheduled_run_missing_manual_catchup_complete', 'complete'))
        receipt['coveredSourceKeys'] = []
        self.assertEqual(self.check(self.value([receipt]))['coverage'], 'incomplete')

    def test_previous_fixture_week_cannot_mask_or_replace_the_current_week(self):
        previous = {**self.receipt, 'fixtureDueAt': '2026-09-28T06:00:00Z', 'executedAt': '2026-10-05T07:20:00Z'}
        self.assertEqual(self.check(self.value([previous]))['reason'], 'scheduled_run_missing')
        self.assertEqual(self.check(self.value([self.receipt, previous]))['reason'], 'due_window_completed')

    def test_latest_incomplete_substituted_or_late_receipt_never_appears_healthy(self):
        for changes, reason in [({'executedAt': '2026-10-05T07:20:00Z', 'runState': 'partial'}, 'run_not_completed'),
            ({'executedAt': '2026-10-05T06:20:00Z', 'coveredSourceKeys': ['other-source']}, 'due_source_coverage_incomplete'),
            ({'executedAt': '2026-10-05T07:10:00Z'}, 'scheduled_run_late')]:
            with self.subTest(changes=changes):
                result = self.check(self.value([self.receipt, {**self.receipt, **changes}]))
                self.assertEqual(result['state'], 'attention'); self.assertEqual(result['reason'], reason)

    def test_unreadable_pending_or_incomplete_inventory_cannot_establish_coverage(self):
        for changes in ({'readComplete': False}, {'pendingReceipts': 1}, {'totalReceipts': 2, 'unreadableReceipts': 1}):
            result = self.check(self.value([self.receipt], **changes))
            self.assertEqual((result['state'], result['reason'], result['coverage']), ('held', 'history_incomplete', 'unknown'))

    def test_equal_latest_instants_hold_while_microsecond_order_is_preserved(self):
        one = {**self.receipt, 'executedAt': '2026-10-05T06:10:00.123456Z'}
        two = {**one, 'runState': 'partial'}
        self.assertEqual(self.check(self.value([one, two]))['reason'], 'latest_receipt_ambiguous')
        two['executedAt'] = '2026-10-05T06:10:00.123457Z'
        self.assertEqual(self.check(self.value([one, two]))['reason'], 'run_not_completed')

    def test_dst_and_iso_year_transition_use_the_existing_oslo_calendar(self):
        for now, due, key in [(datetime(2026, 10, 19, 9, tzinfo=timezone.utc), '2026-10-19T06:00:00+00:00', '2026-W43'),
            (datetime(2026, 10, 26, 9, tzinfo=timezone.utc), '2026-10-26T07:00:00+00:00', '2026-W44'),
            (datetime(2027, 1, 4, 9, tzinfo=timezone.utc), '2027-01-04T07:00:00+00:00', '2027-W01')]:
            result = self.check(self.value(), now)
            self.assertEqual((result['dueAt'], result['windowKey']), (due, key))

    def test_future_wrong_scope_invalid_dates_and_numeric_metadata_refuse(self):
        for change in ({'executedAt': '2026-10-05T08:00:00Z'}, {'executedAt': '2026-02-30T00:00:00Z'},
            {'fixtureDueAt': '2026-10-06T06:00:00Z'}, {'scope': 'real-country'}, {'coveredSourceKeys': [True]},
            {'fixtureDueAt': None}, {'runState': 'approved'}, {'privatePath': 'private-canary'}):
            with self.subTest(change=change), self.assertRaises(ValueError): self.check(self.value([{**self.receipt, **change}]))
        for change in ({'totalReceipts': True}, {'schemaVersion': True}, {'readComplete': 1}, {'totalReceipts': 101}):
            with self.subTest(change=change), self.assertRaises(ValueError): self.check(self.value([self.receipt], **change))

    def test_cli_rejects_selectors_and_oversized_duplicate_or_nonfinite_input(self):
        with patch.object(monitor.sys, 'argv', ['status', '--scope', 'private-canary']), patch.object(monitor.sys, 'stdin') as stream:
            with self.assertRaises(ValueError): monitor.main()
            stream.buffer.read.assert_not_called()
        for raw in (b'x'*65537, b'{"schemaVersion":1,"schemaVersion":1}', b'{"schemaVersion":NaN}'):
            with patch.object(monitor.sys, 'argv', ['status']), patch.object(monitor.sys, 'stdin', type('Input', (), {'buffer': io.BytesIO(raw)})()), self.assertRaises(ValueError): monitor.main()


if __name__ == '__main__': unittest.main()
