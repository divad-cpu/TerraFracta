"""Pure guards for a newly owned NOLOGIN privilege laboratory; no native I/O."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from workers.bounded_worker_process import WorkerOutput
from scripts.rehearse_postgres_feed_journal import FeedPgTrialError
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles, ROLES, RUNTIME_FIXTURE, api


def snapshot():
    return {'roles':[{'oid':18000+i,'name':name,'login':False,'super':False,'createdb':False,
        'createrole':False,'inherit':False,'replication':False,'bypass':False,'noPassword':True}
        for i,name in enumerate(sorted(ROLES))], 'memberships':0}


def output(value=None):
    return WorkerOutput(b'' if value is None else json.dumps(value).encode()+b'\n',b'',0)


def trial():
    return SimpleNamespace(query=Mock(return_value=output(snapshot())),record=Mock(),frozen={RUNTIME_FIXTURE:b'-- invented fixed fixture\n'})


class FeedRuntimeRoleScopeTests(unittest.TestCase):
    def setUp(self):self.trial=trial();self.roles=OwnedRuntimeRoles(self.trial)

    def test_unbound_scope_refuses_before_statement(self):
        with self.assertRaises(FeedPgTrialError):self.roles.query('tf_feed_lab_writer','select 1;')
        self.trial.query.assert_not_called()

    def test_only_two_exact_restricted_role_identifiers_are_admitted(self):
        self.roles.bound=snapshot()
        for role in ['postgres','tf_feed_lab_owner','tf_feed_lab_writer;reset role;',None,{},True]:
            with self.assertRaises(FeedPgTrialError):self.roles.query(role,'select 1;')
        self.trial.query.assert_not_called()

    def test_existing_role_refuses_without_install_or_rebind(self):
        with self.assertRaises(FeedPgTrialError):self.roles.install()
        self.assertEqual(self.trial.query.call_count,1)
        self.assertNotIn('create role',self.trial.query.call_args.args[0])
        self.assertIsNone(self.roles.bound)

    def test_absent_then_atomic_frozen_install_binds_exact_native_role_oids(self):
        self.trial.query.side_effect=[output({'roles':None,'memberships':0}),output(),output(snapshot())]
        self.roles.install();self.assertEqual(self.roles.bound,snapshot())
        self.assertIn('-- invented fixed fixture',self.trial.query.call_args_list[1].args[0])
        self.assertTrue(self.trial.query.call_args_list[1].args[0].startswith('begin;'))
        self.assertTrue(self.trial.query.call_args_list[1].args[0].endswith('commit;'))
        with self.assertRaises(FeedPgTrialError):self.roles.install()

    def test_escalated_login_password_membership_and_changed_oid_refuse_before_execution(self):
        self.roles.bound=snapshot()
        changes=[]
        for field,value in [('login',True),('super',True),('createdb',True),('createrole',True),
                            ('inherit',True),('replication',True),('bypass',True),('noPassword',False),
                            ('oid','18000'),('oid',True),('oid',18010),('name','postgres')]:
            changed=snapshot();changed['roles'][0][field]=value;changes.append(changed)
        changes += [{'roles':snapshot()['roles'],'memberships':1}, {'roles':snapshot()['roles'],'memberships':False},
                    {'roles':[],'memberships':0},{'roles':[{},None,{}],'memberships':0}]
        for changed in changes:
            self.trial.query.return_value=output(changed)
            with self.assertRaises(FeedPgTrialError):self.roles.query('tf_feed_lab_writer','select invented_mutation;')
        self.assertTrue(all('invented_mutation' not in call.args[0] for call in self.trial.query.call_args_list))

    def test_role_change_after_request_is_unconfirmed_not_reported_as_rollback(self):
        self.roles.bound=snapshot();changed=deepcopy(snapshot());changed['roles'][0]['oid']+=200
        self.trial.query.side_effect=[output(snapshot()),output({'stored':True}),output(changed)]
        with self.assertRaises(FeedPgTrialError):self.roles.query('tf_feed_lab_writer','select invented_mutation;')
        self.assertIn('invented_mutation',self.trial.query.call_args_list[1].args[0])
        self.assertEqual(self.trial.query.call_count,3)

    def test_fresh_process_simulated_session_authorization_does_not_claim_login_authentication(self):
        self.roles.bound=snapshot()
        self.trial.query.side_effect=[output(snapshot()),output({'stored':True}),output(snapshot())]
        result=self.roles.query('tf_feed_lab_writer','select invented_mutation;',allowed=True)
        actual=self.trial.query.call_args_list[1]
        self.assertEqual(actual.args[0],'set session authorization tf_feed_lab_writer;select invented_mutation;')
        self.assertTrue(actual.kwargs['allowed']);self.assertEqual(result.stdout,output({'stored':True}).stdout)
        self.assertEqual(self.trial.query.call_count,3)

    def test_api_rewrites_outer_generated_identifier_without_modifying_source_literals(self):
        for outer in ('capture','complete_document_result','page_receipt','document_result_receipt'):
            literal = 'select tf_feed_rehearsal.capture('
            original = "begin;select tf_feed_rehearsal."+outer+"('{\"text\":\""+literal+"\"}'::jsonb);commit;"
            actual = api(original)
            self.assertTrue(actual.startswith('begin;select tf_feed_runtime.'+outer+'('))
            self.assertIn(literal,actual)
            self.assertEqual(actual.count('tf_feed_runtime.'),1)
        for bad in [None,{},'select unqualified();']:
            with self.assertRaises(FeedPgTrialError):api(bad)

    def test_input_statement_is_harness_only_not_empty_or_binary(self):
        self.roles.bound=snapshot()
        for value in ['',None,b'select 1;',{}]:
            with self.assertRaises(FeedPgTrialError):self.roles.query('tf_feed_lab_writer',value)
        self.trial.query.assert_not_called()


if __name__=='__main__':unittest.main()
