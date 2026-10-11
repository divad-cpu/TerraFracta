"""Exact v4 operation history; earlier contracts stay historical and unchanged."""
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from workers.invented_operation_journal import (JOURNALED_EXPECTED, JOURNALED_KIND,
    RETAINED_EXPECTED, RETAINED_KIND, HELD, checked_execution,
    run_invented_operation, inspect_invented_operation)


class JournaledOperationJournalTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name); self.now = datetime(2026, 10, 4, 5, tzinfo=timezone.utc)
        self.result = {**JOURNALED_EXPECTED, 'recordedAt': self.now.isoformat()}

    def test_checked_result_reopens_once_and_repeated_starts_cannot_run(self):
        root = self.base/'new'; calls = []
        def run(): calls.append(True); return self.result
        saved = run_invented_operation(root, run, utc_now=lambda:self.now, expected_kind=JOURNALED_KIND)
        self.assertEqual(saved['state'], 'checked'); original = {p.name:p.read_bytes() for p in root.iterdir()}
        self.assertEqual(inspect_invented_operation(root, now=self.now, expected_kind=JOURNALED_KIND), saved)
        self.assertEqual(run_invented_operation(root, run, utc_now=lambda:self.now, expected_kind=JOURNALED_KIND), saved)
        self.assertEqual(calls, [True]); self.assertEqual({p.name:p.read_bytes() for p in root.iterdir()}, original)
        self.assertEqual(inspect_invented_operation(root, now=self.now, expected_kind=RETAINED_KIND), HELD)

    def test_prior_retained_result_cannot_gain_a_journal_claim(self):
        old = self.base/'old'; legacy = {**RETAINED_EXPECTED, 'recordedAt': self.now.isoformat()}
        run_invented_operation(old, lambda:legacy, utc_now=lambda:self.now, expected_kind=RETAINED_KIND)
        original = {p.name:p.read_bytes() for p in old.iterdir()}
        self.assertEqual(inspect_invented_operation(old, now=self.now, expected_kind=JOURNALED_KIND), HELD)
        self.assertEqual(run_invented_operation(old, lambda:self.fail('old attempt restarted'),
            utc_now=lambda:self.now, expected_kind=JOURNALED_KIND), HELD)
        self.assertEqual({p.name:p.read_bytes() for p in old.iterdir()}, original)

    def test_unconfirmed_journal_or_added_private_values_consume_only_one_held_attempt(self):
        for key, value in (('privateJournalRecorded', False), ('nativeCleanupConfirmed', False),
                ('creatingParentGuardRequested', 1), ('remoteRollbackAttested', True), ('rawPath', '/private-canary')):
            result = {**self.result, key:value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                checked_execution(result, expected_kind=JOURNALED_KIND)
        root = self.base/'held'; calls = []
        def fail(): calls.append(True); raise ValueError('private-canary')
        self.assertEqual(run_invented_operation(root, fail, utc_now=lambda:self.now, expected_kind=JOURNALED_KIND), HELD)
        self.assertEqual(run_invented_operation(root, fail, utc_now=lambda:self.now, expected_kind=JOURNALED_KIND), HELD)
        self.assertEqual(calls, [True])


if __name__ == '__main__': unittest.main()
