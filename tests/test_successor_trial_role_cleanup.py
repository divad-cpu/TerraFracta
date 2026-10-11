"""Invented lost administration acknowledgments; no database/process operation."""
from contextlib import ExitStack
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts import run_authenticated_successor_pipeline as successor

def failure_trial(mode):
    roles={};retirement_attempts=[];events=[]
    def command(args,*,data=None,**_kwargs):
        if args[:2]==['docker','inspect']:
            return SimpleNamespace(returncode=0,stdout=json.dumps({'image':successor.IMAGE,'labels':{'terrafracta.capture-auth':'20261001'},'running':False,'network':'none','ports':{}}),stderr='')
        if args[:2]==['docker','stop']:events.append('clone_stopped')
        if args[:2]==['docker','start']:
            events.append('clone_start_attempted')
            if mode=='lost_start_ack':raise OSError('Invented lost start acknowledgment')
            if mode=='interrupted_start':raise KeyboardInterrupt('Invented interrupted start')
            if mode=='refused_start':return SimpleNamespace(returncode=1,stdout='',stderr='Invented start refusal')
        output=''
        if data and 'select exists(select 1 from pg_roles' in data:
            output='t' if any(role in data for role in roles) else 'f'
        elif data and 'select count(*) from pg_roles' in data:
            output=str(sum(login for role,login in roles.items() if role in data))
        return SimpleNamespace(returncode=0,stdout=output,stderr='')
    def admin(sql):
        operation=sql.split()[0];role=sql.split()[2]
        if operation=='create':
            if role.startswith('terra_successor_successor_') and mode=='create_failed_before_effect':raise OSError('Invented create refusal')
            roles[role]=True
            if role.startswith('terra_successor_successor_'):raise OSError('Invented lost create acknowledgment')
        else:
            retirement_attempts.append(role)
            if '_first_' in role and mode=='first_retirement_failed':raise OSError('Invented retirement refusal')
            roles[role]=False
    with TemporaryDirectory() as directory,ExitStack() as stack:
        stack.enter_context(patch.object(successor,'PRIVATE',Path(directory)))
        stack.enter_context(patch.object(successor,'command',side_effect=command))
        stack.enter_context(patch.object(successor,'sensitive_admin',side_effect=admin))
        stack.enter_context(patch.object(successor,'private_file'))
        stack.enter_context(patch.object(successor.secrets,'token_urlsafe',return_value='invented-test-only'))
        for name in ('CASES','ROLES','PROOF'):
            stack.enter_context(patch.object(successor.publication,name,getattr(successor.publication,name)))
        error=None
        try:successor.trial()
        except (OSError,RuntimeError,AssertionError,KeyboardInterrupt) as caught:error=type(caught).__name__
    return {'roles':roles,'retirementAttempts':retirement_attempts,'events':events,'exceptionType':error}

class SuccessorRoleCleanupTests(unittest.TestCase):
    def test_start_attempt_is_stopped_after_lost_acknowledgment_or_interruption(self):
        for mode in ('lost_start_ack','interrupted_start','refused_start'):
            with self.subTest(mode=mode):
                result=failure_trial(mode)
                self.assertIsNotNone(result['exceptionType'])
                self.assertEqual(result['roles'],{})
                self.assertEqual(result['retirementAttempts'],[])
                self.assertEqual(result['events'],['clone_start_attempted','clone_stopped'])
    def test_role_created_before_lost_acknowledgment_is_retired(self):
        result=failure_trial('lost_create_ack')
        self.assertIsNotNone(result['exceptionType'])
        self.assertEqual(len(result['roles']),2)
        self.assertFalse(any(result['roles'].values()),result)
        self.assertEqual(len(result['retirementAttempts']),2)
        self.assertIn('clone_stopped',result['events'])
    def test_failed_create_does_not_require_a_nonexistent_account(self):
        result=failure_trial('create_failed_before_effect')
        self.assertFalse(any(result['roles'].values()))
        self.assertEqual(len(result['roles']),1)
        self.assertEqual(len(result['retirementAttempts']),1)
        self.assertIn('clone_stopped',result['events'])
    def test_one_retirement_failure_still_attempts_the_other_owned_role_and_stops(self):
        result=failure_trial('first_retirement_failed')
        self.assertIsNotNone(result['exceptionType'])
        self.assertEqual(len(result['retirementAttempts']),2,result)
        self.assertTrue(next(login for role,login in result['roles'].items() if '_first_' in role))
        self.assertFalse(next(login for role,login in result['roles'].items() if role.startswith('terra_successor_successor_')))
        self.assertIn('clone_stopped',result['events'])

if __name__=='__main__':unittest.main()
