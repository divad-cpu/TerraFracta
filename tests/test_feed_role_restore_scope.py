"""Pure restored target/role binding checks; no Docker/login/database action."""
from copy import deepcopy
from unittest.mock import Mock
import unittest
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from scripts.rehearse_feed_role_restore import restored_role_port, default_function_acl
from scripts.rehearse_postgres_feed_journal import FeedPgTrialError
from tests.test_feed_runtime_role_scope import trial, snapshot, output


class FeedRoleRestoreScopeTests(unittest.TestCase):
    def setUp(self):
        self.source=OwnedRuntimeRoles(trial());self.source.bound=snapshot()
        self.target=object.__new__(OwnedRestoreDatabase);self.target.oid=18000;self.target.trial=self.source.trial
        self.target.current=Mock(return_value={'oid':18000});self.target.query=Mock(return_value=output(snapshot()))

    def test_unbound_or_arbitrary_scope_cannot_become_restored_runtime(self):
        for source,target in [(None,self.target),(self.source,None),(OwnedRuntimeRoles(trial()),self.target),
                              (self.source,Mock())]:
            with self.assertRaises(FeedPgTrialError):restored_role_port(source,target)
        self.target.query.assert_not_called()

    def test_other_fresh_cluster_cannot_borrow_same_role_names_and_oids(self):
        self.target.trial=trial()
        with self.assertRaises(FeedPgTrialError):restored_role_port(self.source,self.target)
        self.source.trial.query.assert_not_called();self.target.query.assert_not_called()
        self.target.current.assert_not_called()

    def test_database_oid_requires_positive_exact_integer(self):
        for oid in [None,True,'18000',0,-1]:
            self.target.oid=oid
            with self.assertRaises(FeedPgTrialError):restored_role_port(self.source,self.target)
        self.target.query.assert_not_called()

    def test_changed_source_role_refuses_before_restore_target_query(self):
        changed=snapshot();changed['roles'][0]['oid']+=100
        self.source.trial.query.return_value=output(changed)
        with self.assertRaises(FeedPgTrialError):restored_role_port(self.source,self.target)
        self.target.query.assert_not_called()

    def test_missing_restore_database_refuses_before_role_adoption(self):
        self.target.current.return_value=None
        with self.assertRaises(FeedPgTrialError):restored_role_port(self.source,self.target)
        self.target.query.assert_not_called()

    def test_foreign_role_oid_at_restore_target_cannot_borrow_same_name(self):
        changed=snapshot();changed['roles'][0]['oid']+=100
        self.target.query.return_value=output(changed)
        with self.assertRaises(FeedPgTrialError):restored_role_port(self.source,self.target)
        self.target.query.assert_called_once()

    def test_missing_default_acl_row_cannot_be_misread_as_no_public_execute(self):
        for value in [{'explicitEntries':0,'publicExecute':1},{'explicitEntries':0,'publicExecute':0},
                      {'explicitEntries':True,'publicExecute':0},{'explicitEntries':1,'publicExecute':True},
                      {},{'explicitEntries':1,'publicExecute':0,'extra':True}]:
            with self.assertRaises(FeedPgTrialError):default_function_acl(Mock(return_value=output(value)))
        self.assertEqual(default_function_acl(Mock(return_value=output({'explicitEntries':1,'publicExecute':0}))),
                         {'explicitEntries':1,'publicExecute':0})

    def test_valid_restored_scope_copies_role_binding_and_uses_existing_owned_db_port(self):
        restored=restored_role_port(self.source,self.target)
        self.assertIs(restored.trial,self.target);self.assertEqual(restored.bound,self.source.bound)
        self.assertIsNot(restored.bound,self.source.bound)
        self.assertIsNot(restored.bound['roles'],self.source.bound['roles'])
        self.source.bound['roles'][0]['oid']+=100
        self.assertEqual(restored.bound,snapshot())


if __name__=='__main__':unittest.main()
