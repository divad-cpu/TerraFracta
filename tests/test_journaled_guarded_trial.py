"""Configuration refusal before an invented native fixture can be touched."""
import unittest
from unittest.mock import patch

from scripts import run_private_custodian_trial as trial
from scripts import run_authenticated_ssb_pair_capture as capture
from scripts.check_journaled_guarded_trial_recovery import validated_cases, CASES
import json
import subprocess
import sys


class FixtureGuardReached(RuntimeError):
    pass


class JournaledGuardedTrialTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(trial.sys, 'argv', ['fixed-trial-test']))

    def test_mode_requires_an_exact_boolean_before_trial_lock_or_setup(self):
        with patch.object(trial, 'fixed_trial_guard') as guard:
            for value in (None, 0, 1, 'true'):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    trial.run_fixed_custodian_trial(journaled_guarded=value)
            guard.assert_not_called()

    def test_explicit_legacy_mode_reaches_existing_guard_without_native_setup(self):
        with patch.object(trial, 'fixed_trial_guard', side_effect=FixtureGuardReached):
            with self.assertRaises(FixtureGuardReached):
                trial.run_fixed_custodian_trial(journaled_guarded=False)

    def test_guarded_client_cannot_be_requested_for_another_native_api(self):
        with patch.object(capture, 'command') as command:
            with self.assertRaises(ValueError):
                capture._run_trial('nominal', native_parent_lifetime=True)
            command.assert_not_called()

    def test_native_launch_option_refuses_nonboolean_before_clone_inspection(self):
        with patch.object(capture, 'command') as command:
            for value in (None, 0, 1, 'true'):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    capture._run_trial('nominal', native_parent_lifetime=value)
            command.assert_not_called()

    def test_journal_receipt_loss_is_limited_to_the_new_journaled_mode(self):
        with patch.object(trial, 'fixed_trial_guard') as guard:
            with self.assertRaises(ValueError):
                trial.run_fixed_custodian_trial(fault='journal_finish_receipt_lost')
            guard.assert_not_called()

    def test_new_mode_preserves_retained_store_fault_and_cancellation_exclusions(self):
        with patch.object(trial, 'fixed_trial_guard') as guard:
            for options in ({'transactional_store': True, 'fault': 'journal_finish_receipt_lost'},
                    {'transactional_store': True, 'cancel_before_metadata_read': True}):
                with self.subTest(options=options), self.assertRaises(ValueError):
                    trial.run_fixed_custodian_trial(journaled_guarded=True, **options)
            guard.assert_not_called()

    def test_recovery_refuses_foreign_target_or_reordered_case_before_filesystem_or_clone(self):
        from scripts import check_journaled_guarded_trial_recovery as recovery
        request = {'schemaVersion': 1, 'cases': [{'case': label,
            'privateEvidenceDirectory': '/tmp/foreign-evidence'} for label, _, _ in CASES]}
        with patch.object(recovery, 'private_directory') as directory, patch.object(recovery, 'command') as command:
            with self.assertRaises(ValueError): validated_cases(json.dumps(request).encode())
            request['cases'][0]['case'] = 'owned_cancellation'
            with self.assertRaises(ValueError): validated_cases(json.dumps(request).encode())
            directory.assert_not_called(); command.assert_not_called()

    def test_recovery_refuses_coerced_schema_and_extra_control_fields(self):
        from scripts import check_journaled_guarded_trial_recovery as recovery
        with patch.object(recovery, 'private_directory') as directory, patch.object(recovery, 'command') as command:
            for value in ({'schemaVersion': True, 'cases': []},
                    {'schemaVersion': 1, 'cases': [], 'database': 'postgres'}):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    validated_cases(json.dumps(value).encode())
            directory.assert_not_called(); command.assert_not_called()

    def test_fresh_process_recovery_helper_accepts_its_bounds_and_reaps_the_owned_child(self):
        from scripts import check_journaled_guarded_trial as driver
        actual_popen = subprocess.Popen; owned = []
        def local_child(_command, **options):
            child = actual_popen((sys.executable, '-B', '-E', '-s', '-c',
                'import sys; body=sys.stdin.buffer.read(); sys.stdout.buffer.write(body)'), **options)
            owned.append(child); return child
        with patch.object(driver.subprocess, 'Popen', side_effect=local_child):
            result = driver.reopen_recovery(b'{"fixed":"invented"}')
        self.assertEqual(result.returncode, 0); self.assertEqual(result.stdout, b'{"fixed":"invented"}')
        self.assertEqual(len(owned), 1); self.assertIsNotNone(owned[0].poll())
        self.assertTrue(all(getattr(owned[0], name).closed for name in ('stdin', 'stdout', 'stderr')))

    def test_invalid_recovery_input_refuses_before_any_child_can_start(self):
        from scripts import check_journaled_guarded_trial as driver
        with patch.object(driver.subprocess, 'Popen') as launch:
            for raw in ('{}', b'', b'x'*4097):
                with self.subTest(kind=type(raw).__name__), self.assertRaises(ValueError):
                    driver.reopen_recovery(raw)
            launch.assert_not_called()
