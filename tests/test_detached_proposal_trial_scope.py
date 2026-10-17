"""Fixed preparation rehearsal boundaries; no native resources constructed."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
from scripts import rehearse_detached_proposal as module
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles


class DetachedProposalTrialScopeTests(unittest.TestCase):
    def test_existing_target_argument_refuses_before_resource_construction(self):
        with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def test_foreign_installer_refuses_before_role_checks_and_query(self):
        trial=SimpleNamespace(query=Mock());foreign=SimpleNamespace(query=Mock())
        for roles in (OwnedRuntimeRoles(foreign),SimpleNamespace(trial=trial)):
            with self.assertRaises(module.FeedPgTrialError):module.install_detached(trial,roles)
        trial.query.assert_not_called();foreign.query.assert_not_called()

    def test_installer_only_uses_frozen_fixture_between_identity_checks(self):
        events=[];trial=SimpleNamespace(query=Mock(side_effect=events.append),frozen={module.FIXTURE:b'-- invented\n'})
        roles=OwnedRuntimeRoles(trial);roles.verify=Mock(side_effect=lambda:events.append('verify'))
        module.install_detached(trial,roles)
        self.assertEqual(events,['verify',"begin;set local statement_timeout='10s';-- invented\ncommit;",'verify'])

    def test_failed_cases_still_stop_owned_resources_and_verify_sources(self):
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=events.append;trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial), \
                patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'), \
                patch.object(module,'freeze_private'),patch.object(module,'freeze_detached'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_DETACHED_PREPARATION','inspect'])
        self.assertTrue(any(call.args[0]=='DETACHED_PREPARATION_FAILED' for call in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
