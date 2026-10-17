"""No resource/target substitution through the private artifact trial helpers."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from scripts import rehearse_private_extraction as module
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles


class PrivateExtractionTrialScopeTests(unittest.TestCase):
    def test_existing_target_argument_refuses_before_resource_construction(self):
        with patch.object(module.sys, 'argv', ['trial', 'existing-target']), patch.object(module, 'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError): module.main()
            make.assert_not_called()

    def test_foreign_installer_or_owner_port_refuses_before_query(self):
        trial=SimpleNamespace(query=Mock()); foreign=SimpleNamespace(query=Mock())
        for roles in (OwnedRuntimeRoles(foreign), SimpleNamespace(trial=trial)):
            with self.assertRaises(module.FeedPgTrialError): module.install_private(trial, roles)
            with self.assertRaises(module.FeedPgTrialError): module.owner_query(trial, roles, 'select 1;')
        trial.query.assert_not_called(); foreign.query.assert_not_called()

    def test_installer_uses_only_frozen_fixture_between_role_checks(self):
        events=[];trial=SimpleNamespace(query=Mock(side_effect=lambda sql:events.append(sql)), frozen={module.FIXTURE:b'-- private\n'})
        roles=OwnedRuntimeRoles(trial); roles.verify=Mock(side_effect=lambda:events.append('verify'))
        module.install_private(trial, roles)
        self.assertEqual(events, ['verify', "begin;set local statement_timeout='10s';-- private\ncommit;", 'verify'])

    def test_failure_still_stops_both_owned_resources_and_checks_sources(self):
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial), \
                patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'), \
                patch.object(module,'freeze_private'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_PRIVATE_EXTRACTION','inspect'])
        self.assertTrue(any(call.args[0]=='PRIVATE_EXTRACTION_FAILED' for call in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
