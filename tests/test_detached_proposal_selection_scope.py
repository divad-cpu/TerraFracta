"""Preparation reader rehearsal cannot select a target or leak owned resources."""
import unittest
from unittest.mock import Mock,patch
from scripts import rehearse_detached_proposal_selection as module


class DetachedProposalSelectionScopeTests(unittest.TestCase):
    def test_target_override_refuses_before_construction(self):
        with patch.object(module.sys,'argv',['trial','existing']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def test_freeze_failure_prevents_create_and_still_checks_owned_cleanup(self):
        trial=Mock();trial.identity=None;events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer');trial.verify_sources.side_effect=events.append
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial), \
                patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'), \
                patch.object(module,'freeze_private'),patch.object(module,'freeze_detached',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        trial.create.assert_not_called();self.assertEqual(events,['stop','initializer','FINAL_DETACHED_SELECTION'])

    def test_case_failure_checks_both_owned_stops_and_final_source_binding(self):
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=events.append;trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial), \
                patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'), \
                patch.object(module,'freeze_private'),patch.object(module,'freeze_detached'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_DETACHED_SELECTION','inspect'])

if __name__=='__main__':unittest.main()
