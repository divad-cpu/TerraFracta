"""Fixed invented queued withdrawal and failure probes for retained storage.

Only a fresh database in the already owned network-free clone is changed.
Queue a real owner withdrawal while raw storage holds the v2 source locks;
verify its completion rather than inferring rollback from docker-client exit.
No worker-selected fault, SQL, credential, live source, account or raw root.
"""
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import sys
import threading
import time

from scripts.captured_fictional_pipeline import private_file
from scripts.check_archived_completion_restore import BIN
from scripts.check_authenticated_capture_pipeline import TARGET,command
from scripts.run_authenticated_ssb_pair_capture import PRIVATE,REGS
from scripts.check_run_admission_concurrency import quote
from scripts.run_private_custodian_trial import run_fixed_custodian_trial
from workers.ssb_14059_raw_custody import PrivateRawCustody,PrivateRawCustodyError

CASES=('queued_withdrawal_after_commit','callback_failure','parent_cancel','idle_timeout')


def run_case(case,*,peer='data',observe_idle=False,exercise_cleanup=False):
    if case not in CASES:raise ValueError('Unknown fixed retained store case')
    if peer not in ('metadata','data') or type(observe_idle) is not bool or type(exercise_cleanup) is not bool \
            or (observe_idle and case!='idle_timeout'):raise ValueError('Invalid fixed retained follow-up')
    state={'case':case,'blockedObserved':False,'queuedWithdrawalCompleted':False,
        'cleanupContenderRefused':False,'sourceRequests':0,'primaryChanged':False,'withdrawnPeer':peer}
    completed=threading.Event(); thread=None; withdrawal=[]; selected=[];parent_started=None
    def owner(proof,sql):
        suffix=proof.name.removeprefix('authenticated-ssb-pair-')
        if re.fullmatch(r'[0-9]{14}_[0-9a-f]{6}',suffix) is None:raise ValueError('Invalid invented history')
        result=command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres',
            '-d','terra_ssb_pair_'+suffix,'-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql,timeout=15)
        if result.returncode:raise ValueError('Invented owner observation refused')
        return result.stdout.strip()
    def await_withdrawal():
        if not completed.wait(11):raise ValueError('Invented withdrawal did not complete')
        if thread is not None:thread.join(timeout=1)
        if len(withdrawal)!=1 or withdrawal[0]!='false':raise ValueError('Invented withdrawal failed')
        state['queuedWithdrawalCompleted']=True
    def probe(phase,custody,proof,client,saved):
        nonlocal thread
        if phase=='started':
            selected.append(proof)
            original=client.store_pair_transaction
            def held_receipt(prepare_store):
                nonlocal parent_started
                parent_started=time.monotonic()
                reply=original(prepare_store)
                # Invented delivery delay guarantees withdrawal precedes the
                # separate post-COMMIT binding read. No native write is retried.
                await_withdrawal()
                state['commitReplyObservedBeforeWithdrawalReadback']=True
                return reply
            client.store_pair_transaction=held_receipt
        elif phase=='saved':
            state['rawAttemptId']=saved.attempt_id
            try:
                with PrivateRawCustody(custody.root):pass
            except PrivateRawCustodyError:state['cleanupContenderRefused']=True
            else:raise ValueError('Invented cleanup was not excluded')
            if exercise_cleanup:
                from scripts.ssb_raw_retention_service import run_retention_once
                cleanup=run_retention_once(raw_root=custody.root,health_root=proof/'guarded-cleanup-health')
                if cleanup['state']!='blocked' or len(custody.attempt_names())!=1:
                    raise ValueError('Actual invented cleanup crossed the held custody lock')
                state['actualCleanupBlockedWhileHeld']=True
            if observe_idle:
                principal='terra_pair_'+proof.name.removeprefix('authenticated-ssb-pair-')
                activity_started=time.monotonic()
                activity=json.loads(owner(proof,"begin read only;select jsonb_build_object('state',state,"
                    "'transactionAgeSeconds',extract(epoch from clock_timestamp()-xact_start),"
                    "'idleAgeSeconds',extract(epoch from clock_timestamp()-state_change), 'pid',pid) "
                    "from pg_stat_activity where usename="+quote(principal)+' and datname=current_database();rollback;'))
                if activity['state']!='idle in transaction' or not 0<=activity['transactionAgeSeconds']<1.5 \
                        or not 0<=activity['idleAgeSeconds']<1.5:raise ValueError('Idle attribution window is unavailable')
                state['beforeWithdrawalActivity']=activity
                activity_roundtrip=time.monotonic()-activity_started
            queued_at=time.monotonic()
            def withdraw():
                try:
                    withdrawal.append(owner(proof,"begin;set local application_name='TF_retained_withdrawal';"
                        "set local lock_timeout='9s';set local statement_timeout='10s';"
                        'update terra_private.source_registrations set allow_retain=false where id='+quote(REGS[peer])+
                        ';commit;select to_jsonb(allow_retain) from terra_private.source_registrations where id='+quote(REGS[peer])+';'))
                except Exception:withdrawal.append('refused')
                finally:completed.set()
            thread=threading.Thread(target=withdraw,daemon=True);thread.start()
            deadline=time.monotonic()+2
            while time.monotonic()<deadline:
                observed=owner(proof,"begin read only;select jsonb_build_object('blocked',exists(select 1 from pg_stat_activity "
                    "where datname=current_database() and application_name='TF_retained_withdrawal' and cardinality(pg_blocking_pids(pid))>0),"
                    "'retained',(select allow_retain from terra_private.source_registrations where id="+quote(REGS[peer])+"),"
                    "'pairs',(select count(*) from terra_private.source_response_pairs));rollback;")
                data=json.loads(observed)
                if data['blocked']:
                    if data!={'blocked':True,'retained':True,'pairs':0}:raise ValueError('Invented save window differs')
                    state['blockedObserved']=True;break
                if completed.is_set():raise ValueError('Withdrawal crossed the retained save window')
                time.sleep(.025)
            if not state['blockedObserved']:raise ValueError('Queued withdrawal was not observed')
            if case=='callback_failure':raise ValueError('Invented callback failure after fsync')
            if case=='parent_cancel':client.cancel()
            if case=='idle_timeout':
                # Observe actual server-side idle expiry independently of the
                # client cancellation; the raw callback is deliberately held.
                await_withdrawal()
                state['serverReleasedBeforeCallbackReturned']=True
                if observe_idle:
                    elapsed=time.monotonic()-queued_at
                    parent_elapsed=time.monotonic()-parent_started if parent_started is not None else 99
                    absent=owner(proof,'select not exists(select 1 from pg_stat_activity where usename='+quote(principal)+' and datname=current_database());')
                    if absent!='t' or not 1<=elapsed<4.5 \
                            or activity['transactionAgeSeconds']+activity_roundtrip+elapsed>=5.5 \
                            or not 0<parent_elapsed<7:
                        raise ValueError('Server idle attribution is not bounded before the transaction/watchdog limit')
                    state.update(withdrawalElapsedSeconds=round(elapsed,6),ordinaryBackendGoneBeforeCallbackReturned=True,
                        activityQueryRoundtripSeconds=round(activity_roundtrip,6),parentTransactionElapsedSeconds=round(parent_elapsed,6),
                        observedReleaseBeforeSixSecondTransactionLimit=True,observedReleaseBeforeEightSecondWatchdog=True)
        elif phase=='finished':
            if thread is not None:await_withdrawal()
            state['terminalNative']=json.loads(owner(proof,"begin read only;select jsonb_build_object("
                "'retained',(select allow_retain from terra_private.source_registrations where id="+quote(REGS[peer])+"),"
                "'pairs',(select count(*) from terra_private.source_response_pairs),"
                "'rawArtifacts',(select count(*) from terra_private.source_raw_pair_artifacts),"
                "'publications',(select count(*) from terra_private.issue_publications));rollback;"))
            state['clientClosed']=client.closed;state['clientActive']=client.active
            private_file(proof/'RETAINED_TRANSACTION_CONCURRENCY.json',json.dumps(state,indent=2)+'\n')
        else:raise ValueError('Unknown invented observation phase')
    try:run_fixed_custodian_trial(transactional_store=True,storage_probe=probe)
    except ValueError:state['workerResultAccepted']=False
    else:raise AssertionError('Withdrawn/failed invented store accepted a terminal worker result')
    if len(selected)!=1:raise ValueError('Invented capture proof unavailable')
    proof=selected[0]
    failure=json.loads((proof/'AUTHENTICATED_PAIR_FAILURE_STATE.json').read_bytes())
    terminal=json.loads((proof/'PRIVATE_CUSTODIAN_TERMINAL_STATE.json').read_bytes())
    closeout=json.loads((proof/'PRIVATE_NATIVE_FAILURE_CLOSEOUT_STATE.json').read_bytes())
    committed=case=='queued_withdrawal_after_commit'
    expected_native={'retained':False,'pairs':int(committed),'rawArtifacts':int(committed),'publications':0}
    if not state['blockedObserved'] or not state['queuedWithdrawalCompleted'] or not state['cleanupContenderRefused'] \
            or state['terminalNative']!=expected_native or failure['pairs']!=int(committed) \
            or failure['versions']!=2*int(committed) or failure['publications']!=0 \
            or closeout!={'closeouts':0,'checkpoints':0,'usablePairs':0,'publications':0} \
            or terminal['rawAttempts']!=1 or not terminal['storeConsumed'] or not terminal['backendClosed'] \
            or not terminal['nativeClientClosed'] or terminal['nativeProcessActive']:
        raise ValueError('Invented retained transaction differs from preserved state')
    # The coordinated filesystem lock must really be available after the
    # worker/parent finish. Preserve the orphan; do not delete trial evidence.
    with PrivateRawCustody(proof/'fixture-raw-store') as custody:
        if len(custody.attempt_names())!=1:raise ValueError('Preserved invented raw attempt differs')
    if exercise_cleanup:
        from scripts.ssb_raw_retention_service import run_retention_once
        cleanup=run_retention_once(raw_root=proof/'fixture-raw-store',health_root=proof/'guarded-cleanup-health')
        if cleanup['state']!='completed' or cleanup['attemptsRemoved']!=0 or cleanup['activeAttemptsRemaining']!=1:
            raise ValueError('Actual cleanup did not preserve the active invented attempt after release')
        state['actualCleanupCompletedAfterRelease']=True
    state.update(observedAt=datetime.now(timezone.utc).isoformat(),privateEvidenceDirectory=str(proof),
        filesystemLockReleased=True,rawAttemptsPreserved=1,nativeCommitObserved=committed,
        temporaryAccountsRetired=True,ownedCloneStopped=True,originalHttpModuleExecuted=False,
        nativeWriteReplayed=False,publicationEnabled=False)
    private_file(proof/'RETAINED_TRANSACTION_CASE_RESULT.json',json.dumps(state,indent=2)+'\n')
    return state


def main():
    if sys.argv[1:]:raise ValueError('Fixed retained concurrency probes accept no arguments')
    results=[run_case(case) for case in CASES]
    print(json.dumps({'evidenceKind':'actual_invented_retained_transaction_concurrency',
        'cases':results,'actualSourceRequests':0,'primaryChanged':False},indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
