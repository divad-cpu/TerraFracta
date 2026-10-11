"""Fixed invented account binding and no-argument entrypoint boundaries."""
import sys
import unittest
from unittest.mock import patch
from scripts import check_invented_correction_intake as intake
from scripts import run_retained_custodian_trial as retained
from scripts import run_authenticated_successor_pipeline as successor


class InventedCorrectionBoundaryTests(unittest.TestCase):
    def test_exact_generated_client_matches_only_its_database(self):
        for phase in ('first','successor'):
            role='terra_correction_'+phase+'_20261002180000_abcdef'
            with patch.object(intake,'command',return_value=object()) as command:
                intake.client(role,'invented-secret','terra_successor_20261002180000_abcdef','select 1;')
                args=command.call_args
                self.assertEqual(args.args[0][:4],['docker','exec','-i',intake.TARGET])
                self.assertEqual(args.kwargs,{'data':'invented-secret\nselect 1;','timeout':15})
                self.assertNotIn('invented-secret',str(args.args))
                self.assertIn('PGPASSFILE=/dev/null PGSSLMODE=disable PGCONNECT_TIMEOUT=3',args.args[0][-1])
                self.assertIn('-X -qAt -v ON_ERROR_STOP=1',args.args[0][-1])
    def test_foreign_or_injected_role_database_is_rejected_before_process(self):
        fixed='terra_correction_first_20261002180000_abcdef'
        cases=[('postgres','terra_successor_20261002180000_abcdef'),
            ('terra_correction_first_20261002180000_abcdeg','terra_successor_20261002180000_abcdeg'),
            (fixed+';bad','terra_successor_20261002180000_abcdef'),
            (fixed,'postgres'),(fixed,'terra_successor_20261002180001_abcdef'),
            (fixed,'terra_successor_20261002180000_abcdef;bad')]
        for role,database in cases:
            with self.subTest(role=role,database=database),patch.object(intake,'command') as command:
                with self.assertRaises(ValueError):intake.client(role,'invented',database,'select 1;')
                command.assert_not_called()
    def test_correction_entrypoint_arguments_never_enter_clone_guard(self):
        with patch.object(sys,'argv',['fixed','--source=https://example.org']),patch.object(intake,'fixed_trial_guard') as guard:
            with self.assertRaises(ValueError):intake.main()
            guard.assert_not_called()
    def test_successor_invalid_observer_refuses_before_clone_inspection(self):
        for invalid in (True,{},'arbitrary'):
            with self.subTest(invalid=invalid),patch.object(successor,'command') as command:
                with self.assertRaises(ValueError):successor.trial(projection_observer=invalid)
                command.assert_not_called()
    def test_successor_invalid_cleanup_refuses_before_clone_inspection(self):
        for invalid in (True,{},'arbitrary'):
            with self.subTest(invalid=invalid),patch.object(successor,'command') as command:
                with self.assertRaises(ValueError):successor.trial(trial_cleanup=invalid)
                command.assert_not_called()
    def test_retained_entrypoint_selects_only_the_fixed_opt_in_trial(self):
        with patch.object(retained,'run_fixed_custodian_trial',return_value={'invented':True}) as trial,patch('builtins.print'):
            self.assertEqual(retained.main(),0)
            trial.assert_called_once_with(transactional_store=True)


if __name__=='__main__':unittest.main()
