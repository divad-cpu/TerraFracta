"""Alive fixed manual custodian for one invented native review worker.

Holds the existing trial exclusion while the child borrows its inherited lock.
Owns/reaps that child; exact planned identities are fsynced before start ACK.
Worker death is not custodian death: guardian/power loss still needs inspection.
No web dispatch, restart, real source or primary database operation exists here.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
import re
import secrets
import socket
import signal
import subprocess
import sys

from scripts import run_authenticated_successor_pipeline as successor
from scripts.captured_fictional_pipeline import private_file, ROOT
from scripts.check_private_attempt_readiness import private_directory, private_read
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard,record_review_inspection_barrier
from workers.invented_operation_journal import _root,_write
from scripts.rehearse_correction_review_display import current_candidate_pins, build_execution_result
from workers.bounded_worker_process import communicate_bounded
from workers.closed_pair_channel import _json
from workers.invented_review_custody import checked_start, owned_names, record_owned_start, send_packet, receive_packet, exact_packet


class SupervisedReviewHeld(ValueError):
    def __init__(self,witness):
        super().__init__('Fixed supervised review is held');self.witness=witness


def clone_state():
    result=successor.command(['docker','inspect','--format',
        '{"id":{{json .Id}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}',successor.TARGET],timeout=10)
    if result.returncode:raise ValueError('Fixed custodian target unavailable')
    meta=_json(result.stdout.encode())
    if set(meta)!={'id','image','labels','running','network','ports'} or type(meta['running']) is not bool \
            or type(meta['id']) is not str or re.fullmatch('[0-9a-f]{64}',meta['id']) is None \
            or {key:value for key,value in meta.items() if key not in ('running','id')} \
                !={'image':successor.IMAGE,'labels':{'terrafracta.capture-auth':'20261001'},'network':'none','ports':{}}:
        raise ValueError('Fixed custodian target differs')
    return meta


def child_environment():
    return {key:os.environ[key] for key in ('PATH','HOME') if key in os.environ} | {'PYTHONDONTWRITEBYTECODE':'1'}


def stop_prevalidated_clone(container_id):
    if type(container_id) is not str or re.fullmatch('[0-9a-f]{64}',container_id) is None:
        raise ValueError('Fixed prevalidated clone identity differs')
    # The immutable ID comes from the validated pre-launch observation, not
    # a child/request selector. An inspection outage cannot skip this STOP.
    stopped=successor.command(['docker','stop','--timeout','10',container_id],timeout=20)
    if stopped.returncode:raise ValueError('Fixed prevalidated clone STOP unconfirmed')


def retire_owned_worker(packet,pins,proof,*,expected_clone_id=None):
    checked_start(packet,pins);database,roles=owned_names(packet['suffix'])
    state=clone_state();attempted=False;retired=[];counter=0
    if expected_clone_id is not None and state['id']!=expected_clone_id:
        raise ValueError('Fixed retirement clone identity changed')
    def owner(sql):
        nonlocal counter
        counter+=1
        result=successor.command(['docker','exec','-i',successor.TARGET,successor.BIN+'psql','-h','/tmp','-U','postgres',
            '-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql,timeout=10)
        private_file(proof/('CUSTODIAN_ACCOUNT_'+str(counter).zfill(2)+'.log'),result.stdout+'\n'+result.stderr)
        if result.returncode:raise ValueError('Fixed custodian account check unavailable')
        return result.stdout.strip()
    failures=[]
    try:
        attempted=True
        if not state['running']:
            if successor.command(['docker','start',successor.TARGET],timeout=15).returncode:
                raise ValueError('Fixed custodian cleanup start unavailable')
        # pg_isready can become available after the start acknowledgment.
        import time
        for _ in range(20):
            ready=successor.command(['docker','exec',successor.TARGET,successor.BIN+'pg_isready','-h','/tmp','-U','postgres'],timeout=5)
            if ready.returncode==0:break
            time.sleep(.2)
        if ready.returncode:raise ValueError('Fixed custodian cleanup database unavailable')
        initial=owner('select count(*) from pg_roles where rolname in('+','.join(map(quote,roles))+') and rolcanlogin;')
        if initial not in tuple(map(str,range(6))):raise ValueError('Fixed custodian initial account state differs')
        for role in roles:
            try:
                exists=owner('select exists(select 1 from pg_roles where rolname='+quote(role)+');')
                if exists=='t':
                    # Reuse the existing fixed identity administrator. The
                    # ordinary postgres table owner cannot alter these roles.
                    successor.sensitive_admin('alter role '+role+' nologin;');retired.append(role)
                elif exists!='f':raise ValueError('Fixed custodian account state differs')
            except BaseException as error:failures.append(type(error).__name__)
        count=owner('select count(*) from pg_roles where rolname in('+','.join(map(quote,roles))+') and rolcanlogin;')
        if failures or count!='0':raise ValueError('Fixed custodian retirement unconfirmed')
        # Application histories are preserved; observations are private and
        # taken only in this generated owned database, never a replay/write.
        result=successor.command(['docker','exec','-i',successor.TARGET,successor.BIN+'psql','-h','/tmp','-U','postgres',
            '-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],timeout=10,
            data="select json_build_object('reports',(select count(*) from terra_private.correction_reports),'receipts',(select count(*) from terra_correction_test_api.request_receipts),'events',(select count(*) from terra_correction_test_api.review_events),'publications',(select count(*) from terra_private.issue_publications),'heads',(select count(*) from terra_private.issue_heads));")
        private_file(proof/'CUSTODIAN_RETAINED_COUNTS.json',result.stdout+'\n'+result.stderr)
        # A child lost before database creation has no count witness. Cleanup
        # remains confirmable but never becomes successful review acceptance.
        counts=_json(result.stdout.encode()) if result.returncode==0 else None
        return {'rolesObserved':len(retired),'plannedRoles':len(roles),'initialLogin':int(initial),'remainingLogin':0,'counts':counts}
    finally:
        # A bound parent performs its independent immutable-ID STOP in its
        # finally block. Legacy direct remediation keeps its own fixed STOP.
        if attempted and expected_clone_id is None:
            stopped=successor.command(['docker','stop','--timeout','10',expected_clone_id or successor.TARGET],timeout=20)
            final=clone_state()
            if stopped.returncode or final['running'] or (expected_clone_id is not None and final['id']!=expected_clone_id):
                raise ValueError('Fixed custodian stop unconfirmed')


def _end_owned_child(process):
    try:
        if process.poll() is None:
            # Signal acknowledgement loss does not establish whether the
            # signal arrived. Still perform bounded wait/kill/wait/reaping.
            try:process.terminate()
            except OSError:pass
            try:process.wait(timeout=15)
            except (subprocess.TimeoutExpired,OSError):pass
            if process.returncode is None:
                try:process.kill()
                except OSError:pass
                try:process.wait(timeout=5)
                except (subprocess.TimeoutExpired,OSError):pass
            if process.returncode is None:raise ValueError('Fixed owned child exit unconfirmed')
    finally:
        for name in ('stdin','stdout','stderr'):
            stream=getattr(process,name,None)
            if stream is not None and not stream.closed:stream.close()


def run_supervised_review(*,kill_after_first_reports=False):
    if type(kill_after_first_reports) is not bool:raise ValueError('Invalid fixed invented supervisor case')
    with fixed_trial_guard() as guard_fd:
        initial=clone_state()
        if initial['running']:raise ValueError('Fixed custodian clone is already running')
        owned_id=initial['id']
        pins=current_candidate_pins()
        proof=successor.PRIVATE/('supervised-correction-review-'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3))
        proof.mkdir(mode=0o700)
        # Record the validated immutable identity before creating the child.
        _write(proof,_root(proof),'PREVALIDATED_CLONE.json',{'schemaVersion':1,
            'evidenceKind':'prevalidated_invented_review_clone','clone':initial})
        parent,child=socket.socketpair();parent.settimeout(30)
        process=None;ownership=None;native_proof=None;output=None;cleanup=None;failure=None;result=None
        durable_ownership=False;start_ack=False;start_ack_attempted=False;stage_received=False;continue_ack=False;kill_attempted=False
        child_exit_confirmed=False
        inspection_barrier='not_required';stop_attempted=False;stop_command_confirmed=False
        try:
            process=subprocess.Popen([sys.executable,'-B','-E','-s','-m','scripts.supervised_correction_review_worker'],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,env=child_environment(),
                pass_fds=(guard_fd,child.fileno()))
            packet={'schemaVersion':1,'parentPid':os.getpid(),'guardFd':guard_fd,'channelFd':child.fileno()}
            child.close();process.stdin.write(json.dumps(packet,separators=(',',':')).encode());process.stdin.close()
            ownership=checked_start(receive_packet(parent),pins)
            native_proof=successor.PRIVATE/('authenticated-successor-'+ownership['suffix'])
            private_directory(native_proof)
            raw=record_owned_start(native_proof,ownership,pins)
            durable_ownership=True
            private_file(proof/'OWNED_START_COPY.json',raw.decode())
            start_ack_attempted=True
            send_packet(parent,{'schemaVersion':1,'status':'owned_start_recorded','packetSha256':sha256(raw).hexdigest()})
            start_ack=True
            stage=exact_packet(receive_packet(parent,timeout=30),{'schemaVersion':1,'status':'first_invented_reports_committed'})
            stage_received=True
            private_file(proof/'FIRST_REPORTS_OBSERVED.json',json.dumps(stage)+'\n')
            if kill_after_first_reports:
                kill_attempted=True;process.kill()
            else:
                # Mark before I/O: lost ACK can still let the worker continue.
                continue_ack=True;send_packet(parent,{'schemaVersion':1,'status':'continue_invented_review'})
            # The bootstrap stdin has already been sent and closed. Reuse the
            # bounded reader with an empty owned replacement stream; it selects
            # no executable/credential and caps the remaining child output.
            process.stdin=open(os.devnull,'rb')
            # The observed fixed native review needs more than thirty seconds
            # after continuation on this host. Keep a finite local-only budget;
            # timeout still follows the same HELD/owned-STOP path.
            output=communicate_bounded(process,b'',timeout=45,timeout_ceiling=45,max_stdout=65536,max_stderr=1024)
            private_file(proof/'WORKER_STDOUT.json',output.stdout.decode('utf-8',errors='replace'))
            private_file(proof/'WORKER_STDERR.log',output.stderr.decode('utf-8',errors='replace'))
            if output.returncode!=0:raise ValueError('Fixed review worker did not complete')
            result=build_execution_result(_json(output.stdout),pins)
        except BaseException as error:
            failure=type(error).__name__
        finally:
            child.close();parent.close()
            try:
                if process is not None:
                    _end_owned_child(process);child_exit_confirmed=True
            except BaseException as error:
                failure=failure or type(error).__name__
            if process is not None and not child_exit_confirmed:
                inspection_barrier='unconfirmed'
                try:
                    record_review_inspection_barrier(owned_id,process.pid,proof.name)
                    inspection_barrier='recorded'
                except BaseException as error:failure=failure or type(error).__name__
            # Known-owned daemon cleanup is a separate obligation. An
            # unconfirmed child reap cannot skip STOP or authorize retirement.
            try:
                killed_at_pause=bool(child_exit_confirmed and stage_received and kill_attempted and not continue_ack and
                    process is not None and process.returncode==-signal.SIGKILL)
                if ownership is not None and child_exit_confirmed and (result is not None or killed_at_pause):
                    cleanup=retire_owned_worker(ownership,pins,proof,expected_clone_id=owned_id)
                elif ownership is not None and durable_ownership:
                    # Arbitrary-phase loss can leave an outstanding Docker/SQL
                    # command. Stop the owned daemon; do not restart it or claim
                    # role quiescence/retirement until separately inspected.
                    cleanup={'state':'held_for_private_inspection','remainingLogin':None,'counts':None}
                else:cleanup={'state':'no_acknowledged_start','remainingLogin':None,'counts':None}
            except BaseException as error:
                failure=failure or type(error).__name__
                cleanup={'state':'unconfirmed','exceptionType':type(error).__name__}
            finally:
                if process is not None:
                    stop_attempted=True
                    try:stop_prevalidated_clone(owned_id);stop_command_confirmed=True
                    except BaseException as error:failure=failure or type(error).__name__
        try:
            final=clone_state();stopped=final['id']==owned_id and not final['running']
        except (Exception,KeyboardInterrupt):stopped=False
        if not stopped:failure=failure or 'OwnedCloneStopUnconfirmed'
        killed_at_pause=bool(child_exit_confirmed and stage_received and kill_attempted and not continue_ack and
            process is not None and process.returncode==-signal.SIGKILL)
        if failure is None:
            wanted={'reports':4,'receipts':4,'events':3,'publications':2,'heads':1}
            counts=None if cleanup is None else cleanup.get('counts')
            if type(counts) is not dict or set(counts)!=set(wanted) or any(type(counts[key]) is not int or counts[key]!=value for key,value in wanted.items()):
                failure='RetainedHistoryUnconfirmed'
        witness={'evidenceKind':'actual_fixed_review_custodian','observedAt':datetime.now(timezone.utc).isoformat(),
            'workerReturncode':None if process is None else process.returncode,'ownershipRecordedBeforeStartAck':durable_ownership,
            'startAckAttempted':start_ack_attempted,'startAckWriteConfirmed':start_ack,
            'firstReportsStageReceived':stage_received,'continuationAckAttempted':continue_ack,
            'childExitConfirmed':child_exit_confirmed,
            'inspectionBarrier':inspection_barrier,'prevalidatedIdentityRecordedBeforeChild':True,
            'immutableOwnedStopAttempted':stop_attempted,'immutableOwnedStopCommandConfirmed':stop_command_confirmed,
            'cleanup':cleanup,'ownedCloneStopped':stopped,'workerKilledAfterFirstReports':killed_at_pause,
            'workerQuiescenceVerified':child_exit_confirmed and (result is not None or killed_at_pause),
            'failureType':failure,'sourceRequests':0,'modelCalls':0,'primaryChanged':False,
            'guardianDeathVerified':False,'powerLossVerified':False,'privateEvidenceDirectory':str(proof),
            'nativeEvidenceDirectory':None if native_proof is None else str(native_proof)}
        private_file(proof/'SUPERVISED_REVIEW_RESULT.json',json.dumps(witness,indent=2)+'\n')
        if failure is not None:raise SupervisedReviewHeld(witness)
        return {**result,'evidenceKind':'fresh_invented_supervised_correction_review_result_v3',
            'workerExitObserved':True,'custodianRolesRetired':True,'custodianCloneStopped':True}
