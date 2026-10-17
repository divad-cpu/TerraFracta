"""New eight-schema recovery entry/fault identity scope; no database execution."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
from scripts import rehearse_detached_proposal_restore as module
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase


class DetachedProposalRestoreScopeTests(unittest.TestCase):
    def test_existing_target_argument_refuses_before_resource_construction(self):
        with patch.object(module.sys,'argv',['trial','existing']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def test_fault_install_and_cleanup_refuse_foreign_or_unbound_targets(self):
        for target in (SimpleNamespace(oid=42,query=Mock()),object.__new__(OwnedRestoreDatabase)):
            if type(target) is OwnedRestoreDatabase:target.oid=None;target.query=Mock()
            with self.assertRaises(module.FeedPgTrialError):module.install_fault(target)
            target.query.assert_not_called()
        target=object.__new__(OwnedRestoreDatabase);target.query=Mock();target.oid=42
        with patch.object(module,'fault_profile',return_value={'changed':True}):
            with self.assertRaises(module.FeedPgTrialError):module.remove_fault(target,{'bound':True})
        target.query.assert_not_called()

    def test_cleanup_only_drops_exact_new_fault_after_identity_check(self):
        target=object.__new__(OwnedRestoreDatabase);target.oid=42;target.query=Mock();events=[]
        expected={'bound':True}
        with patch.object(module,'fault_profile',side_effect=lambda t:events.append(('identity',t)) or expected),patch.object(module,'whole_detached_scope',side_effect=lambda query,**kw:events.append(('empty',kw))):
            module.remove_fault(target,expected)
        self.assertEqual(events,[('identity',target),('empty',{'empty':True})])
        self.assertEqual(target.query.call_args.args[0],'begin;drop event trigger tf_detached_restore_fault;drop function public.tf_detached_restore_fault();commit;')

    def test_case_failure_still_stops_both_owned_resources_and_checks_sources(self):
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=events.append;trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial), \
                patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'), \
                patch.object(module,'freeze_private'),patch.object(module,'freeze_detached'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_DETACHED_RESTORE','inspect'])
        self.assertTrue(any(call.args[0]=='DETACHED_RESTORE_FAILED' for call in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
