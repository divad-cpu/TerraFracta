"""Actual receipt lookup waits on a fresh invented database, never live SQL.

Resolve the lookup-specific expiry/consistent-read gap in the preceding review.
Retain histories, retire every attempted account and stop the owned clone.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import secrets
import sys
import time
from scripts import check_invented_correction_intake as intake
from scripts import check_invented_correction_reliability as reliability
from scripts import check_invented_correction_review as review
from scripts import check_invented_correction_queue as queue
from scripts import invented_correction_recovery_cases as recovery
from scripts.captured_fictional_pipeline import private_file
from scripts.check_authenticated_capture_pipeline import sensitive_admin
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_successor_pipeline import trial


def wait_for(owner, predicate, label):
    deadline=time.monotonic()+3
    while time.monotonic()<deadline:
        if owner(predicate,label)=='t': return
        time.sleep(.025)
    raise ValueError('Exact invented recovery wait not observed')


def refused_session(selected, marker, expected):
    try: selected.until(marker)
    except RuntimeError:
        selected.process.wait(timeout=5)
        if selected.process.returncode==0 or not any(expected in error for error in selected.errors):
            raise ValueError('Invented recovery wait refusal differs')
        return '\n'.join(selected.errors)+'\n'
    raise ValueError('Expired invented recovery wait accepted')


def main():
    if sys.argv[1:]: raise ValueError('Fixed invented recovery concurrency takes no arguments')
    candidates={path:path.read_bytes() for path in (intake.CANDIDATE,reliability.RELIABILITY,review.REVIEW,recovery.RECOVERY)}
    pins={path.name:sha256(body).hexdigest() for path,body in candidates.items()}
    assert pins[intake.CANDIDATE.name]=='f429be4fff02b48d07b841d2bc568b24d45f09e945b9ac64eab1b0597fd8953b'
    state={'roles':[],'sessions':[],'reports':[],'complete':False}
    def create_role(role):
        password=secrets.token_urlsafe(48);state['roles'].append(role)
        sensitive_admin('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(password)+';')
        return password
    def session(args,password):
        selected=Session(args);state['sessions'].append(selected)
        selected.process.stdin.write(password+'\n');selected.process.stdin.flush();return selected
    def retire(selected): selected.close();state['sessions'].remove(selected)
    def observe(phase,projection,database,proof,owner):
        if any(path.read_bytes()!=body for path,body in candidates.items()): raise ValueError('Recovery candidate changed')
        state['proof']=proof;suffix=proof.name.removeprefix('authenticated-successor-')
        if phase=='first':
            for path,body in candidates.items():private_file(proof/('EXACT_'+path.name),body.decode())
            owner('begin;'+''.join(body.decode() for body in candidates.values())+'commit;','recovery_wait_candidates')
        writer='terra_correction_'+phase+'_'+suffix;password=create_role(writer)
        owner('insert into terra_correction_test_api.principal_scopes values('+quote(writer)+','+quote(projection['issueId'])+
            ",clock_timestamp()+interval '8 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to "+writer+
            ';grant execute on function terra_correction_test_api.submit_request(jsonb) to '+writer+';','recovery_wait_writer_scope')
        for request in reliability.request_wire(projection)['requests']:
            result=intake.client(writer,password,database,reliability.submit_sql(request));assert result.returncode==0
            state['reports'].append(review.checked_result('request',request,json.loads(result.stdout)))
        if phase=='first':return
        holder='terra_correction_review_'+suffix;holder_password=create_role(holder)
        reader='terra_correction_queue_other_'+suffix;reader_password=create_role(reader)
        for role,function in ((holder,'review_report'),(reader,'lookup_review_event')):
            owner('insert into terra_correction_test_api.reviewer_scopes values('+quote(role)+','+quote(projection['issueId'])+
                ",clock_timestamp()+interval '8 minutes',true);grant usage on schema terra_correction_test_api to "+role+
                ';grant execute on function terra_correction_test_api.'+function+'(jsonb) to '+role+';','recovery_wait_reviewer_scope')
        hargs=review.reviewer_args(holder,database);rargs=queue.actor_args(reader,database)
        start={'schemaVersion':1,'eventId':'d8a11111-1111-4111-8111-111111111111',
               'reportId':state['reports'][0]['reportId'],'expectedState':'new','nextState':'in_review','resolutionNote':None}
        finish={**start,'eventId':'d8a22222-2222-4222-8222-222222222222','expectedState':'in_review','nextState':'closed','resolutionNote':review.NOTE}
        def block(waiter,blocker,label):
            wait_for(owner,'select '+str(blocker)+'=any(pg_blocking_pids('+str(waiter)+'));',label)
            private_file(proof/(label+'.json'),json.dumps({'blocker':blocker,'waiter':waiter,'blockingWaitObserved':True})+'\n')
        def rows():
            return owner("select jsonb_build_object('reports',(select jsonb_agg(to_jsonb(c) order by id) from terra_private.correction_reports c),"
                "'receipts',(select jsonb_agg(to_jsonb(r) order by principal,request_id) from terra_correction_test_api.request_receipts r),"
                "'events',(select jsonb_agg(to_jsonb(e) order by report_id,sequence) from terra_correction_test_api.review_events e),"
                "'publications',(select jsonb_agg(to_jsonb(p) order by id) from terra_private.issue_publications p),"
                "'heads',(select jsonb_agg(to_jsonb(h) order by issue_id) from terra_private.issue_heads h));",'recovery_wait_exact_rows')
        # The reader waits on a different principal's uncommitted transition.
        a=session(hargs,holder_password);b=session(rargs,reader_password)
        ap=int(a.execute('select pg_backend_pid();','HPID')[0]);bp=int(b.execute('select pg_backend_pid();','RPID')[0])
        provisional=json.loads(a.execute('begin;'+review.review_sql(start),'HELDSTART')[0])
        b.send('begin;'+recovery.lookup_sql(start),'WAITEDLOOKUP');block(bp,ap,'RECOVERY_CURRENT_REPORT_WAIT')
        assert owner('select count(*) from terra_correction_test_api.review_events;','recovery_wait_uncommitted_events')=='0'
        a.execute('commit;','STARTCOMMITTED');review.checked_result('review',start,provisional)
        committed_rows=rows()
        waited=recovery.checked_result(start,json.loads(b.until('WAITEDLOOKUP')[0]));b.execute('commit;','LOOKUPCOMMITTED')
        assert waited['outcome']=='not_observed' and waited['recordedEvent'] is None and waited['current']['reviewState']=='in_review'
        assert len(waited['current']['events'])==1 and rows()==committed_rows
        private_file(proof/'RECOVERY_CURRENT_AFTER_REPORT_WAIT.json',json.dumps({'request':start,'result':waited},indent=2)+'\n')
        retire(a);retire(b)
        baseline=rows()
        def shorten_reader():
            owner('update terra_correction_test_api.reviewer_scopes set expires_at=clock_timestamp()+interval \'700 milliseconds\' where principal='+quote(reader)+';','recovery_short_reader_scope')
        def expired():
            wait_for(owner,'select expires_at<=clock_timestamp() from terra_correction_test_api.reviewer_scopes where principal='+quote(reader)+';','recovery_server_expiry_observed')
        # Expiry after authorization but before a blocked report can be read.
        a=session(hargs,holder_password);b=session(rargs,reader_password)
        ap=int(a.execute('select pg_backend_pid();','HOLDERPID')[0]);bp=int(b.execute('select pg_backend_pid();','WAITERPID')[0])
        a.execute('begin;'+review.review_sql(finish),'HELDUNCOMMITTEDCLOSE');shorten_reader()
        b.send(recovery.lookup_sql(start),'EXPIREDREPORTLOOKUP');block(bp,ap,'RECOVERY_REPORT_EXPIRY_WAIT')
        expired();a.execute('rollback;','CLOSEROLLEDBACK')
        private_file(proof/'RECOVERY_REPORT_EXPIRY_REFUSAL.log',refused_session(b,'EXPIREDREPORTLOOKUP','Invented review recovery report unavailable'))
        retire(a);retire(b);assert rows()==baseline
        # Same-principal authentication scope itself is also a lock wait.
        shorten_reader();a=session(rargs,reader_password);b=session(rargs,reader_password)
        ap=int(a.execute('select pg_backend_pid();','SCOPEHOLDERPID')[0]);bp=int(b.execute('select pg_backend_pid();','SCOPEWAITERPID')[0])
        initial=json.loads(a.execute('begin;'+recovery.lookup_sql(start),'HELDSCOPE')[0]);recovery.checked_result(start,initial)
        b.send(recovery.lookup_sql(start),'EXPIREDSCOPELOOKUP');block(bp,ap,'RECOVERY_SCOPE_EXPIRY_WAIT')
        expired();a.execute('rollback;','SCOPEROLLEDBACK')
        private_file(proof/'RECOVERY_SCOPE_EXPIRY_REFUSAL.log',refused_session(b,'EXPIREDSCOPELOOKUP','Invented correction reviewer scope refused'))
        retire(a);retire(b);assert rows()==baseline
        assert owner('select has_function_privilege('+quote(reader)+",'terra_correction_test_api.review_report(jsonb)','execute');",'recovery_reader_no_write_privilege')=='f'
        assert any(path.read_bytes()!=body for path,body in candidates.items()) is False
        private_file(proof/'RECOVERY_WAIT_EXACT_FINAL_ROWS.json',baseline+'\n')
        state.update(complete=True,rowSha256=sha256(baseline.encode()).hexdigest())
    def cleanup(owner):
        failures=[]
        for selected in list(state['sessions']):
            try:retire(selected)
            except BaseException as error:failures.append(type(error).__name__)
        for role in state['roles']:
            try:
                exists=owner('select exists(select 1 from pg_roles where rolname='+quote(role)+');','recovery_wait_role_exists',database='postgres')
                assert exists in ('t','f')
                if exists=='t':
                    sensitive_admin('alter role '+role+' nologin;')
                    assert owner('select rolcanlogin from pg_roles where rolname='+quote(role)+';','recovery_wait_role_retired',database='postgres')=='f'
            except BaseException as error:failures.append(type(error).__name__)
        if failures:raise RuntimeError('Recovery wait cleanup requires retained-state inspection')
    with fixed_trial_guard():result=trial(projection_observer=observe,trial_cleanup=cleanup)
    assert state['complete']
    receipt={'evidenceKind':'actual_invented_review_lookup_concurrency','observedAt':datetime.now(timezone.utc).isoformat(),
        'candidateSha256':pins,'privateReports':4,'requestReceipts':4,'reviewEvents':1,
        'reportWaitReadsCommittedState':True,'reportWaitExpiryRefused':True,'scopeWaitExpiryRefused':True,
        'threeExactBackendWaitsObserved':True,'readerHasNoMutationPrivilege':True,
        'lookupReportReceiptEventPublicationHeadRowsUnchanged':True,'exactRowsSha256':state['rowSha256'],
        'temporaryAccountsRetired':True,'ownedCloneStopped':True,'primaryChanged':False,
        'actualSourceRequests':0,'modelCalls':0,'realReports':0,'liveReviewEnabled':False,
        'browserVerified':False,'privateEvidenceDirectory':result['privateEvidenceDirectory']}
    private_file(state['proof']/'CORRECTION_RECOVERY_CONCURRENCY_RESULT.json',json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
