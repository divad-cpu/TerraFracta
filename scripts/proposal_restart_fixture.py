"""Owned process-stop/restart scenarios; no payload is handed to the successor."""
from datetime import datetime,timezone
import json, os, signal, subprocess, sys, time
from uuid import uuid4
from scripts.captured_fictional_pipeline import ROOT, private_file
from scripts.check_run_admission_concurrency import quote

def run_proposal_restart_trial(owner,identity,proof,record,*,database_crash=False,worker_capture=False):
    modes=('success','takeover') if database_crash or worker_capture else ('success','missing','changed','manifest','takeover','lease_expired');results=[]
    (proof/'restart').mkdir(mode=0o700)
    for mode in modes:
        database='terra_proposal_restart_'+mode
        assert owner('select count(*) from pg_database where datname='+quote(database),'restart-absent-'+mode,database='postgres')=='0'
        owner('create database '+database,'restart-create-'+mode,database='postgres')
        for n,path in enumerate(sorted((ROOT/'supabase/migrations').glob('*.sql'))):owner(path.read_text(),'restart-'+mode+'-migration-'+str(n),database=database)
        for name in ('TF007_PROPOSAL_CAPTURE.sql','TF007_PROPOSAL_READER.sql','TF007_PROPOSAL_CAPTURE_COMMAND.sql'):
            owner((ROOT/'research/pending'/name).read_text(),'restart-'+mode+'-draft-'+name,database=database)
        if worker_capture:owner((ROOT/'research/pending/TF009_WORK_PROPOSAL_CAPTURE.sql').read_text(),'restart-'+mode+'-worker-draft',database=database)
        child_proof=proof/'restart'/mode;child_proof.mkdir(mode=0o700)
        context={**{k:identity[k] for k in ('containerId','target','volume','label')},'database':database,'proof':str(child_proof),'mode':mode}
        if worker_capture:context['captureCommand']='worker'
        def child(phase,expected):
            process=subprocess.Popen([sys.executable,'-B','-m','scripts.proposal_restart_child'],cwd=ROOT,
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
            out=err=''
            try:out,err=process.communicate(json.dumps({**context,'phase':phase}),timeout=45)
            except BaseException:
                if process.poll() is None:
                    os.killpg(process.pid,signal.SIGTERM)
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
                out,err=process.communicate(timeout=5)
                private_file(child_proof/(phase+'-interrupted-process.log'),out+'\n'+err)
                raise
            finally:
                if process.poll() is None:
                    os.killpg(process.pid,signal.SIGTERM)
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
            private_file(child_proof/(phase+'-process.log'),out+'\n'+err)
            assert process.returncode==expected,{'mode':mode,'phase':phase,'exit':process.returncode}
            return process.pid
        first_pid=child('capture',17)
        before=json.loads((child_proof/'capture-interrupted.json').read_text())
        assert before['pid']==first_pid and before['streamOpens']==1
        assert before['counts']=={'captures':1,'closeouts':0,'decisions':1,'publications':0,'dispatches':1}
        crashes=[]
        if database_crash:
            from scripts.proposal_database_crash_fixture import crash_and_restore
            crashes.append(crash_and_restore(identity,child_proof,'captured'))
        if mode in ('takeover','lease_expired'):
            run=before['receipt']['runId'];fingerprint=before['requestSha256']
            busy=json.loads(owner('select terra_private.claim_update_run_work('+','.join(map(quote,(run,fingerprint,str(uuid4()))))+');','restart-before-expiry-'+mode,database=database))
            assert busy['status']=='busy'
            pause=(datetime.fromisoformat(before['workLeaseExpiresAt'])-datetime.now(timezone.utc)).total_seconds()+0.05
            assert 0<pause<=30
            # Real expiry is necessary to test the existing unchanged SQL fence.
            time.sleep(pause)
            owner('select terra_private.assert_update_run_work('+','.join(map(quote,(run,fingerprint,before['workClaimId'])))+');',
                'restart-expired-fence-'+mode,database=database,expect='23514')
            if worker_capture:
                from scripts.proposal_restart_child import prepared_sql
                original_command=json.loads((child_proof/'capture-work-command.json').read_text())
                owner(prepared_sql(original_command,work=True),'restart-expired-worker-replay-'+mode,database=database,expect='23514')
        changes={
            'missing':'delete from terra_private.proposal_captures',
            'changed':"update terra_private.source_versions set content_sha256=repeat('c',64)",
            'manifest':"update terra_private.update_run_manifests set manifest_sha256=repeat('0',64)",
        }
        if mode in changes:owner('begin;set local session_replication_role=replica;'+changes[mode]+';commit;','restart-fixture-corruption-'+mode,database=database)
        succeeds=mode in ('success','takeover')
        second_pid=child('resume',0 if succeeds else 23)
        after=json.loads((child_proof/('resume-completed.json' if succeeds else 'resume-refused.json')).read_text())
        assert after['pid']==second_pid and second_pid!=first_pid and after['streamOpens']==0
        expected_counts={**before['counts'],'captures':0 if mode=='missing' else 1,'closeouts':1 if succeeds else 0}
        assert after['counts']==expected_counts
        if succeeds:
            if worker_capture:
                first_command=json.loads((child_proof/'capture-work-command.json').read_text())
                next_command=json.loads((child_proof/'resume-work-command.json').read_text())
                assert before['workerCaptureCommand'] is True and after['workerCaptureCommand'] is True
                assert len(first_command['values'])==len(next_command['values'])==8
                assert next_command['values'][:2]==first_command['values'][:2]
                assert next_command['values'][2]==after['workClaimId'] and first_command['values'][2]==before['workClaimId']
                assert next_command['values'][3:]==first_command['values'][3:]
            assert after['requestSha256']==before['requestSha256'] and after['manifestSha256']==before['manifestSha256']
            assert after['workDeadline']==before['workDeadline']
            assert after['receipt']['capturedAt']==before['receipt']['capturedAt']
            assert after['receipt']['captureId']==before['receipt']['captureId'] and after['receipt']['proposalSha256']==before['receipt']['proposalSha256']
            assert after['events']==['proposal_committed','proposal_receipt_checked','closeout_committed']
            assert after['closeout']['runState']=='completed' and after['closeout']['visibilityState']=='not_required'
            assert after['capturedWorkClaimId']==before['workClaimId']
            assert (after['workClaimId']==before['workClaimId'])==(mode=='success')
            assert after['workAttempt']==(2 if mode=='takeover' else 1)
            if database_crash:crashes.append(crash_and_restore(identity,child_proof,'completed'))
            third_pid=child('terminal',0)
            terminal=json.loads((child_proof/'terminal-readback.json').read_text())
            assert third_pid not in (first_pid,second_pid) and terminal['pid']==third_pid
            assert terminal['counts']==after['counts'] and terminal['events']==[] and terminal['streamOpens']==0
            assert terminal['finishedAt']==after['finishedAt'] and terminal['workClaimId']==after['workClaimId']
            assert terminal['summary']==after['closeout'] and terminal['proposalCapture']['captureId']==before['receipt']['captureId']
            assert terminal['proposalCapture']['capturedAt']==before['receipt']['capturedAt']
            assert terminal['privateRead']['kind']=='ok' and terminal['currentWorkAuthorized'] is False
        else:assert after['events']==[] and after['exceptionType']=='RestartRefused'
        results.append({'mode':mode,'firstPid':first_pid,'secondPid':second_pid,'before':before,'after':after,
            **({'terminal':terminal} if succeeds else {}),
            **({'databaseCrashes':crashes} if database_crash else {}),
            **({'workerCaptureCommand':True,'originalCommand':first_command,'successorCommand':next_command} if worker_capture else {}),
            'parentHandedOffRunPayload':False,'realSourceRequests':0,'primaryChanged':False})
    record('COLD_RESTART',{'scenarios':results,'methods':len(results),'runtimeConfigured':False,'publicationAuthorized':False,
        'databaseCrashTrial':database_crash,'workerCaptureTrial':worker_capture})
    return results
