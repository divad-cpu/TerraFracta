"""Custody failures must not promote unknown mutation quiescence/cleanup."""
from contextlib import contextmanager, ExitStack
from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from scripts import supervised_correction_review as supervisor
from tests import test_correction_review_export as fixtures
from workers.bounded_worker_process import WorkerOutput
from workers.invented_review_custody import owned_names


class FakeChannel:
    def settimeout(self,seconds):pass
    def fileno(self):return 18
    def close(self):pass


class OwnedChild:
    def __init__(self):self.stdin=BytesIO();self.stdout=BytesIO();self.stderr=BytesIO();self.returncode=None;self.pid=1971
    def poll(self):return self.returncode
    def kill(self):self.returncode=-9
    def terminate(self):self.returncode=-15
    def wait(self,timeout=None):return self.returncode


class SupervisedCorrectionReviewTests(unittest.TestCase):
    def scenario(self,fault=None):
        fixture=fixtures.PrivateReviewExportTests();fixture.setUp();fixture.receipt['denials']=sorted(fixtures.CURRENT_DENIALS)
        child=OwnedChild();events=[]
        packet={'schemaVersion':1,'evidenceKind':'invented_review_owned_start','suffix':'20261003090000_abcdef','candidateSha256':fixture.pins}
        @contextmanager
        def guard():yield 17
        with TemporaryDirectory() as scratch,ExitStack() as stack:
            base=Path(scratch);native=base/('authenticated-successor-'+packet['suffix']);native.mkdir(mode=0o700)
            stack.enter_context(patch.object(supervisor.successor,'PRIVATE',base))
            stack.enter_context(patch.object(supervisor,'fixed_trial_guard',guard))
            original_id='d'*64
            if fault in ('final_running','final_readback_failure','final_identity_changed','unconfirmed_reap_final_inspection'):
                final=OSError('private-canary') if fault in ('final_readback_failure','unconfirmed_reap_final_inspection') else \
                    {'running':fault=='final_running','id':'e'*64 if fault=='final_identity_changed' else original_id}
                stack.enter_context(patch.object(supervisor,'clone_state',side_effect=[{'running':False,'id':original_id},final]))
            else:stack.enter_context(patch.object(supervisor,'clone_state',return_value={'running':False,'id':original_id}))
            if fault in ('unconfirmed_reap','unconfirmed_reap_final_inspection','barrier_failure'):
                stack.enter_context(patch.object(supervisor,'_end_owned_child',side_effect=ValueError('Unconfirmed owned exit')))
            command=stack.enter_context(patch.object(supervisor.successor,'command',return_value=SimpleNamespace(returncode=0)))
            if fault=='stop_command_failure':command.side_effect=OSError('private-canary')
            barrier=stack.enter_context(patch.object(supervisor,'record_review_inspection_barrier',return_value=True))
            if fault=='barrier_failure':barrier.side_effect=OSError('private-canary')
            stack.enter_context(patch.object(supervisor,'current_candidate_pins',return_value=fixture.pins))
            stack.enter_context(patch.object(supervisor.socket,'socketpair',return_value=(FakeChannel(),FakeChannel())))
            stack.enter_context(patch.object(supervisor.subprocess,'Popen',return_value=child))
            packets=[packet,{'schemaVersion':1,'status':'first_invented_reports_committed'}]
            if fault in ('wrong_stage','unconfirmed_reap','unconfirmed_reap_final_inspection','barrier_failure'):packets[1]['schemaVersion']=True
            stack.enter_context(patch.object(supervisor,'receive_packet',side_effect=packets))
            def send(_channel,value):
                events.append(value['status'])
                if fault=='lost_continuation_ack' and value['status']=='continue_invented_review':raise OSError('private-canary')
            stack.enter_context(patch.object(supervisor,'send_packet',side_effect=send))
            def output(*args,**kwargs):
                self.assertEqual(kwargs,{'timeout':45,'timeout_ceiling':45,'max_stdout':65536,'max_stderr':1024})
                if fault=='worker_failure':child.returncode=1
                elif child.returncode is None:child.returncode=0
                receipt=deepcopy(fixture.receipt)
                if fault=='bad_receipt':receipt['ownedCloneStopped']=False
                return WorkerOutput(json.dumps(receipt).encode(),b'',child.returncode)
            stack.enter_context(patch.object(supervisor,'communicate_bounded',side_effect=output))
            counts={'reports':4,'receipts':4,'events':3,'publications':2,'heads':1}
            def retire(*args,**kwargs):
                events.append('retire_owned')
                self.assertEqual(kwargs,{'expected_clone_id':original_id})
                if fault in ('cleanup_failure','cleanup_inspection_failure'):raise OSError('private-canary')
                return {'rolesObserved':3 if fault=='kill_pause' else 5,'plannedRoles':5,'remainingLogin':0,
                    'counts':{**counts,'events':True} if fault=='boolean_count' else counts}
            stack.enter_context(patch.object(supervisor,'retire_owned_worker',side_effect=retire))
            if fault=='sync_failure':stack.enter_context(patch.object(supervisor,'record_owned_start',side_effect=OSError('private-canary')))
            value=None;held=None
            try:value=supervisor.run_supervised_review(kill_after_first_reports=fault=='kill_pause')
            except supervisor.SupervisedReviewHeld as error:held=error.witness
            proof=next(base.glob('supervised-correction-review-*'))
            saved=json.loads((proof/'SUPERVISED_REVIEW_RESULT.json').read_text())
            command.assert_called_once_with(['docker','stop','--timeout','10',original_id],timeout=20)
            recorded=json.loads((proof/'PREVALIDATED_CLONE.json').read_text())
            self.assertEqual(recorded['clone']['id'],original_id)
            if fault in ('unconfirmed_reap','unconfirmed_reap_final_inspection','barrier_failure'):
                barrier.assert_called_once_with(original_id,1971,proof.name)
            else:barrier.assert_not_called()
            self.assertEqual(saved,held or saved)
            self.assertNotIn('private-canary',json.dumps(saved))
            return {'result':value,'held':held,'saved':saved,'events':events}

    def test_normal_validated_exit_accepts_only_exact_history_and_owned_cleanup(self):
        observed=self.scenario();self.assertIsNone(observed['held'])
        self.assertTrue(observed['result']['custodianRolesRetired'])
        self.assertTrue(observed['saved']['workerQuiescenceVerified'])
        self.assertEqual(observed['events'],['owned_start_recorded','continue_invented_review','retire_owned'])

    def test_own_kill_at_pause_is_held_but_verifies_that_exact_cleanup_boundary(self):
        observed=self.scenario('kill_pause');self.assertIsNone(observed['result'])
        self.assertTrue(observed['held']['workerKilledAfterFirstReports'])
        self.assertTrue(observed['held']['workerQuiescenceVerified'])
        self.assertFalse(observed['held']['continuationAckAttempted'])
        self.assertEqual(observed['events'],['owned_start_recorded','retire_owned'])

    def test_unconfirmed_post_ack_loss_bad_receipt_or_unknown_stage_never_claims_retirement(self):
        for fault in ('worker_failure','bad_receipt','lost_continuation_ack','wrong_stage'):
            with self.subTest(fault=fault):
                observed=self.scenario(fault);self.assertIsNone(observed['result'])
                self.assertNotIn('retire_owned',observed['events'])
                self.assertFalse(observed['held']['workerQuiescenceVerified'])
                self.assertFalse(observed['held']['workerKilledAfterFirstReports'])
                self.assertEqual(observed['held']['cleanup']['state'],'held_for_private_inspection')
        self.assertTrue(self.scenario('lost_continuation_ack')['held']['continuationAckAttempted'])

    def test_failed_sync_never_acknowledges_start_or_claims_durable_ownership(self):
        observed=self.scenario('sync_failure')
        self.assertEqual(observed['events'],[])
        self.assertFalse(observed['held']['ownershipRecordedBeforeStartAck'])
        self.assertFalse(observed['held']['startAckAttempted'])
        self.assertFalse(observed['held']['workerQuiescenceVerified'])

    def test_cleanup_failure_and_coerced_final_counts_preserve_a_held_witness(self):
        for fault in ('cleanup_failure','boolean_count'):
            with self.subTest(fault=fault):
                observed=self.scenario(fault);self.assertIsNone(observed['result'])
                self.assertIsNotNone(observed['held']);self.assertIn('retire_owned',observed['events'])

    def test_unknown_or_running_final_clone_observation_never_becomes_a_stopped_summary(self):
        for fault in ('final_running','final_readback_failure','final_identity_changed'):
            with self.subTest(fault=fault):
                observed=self.scenario(fault)
                self.assertIsNone(observed['result']);self.assertIsNotNone(observed['held'])
                self.assertFalse(observed['held']['ownedCloneStopped'])
                self.assertEqual(observed['held']['failureType'],'OwnedCloneStopUnconfirmed')

    def test_unconfirmed_reap_still_stops_known_owned_clone_without_retirement_acceptance(self):
        observed=self.scenario('unconfirmed_reap')
        self.assertIsNone(observed['result']);self.assertIsNotNone(observed['held'])
        self.assertFalse(observed['held']['childExitConfirmed'])
        self.assertFalse(observed['held']['workerQuiescenceVerified'])
        self.assertTrue(observed['held']['ownedCloneStopped'])
        self.assertNotIn('retire_owned',observed['events'])
        self.assertEqual(observed['held']['cleanup']['state'],'held_for_private_inspection')

    def test_inspection_failure_never_skips_saved_immutable_stop_and_cannot_accept_cleanup(self):
        for fault in ('cleanup_inspection_failure','unconfirmed_reap_final_inspection','stop_command_failure','barrier_failure'):
            with self.subTest(fault=fault):
                observed=self.scenario(fault)
                self.assertIsNone(observed['result']);self.assertIsNotNone(observed['held'])
                self.assertTrue(observed['held']['immutableOwnedStopAttempted'])
                if fault=='unconfirmed_reap_final_inspection':
                    self.assertEqual(observed['held']['inspectionBarrier'],'recorded')
                    self.assertFalse(observed['held']['ownedCloneStopped'])
                elif fault=='barrier_failure':self.assertEqual(observed['held']['inspectionBarrier'],'unconfirmed')

    def test_retirement_identity_mismatch_refuses_before_any_database_or_administrator_action(self):
        fixture=fixtures.PrivateReviewExportTests();fixture.setUp()
        packet={'schemaVersion':1,'evidenceKind':'invented_review_owned_start','suffix':'20261003090000_abcdef','candidateSha256':fixture.pins}
        with patch.object(supervisor,'clone_state',return_value={'running':False,'id':'e'*64}), \
                patch.object(supervisor.successor,'command') as command,patch.object(supervisor.successor,'sensitive_admin') as admin:
            with self.assertRaisesRegex(ValueError,'identity changed'):
                supervisor.retire_owned_worker(packet,fixture.pins,Path('/unselected'),expected_clone_id='d'*64)
            command.assert_not_called();admin.assert_not_called()

    def test_role_retirement_uses_fixed_identity_administrator_and_continues_after_one_refusal(self):
        for failed in (False,True):
            fixture=fixtures.PrivateReviewExportTests();fixture.setUp()
            packet={'schemaVersion':1,'evidenceKind':'invented_review_owned_start','suffix':'20261003090000_abcdef','candidateSha256':fixture.pins}
            _,planned=owned_names(packet['suffix']);roles={role:True for role in planned[:3]};attempts=[];events=[]
            def command(args,*,data=None,**kwargs):
                if args[:2]==['docker','stop']:events.append('stopped')
                output=''
                if data and 'select count(*) from pg_roles' in data:output=str(sum(roles.values()))
                elif data and 'select exists(select 1 from pg_roles' in data:output='t' if any(role in data for role in roles) else 'f'
                elif data and data.startswith('alter role'):raise AssertionError('Ordinary table owner must not administer roles')
                elif data and 'json_build_object' in data:output=json.dumps({'reports':2,'receipts':2,'events':0,'publications':1,'heads':1})
                return SimpleNamespace(returncode=0,stdout=output,stderr='')
            def sensitive(sql):
                role=sql.split()[2];self.assertIn(role,planned);attempts.append(role)
                if failed and role==planned[0]:raise RuntimeError('Invented administration refusal')
                roles[role]=False
            with TemporaryDirectory() as scratch,patch.object(supervisor,'clone_state',return_value={'running':False}), \
                    patch.object(supervisor.successor,'command',side_effect=command), \
                    patch.object(supervisor.successor,'sensitive_admin',side_effect=sensitive):
                if failed:
                    with self.assertRaises(ValueError):supervisor.retire_owned_worker(packet,fixture.pins,Path(scratch))
                    self.assertEqual(sum(roles.values()),1)
                else:
                    cleanup=supervisor.retire_owned_worker(packet,fixture.pins,Path(scratch))
                    self.assertEqual(cleanup['initialLogin'],3);self.assertEqual(cleanup['remainingLogin'],0)
                    self.assertFalse(any(roles.values()))
            self.assertEqual(attempts,list(planned[:3]));self.assertEqual(events,['stopped'])


if __name__=='__main__':unittest.main()
