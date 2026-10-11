"""Bounded isolation-mode guards; no process, database, file export or source."""
from unittest import TestCase, mock
from scripts import run_authenticated_successor_pipeline as runner

class FictionalWorkflowIsolationTests(TestCase):
    def test_non_boolean_isolation_flag_refuses_before_clone_inspection(self):
        with mock.patch.object(runner, 'command') as command:
            for value in (None, 1, 0, 'true', {}, []):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    runner.trial(isolated_reader=value)
            command.assert_not_called()
