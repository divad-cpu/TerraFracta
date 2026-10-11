"""Actual invented-only bounded review discovery on a fresh owned database.

Reuses the fixed successor driver, strict request wire and ordinary SCRAM API.
Retains late commits, expiry waits, controlled owner fixtures and all histories.
No primary, real reports, web transport, source collection or privacy decision.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
import secrets
import sys
import time

from scripts import check_invented_correction_intake as intake
from scripts import check_invented_correction_reliability as reliability
from scripts import check_invented_correction_review as review
from scripts import invented_correction_recovery_cases as recovery
from scripts.captured_fictional_pipeline import ROOT, private_file
from scripts.check_authenticated_capture_pipeline import TARGET, command, sensitive_admin
from scripts.check_archived_completion_restore import BIN
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_successor_pipeline import trial

QUEUE = ROOT/'research/pending/TF007_invented_correction_queue.sql'
START = {'schemaVersion':1,'snapshotId':None,'offset':0}


def actor_args(role, database):
    match = re.fullmatch(r'terra_correction_queue_(writer|other)_([0-9]{14}_[0-9a-f]{6})',role)
    if match is None or database != 'terra_successor_' + match[2]: raise ValueError('Invalid fixed queue actor')
    shell = 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGPASSFILE=/dev/null PGSSLMODE=disable PGCONNECT_TIMEOUT=3; exec ' + BIN + 'psql -h 127.0.0.1 -U ' + role + ' -d ' + database + ' -X -qAt -v ON_ERROR_STOP=1'
    return ['docker','exec','-i',TARGET,'sh','-c',shell]


def checked_result(kind, request, result):
    if kind not in ('queue','detail'): raise ValueError('Invalid fixed queue contract kind')
    checked = command(['node','--experimental-strip-types','scripts/check_invented_correction_queue_results.mjs'],
        data=json.dumps({'kind':kind,'request':request,'result':result}),timeout=5)
    if checked.returncode or len(checked.stdout.encode('utf-8'))>4096: raise ValueError('Invented queue contract differs')
    actual = json.loads(checked.stdout)
    expected = {'schemaVersion':1,'evidenceKind':'checked_private_invented_queue_contract','kind':kind,'sourceRequests':0,'liveReviewEnabled':False}
    if type(actual) is not dict or actual != expected or type(actual.get('schemaVersion')) is not int \
            or type(actual.get('sourceRequests')) is not int or actual.get('liveReviewEnabled') is not False:
        raise ValueError('Invented queue contract differs')
    return result


def queue_sql(request): return 'select terra_correction_test_api.read_review_queue(' + quote(json.dumps(request)) + '::jsonb);'
def detail_sql(request): return 'select terra_correction_test_api.read_review_detail(' + quote(json.dumps(request)) + '::jsonb);'


def main():
    if sys.argv[1:]: raise ValueError('Fixed invented queue trial accepts no arguments')
    candidates = {path:path.read_bytes() for path in (intake.CANDIDATE,reliability.RELIABILITY,review.REVIEW,QUEUE,recovery.RECOVERY)}
    pins = {path.name:sha256(body).hexdigest() for path,body in candidates.items()}
    assert pins[intake.CANDIDATE.name]=='f429be4fff02b48d07b841d2bc568b24d45f09e945b9ac64eab1b0597fd8953b'
    state = {'roles':[],'sessions':[],'reports':[],'denials':[],'complete':False}

    def retire_session(selected): selected.close(); state['sessions'].remove(selected)
    def create_role(role):
        password = secrets.token_urlsafe(48); state['roles'].append(role)
        sensitive_admin('create role ' + role + ' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password ' + quote(password) + ';')
        return password
    def session(args,password):
        selected = Session(args); state['sessions'].append(selected)
        selected.process.stdin.write(password+'\n'); selected.process.stdin.flush(); return selected

    def observe(phase,projection,database,proof,owner):
        if any(path.read_bytes()!=body for path,body in candidates.items()): raise ValueError('Queue candidate changed')
        state['proof']=proof; suffix=proof.name.removeprefix('authenticated-successor-')
        if phase=='first':
            for path,body in candidates.items(): private_file(proof/('EXACT_'+path.name),body.decode())
            owner('begin;'+''.join(body.decode() for body in candidates.values())+'commit;','queue_candidates')
        role='terra_correction_'+phase+'_'+suffix; password=create_role(role)
        def scope_writer(selected_role):
            owner('insert into terra_correction_test_api.principal_scopes values('+quote(selected_role)+','+quote(projection['issueId'])+
                ",clock_timestamp()+interval '8 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to "+selected_role+
                ';grant execute on function terra_correction_test_api.submit_request(jsonb) to '+selected_role+';','queue_writer_scope_'+selected_role)
        scope_writer(role)
        wire=reliability.request_wire(projection)
        for index,request in enumerate(wire['requests']):
            if phase=='first' and index==1:
                request={**request,'draft':{**request['draft'],'fields':{
                    'kind':'accessibility_problem','details':'\u00a0Invented alternative page explanation with no source URL.\u00a0','sourceUrl':''}}}
                state['alternateRequest']=request
            result=intake.client(role,password,database,reliability.submit_sql(request)); assert result.returncode==0
            state['reports'].append(review.checked_result('request',request,json.loads(result.stdout)))
        if phase=='first': return
        reviewer='terra_correction_review_'+suffix; reviewer_password=create_role(reviewer)
        other='terra_correction_queue_other_'+suffix; other_password=create_role(other)
        for selected_role in (reviewer,other):
            owner('insert into terra_correction_test_api.reviewer_scopes values('+quote(selected_role)+','+quote(projection['issueId'])+
                ",clock_timestamp()+interval '8 minutes',true);grant usage on schema terra_correction_test_api to "+selected_role+
                ';grant execute on function terra_correction_test_api.read_review_queue(jsonb),terra_correction_test_api.read_review_detail(jsonb),terra_correction_test_api.review_report(jsonb),terra_correction_test_api.lookup_review_event(jsonb) to '+selected_role+';','queue_reviewer_scope_'+selected_role)
        args=review.reviewer_args(reviewer,database)
        def client(sql): return command(args,data=reviewer_password+'\n'+sql,timeout=15)
        def other_client(sql): return command(actor_args(other,database),data=other_password+'\n'+sql,timeout=15)
        def page(request):
            result=client(queue_sql(request)); assert result.returncode==0
            return checked_result('queue',request,json.loads(result.stdout))
        def counts(): return owner("select jsonb_build_object('reports',(select count(*) from terra_private.correction_reports),'receipts',(select count(*) from terra_correction_test_api.request_receipts),'events',(select count(*) from terra_correction_test_api.review_events),'tickets',(select count(*) from terra_correction_test_api.queue_snapshots));",'queue_counts')
        def wait_block(waiter,blocker,label):
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                if owner('select '+str(blocker)+'=any(pg_blocking_pids('+str(waiter)+'));',label)=='t':
                    private_file(proof/(label+'.json'),json.dumps({'blocker':blocker,'waiter':waiter,'blockingWaitObserved':True})+'\n'); return
                time.sleep(.025)
            raise ValueError('Queue lock wait not observed')
        def deny(label,sql,expected,selected=client):
            before=counts(); result=selected(sql)
            assert result.returncode!=0 and expected in result.stderr,label
            assert counts()==before,label
            state['denials'].append(label)
            private_file(proof/('QUEUE_DENIED_'+label+'.log'),result.stdout+'\n'+result.stderr)
        for name in ('queue_snapshots','request_receipts','reviewer_scopes'):
            deny('table_'+name,'select * from terra_correction_test_api.'+name+';','permission denied')
        deny('private_report_table','select * from terra_private.correction_reports;','permission denied')
        deny('detail_helper','select terra_correction_test_api.checked_review_detail(null,null);','permission denied')
        for broad in ('anon','authenticated','service_role','terra_collector','terra_operator','terra_reviewer','terra_issue_reader'):
            for function in ('read_review_queue(jsonb)','read_review_detail(jsonb)','checked_review_detail(uuid,uuid)'):
                assert owner('select has_function_privilege('+quote(broad)+','+quote('terra_correction_test_api.'+function)+",'execute');",'queue_broad_grant')=='f'

        provisional=client('begin;'+queue_sql(START)+'rollback;'); assert provisional.returncode==0
        rolled=checked_result('queue',START,json.loads(provisional.stdout)); assert rolled['total']==4
        assert json.loads(counts())['tickets']==0
        deny('rolled_back_ticket',queue_sql({'schemaVersion':1,'snapshotId':rolled['snapshotId'],'offset':2}),'Invented review queue snapshot unavailable')
        writer='terra_correction_queue_writer_'+suffix; writer_password=create_role(writer); scope_writer(writer)
        late_request={**wire['requests'][0],'requestId':'d8a11111-1111-4111-8111-111111111111'}
        late=session(actor_args(writer,database),writer_password)
        provisional_report=json.loads(late.execute('begin;'+reliability.submit_sql(late_request),'LATEINSERT')[0])
        assert json.loads(counts())['reports']==4
        first=page(START); assert first['total']==4
        late.execute('commit;','LATECOMMITTED'); retire_session(late)
        late_receipt=review.checked_result('request',late_request,provisional_report); state['reports'].append(late_receipt)
        second=page(first['next']); old_ids=[item['reportId'] for item in first['items']+second['items']]
        assert len(old_ids)==len(set(old_ids))==4 and late_receipt['reportId'] not in old_ids and second['next'] is None
        # Two captures compete for the last committed snapshot allowance.
        # The row scope lock must retain the budget until the winner commits.
        capture=session(args,reviewer_password); competitor=session(args,reviewer_password)
        capture_pid=int(capture.execute('select pg_backend_pid();','CAPTUREPID')[0])
        competitor_pid=int(competitor.execute('select pg_backend_pid();','CAPTURECOMPETITORPID')[0])
        pending_fresh=json.loads(capture.execute('begin;'+queue_sql(START),'PENDINGCAPTURE')[0])
        competitor.send('begin;'+queue_sql(START),'COMPETINGCAPTURE')
        wait_block(competitor_pid,capture_pid,'QUEUE_SNAPSHOT_BUDGET_WAIT')
        assert json.loads(counts())['tickets']==1
        capture.execute('commit;','CAPTURECOMMITTED')
        try: competitor.until('COMPETINGCAPTURE')
        except RuntimeError:
            competitor.process.wait(timeout=5); assert competitor.process.returncode!=0
            assert any('Invented review queue snapshot budget refused' in error for error in competitor.errors)
            private_file(proof/'QUEUE_SNAPSHOT_BUDGET_WAIT-refusal.log','\n'.join(competitor.errors)+'\n')
        else: raise ValueError('Concurrent snapshot exceeded the retained fixture budget')
        retire_session(capture); retire_session(competitor)
        fresh=checked_result('queue',START,pending_fresh)
        assert json.loads(counts())['tickets']==2 and fresh['total']==5 and fresh['snapshotId']!=first['snapshotId']
        pages=[fresh]; cursor=fresh['next']
        while cursor is not None:
            value=page(cursor); pages.append(value); cursor=value['next']
        fresh_ids=[item['reportId'] for value in pages for item in value['items']]
        assert len(fresh_ids)==len(set(fresh_ids))==5 and set(fresh_ids)==set(old_ids)|{late_receipt['reportId']}
        private_file(proof/'QUEUE_MEMBERSHIP_PAGES.json',json.dumps({'first':first,'oldSecond':second,'fresh':pages,'lateRequest':late_request,'lateAfterCommit':late_receipt},indent=2)+'\n')
        deny('snapshot_budget',queue_sql(START),'Invented review queue snapshot budget refused')
        deny('cross_principal',queue_sql(first['next']),'Invented review queue snapshot unavailable',selected=other_client)
        selected={'schemaVersion':1,'snapshotId':first['snapshotId'],'reportId':old_ids[0]}
        result=client(detail_sql(selected)); assert result.returncode==0
        detail=checked_result('detail',selected,json.loads(result.stdout)); assert detail['draft']['fields']==intake.FIELDS
        private_file(proof/'QUEUE_PRIVATE_DETAIL.json',json.dumps({'request':selected,'result':detail},indent=2)+'\n')
        alternate={'schemaVersion':1,'snapshotId':first['snapshotId'],'reportId':state['reports'][1]['reportId']}
        alternative=client(detail_sql(alternate)); assert alternative.returncode==0
        alternate_detail=checked_result('detail',alternate,json.loads(alternative.stdout))
        assert alternate_detail['draft']==state['alternateRequest']['draft']
        private_file(proof/'QUEUE_ALTERNATE_INVENTED_DETAIL.json',json.dumps({'intakeRequest':state['alternateRequest'],'detailRequest':alternate,'result':alternate_detail},indent=2)+'\n')
        deny('nonmember_detail',detail_sql({**selected,'reportId':late_receipt['reportId']}),'Invented review detail snapshot unavailable')
        deny('cross_principal_detail',detail_sql(selected),'Invented review detail snapshot unavailable',selected=other_client)
        for label,request in (('boolean_offset',{**START,'offset':False}),('fractional_offset',{**START,'offset':0.5}),
            ('odd_offset',{**START,'snapshotId':first['snapshotId'],'offset':1}),('client_limit',{**START,'limit':2}),
            ('null_with_offset',{**START,'offset':2}),('invalid_uuid',{**START,'snapshotId':'d8a55555-5555-9555-8555-555555555555'})):
            deny(label,queue_sql(request),'Invented review queue input refused')
        deny('out_of_range',queue_sql({**first['next'],'offset':64}),'Invented review queue snapshot unavailable')
        deny('detail_body_control',detail_sql({**selected,'fields':intake.FIELDS}),'Invented review detail input refused')
        before=owner('select to_jsonb(c) from terra_private.correction_reports c where id='+quote(old_ids[0])+';','queue_binding_original')
        owner('update terra_private.correction_reports set details=\'Invented mismatched binding fixture.\' where id='+quote(old_ids[0])+';','queue_binding_fixture_change')
        private_file(proof/'QUEUE_CONTROLLED_BINDING_TAMPER.json',owner('select to_jsonb(c) from terra_private.correction_reports c where id='+quote(old_ids[0])+';','queue_binding_changed')+'\n')
        deny('detail_binding_drift',detail_sql(selected),'Invented review detail binding refused')
        deny('page_binding_drift',queue_sql({'schemaVersion':1,'snapshotId':first['snapshotId'],'offset':0}),'Invented review detail binding refused')
        owner('update terra_private.correction_reports set details='+quote(intake.FIELDS['details'])+' where id='+quote(old_ids[0])+';','queue_restore_controlled_binding')
        assert owner('select to_jsonb(c) from terra_private.correction_reports c where id='+quote(old_ids[0])+';','queue_binding_restored')==before
        receipt_before=owner('select to_jsonb(r) from terra_correction_test_api.request_receipts r where report_id='+quote(old_ids[0])+';','queue_unicode_receipt_original')
        unicode_body='😀'*600
        owner('begin;update terra_private.correction_reports set details='+quote(unicode_body)+' where id='+quote(old_ids[0])+
            ';update terra_correction_test_api.request_receipts set fields=jsonb_set(fields,\'{details}\',to_jsonb('+quote(unicode_body)+'::text)) where report_id='+quote(old_ids[0])+';commit;','queue_controlled_unicode_result_fixture')
        unicode_reply=client(detail_sql(selected)); assert unicode_reply.returncode==0
        unicode_detail=checked_result('detail',selected,json.loads(unicode_reply.stdout))
        assert unicode_detail['draft']['fields']['details']==unicode_body
        private_file(proof/'QUEUE_CONTROLLED_UNICODE_RESULT.json',json.dumps({'codePoints':600,'utf16Units':1200,
            'ordinaryIntakeOfThisBodyClaimed':False,'detailRequest':selected,'result':unicode_detail},indent=2,ensure_ascii=False)+'\n')
        owner('begin;update terra_private.correction_reports set details='+quote(intake.FIELDS['details'])+' where id='+quote(old_ids[0])+
            ';update terra_correction_test_api.request_receipts set fields=jsonb_set(fields,\'{details}\',to_jsonb('+quote(intake.FIELDS['details'])+'::text)) where report_id='+quote(old_ids[0])+';commit;','queue_restore_unicode_result_fixture')
        assert owner('select to_jsonb(c) from terra_private.correction_reports c where id='+quote(old_ids[0])+';','queue_unicode_report_restored')==before
        assert owner('select to_jsonb(r) from terra_correction_test_api.request_receipts r where report_id='+quote(old_ids[0])+';','queue_unicode_receipt_restored')==receipt_before
        forged_id='c8a11111-1111-4111-8111-111111111111'
        owner('insert into terra_correction_test_api.queue_snapshots(id,principal,issue_id,report_ids,created_at,expires_at) values('+quote(forged_id)+','+quote(reviewer)+','+quote(projection['issueId'])+",array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[],clock_timestamp(),clock_timestamp()+interval '1 minute');",'queue_controlled_missing_member_ticket')
        deny('missing_member',queue_sql({'schemaVersion':1,'snapshotId':forged_id,'offset':0}),'Invented review detail unavailable')

        def expiry_wait(label,request,report_id,expire_scope=False):
            holder=session(actor_args(other,database),other_password); waiter=session(args,reviewer_password)
            hp=int(holder.execute('select pg_backend_pid();','HOLDERPID')[0]); wp=int(waiter.execute('select pg_backend_pid();','WAITERPID')[0])
            transition={'schemaVersion':1,'eventId':'c8a22222-2222-4222-8222-222222222222' if expire_scope else 'c8a33333-3333-4333-8333-333333333333',
                'reportId':report_id,'expectedState':'new','nextState':'in_review','resolutionNote':None}
            holder.execute('begin;'+review.review_sql(transition),'HELDREPORT')
            if expire_scope:
                owner('update terra_correction_test_api.reviewer_scopes set expires_at=clock_timestamp()+interval \'700 milliseconds\' where principal='+quote(reviewer)+';','queue_short_scope')
            waiter.send(queue_sql(request),'EXPIREDPAGE'); wait_block(wp,hp,label)
            time.sleep(.85)
            holder.execute('commit;' if expire_scope else 'rollback;','RELEASEDREPORT')
            try: waiter.until('EXPIREDPAGE')
            except RuntimeError:
                waiter.process.wait(timeout=5); assert waiter.process.returncode!=0
                assert any('scope' in error and ('expired' in error or 'refused' in error) for error in waiter.errors),waiter.errors
                private_file(proof/(label+'-refusal.log'),'\n'.join(waiter.errors)+'\n')
            else: raise ValueError('Expired blocked page accepted')
            retire_session(holder); retire_session(waiter)
        expiry_wait('QUEUE_SCOPE_EXPIRY_WAIT',{'schemaVersion':1,'snapshotId':first['snapshotId'],'offset':0},old_ids[0],expire_scope=True)
        owner('update terra_correction_test_api.reviewer_scopes set expires_at=clock_timestamp()+interval \'8 minutes\' where principal='+quote(reviewer)+';','queue_restore_scope_fixture')
        updated=page({'schemaVersion':1,'snapshotId':first['snapshotId'],'offset':0})
        assert [item['reportId'] for item in updated['items']]==[item['reportId'] for item in first['items']]
        assert updated['items'][0]['reviewState']=='in_review' and first['items'][0]['reviewState']=='new'
        short_id='c8a44444-4444-4444-8444-444444444444'
        owner('insert into terra_correction_test_api.queue_snapshots(id,principal,issue_id,report_ids,created_at,expires_at) values('+quote(short_id)+','+quote(reviewer)+','+quote(projection['issueId'])+',array['+quote(old_ids[1])+']::uuid[],clock_timestamp(),clock_timestamp()+interval \'700 milliseconds\');','queue_short_ticket_fixture')
        expiry_wait('QUEUE_TICKET_EXPIRY_WAIT',{'schemaVersion':1,'snapshotId':short_id,'offset':0},old_ids[1])
        deny('expired_ticket_detail',detail_sql({**selected,'snapshotId':short_id,'reportId':old_ids[1]}),'Invented review detail snapshot unavailable')
        owner('update terra_correction_test_api.reviewer_scopes set enabled=false where principal='+quote(reviewer)+';','queue_disable_scope')
        deny('disabled_ticket',queue_sql(first['next']),'Invented correction reviewer scope refused')
        deny('disabled_detail',detail_sql(selected),'Invented correction reviewer scope refused')
        owner('update terra_correction_test_api.reviewer_scopes set enabled=true where principal='+quote(reviewer)+';','queue_restore_enabled')
        # Retained, explicitly owner-seeded invented cap fixture; no ordinary
        # caller receives this DML authority, and no records are removed.
        target=wire['requests'][0]['draft']['target']
        owner('with added as (insert into terra_private.correction_reports(issue_id,publication_id,claim_id,report_kind,details,source_url) select '+
            quote(projection['issueId'])+'::uuid,'+quote(projection['publicationId'])+'::uuid,'+quote(target['claimId'])+'::uuid,'+
            quote(intake.FIELDS['kind'])+','+quote(intake.FIELDS['details'])+','+quote(intake.FIELDS['sourceUrl'])+
            ' from generate_series(1,60) returning id) insert into terra_correction_test_api.request_receipts(principal,request_id,target,fields,report_id,recorded_at) select '+
            quote(writer)+',gen_random_uuid(),'+quote(json.dumps(target))+'::jsonb,'+quote(json.dumps(intake.FIELDS))+'::jsonb,id,clock_timestamp() from added;','queue_owner_seeded_65_member_fixture')
        assert json.loads(counts())['reports']==65
        deny('65_members',queue_sql(START),'Invented review queue membership limit refused',selected=other_client)
        assert owner('select count(*) from terra_correction_test_api.queue_snapshots where principal='+quote(other)+';','queue_refused_cap_left_no_ticket')=='0'
        for action,sql in (('update','update terra_correction_test_api.queue_snapshots set expires_at=expires_at;'),('delete','delete from terra_correction_test_api.queue_snapshots;')):
            result=command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql)
            assert result.returncode!=0 and 'Invented review snapshot is immutable' in result.stderr
            private_file(proof/('QUEUE_OWNER_IMMUTABLE_'+action+'.log'),result.stdout+'\n'+result.stderr)
        state['recovery']=recovery.run_cases(owner=owner,proof=proof,reviewer=reviewer,other=other,
            client=client,other_client=other_client,other_session=lambda:session(actor_args(other,database),other_password),
            retire_session=retire_session,old_ids=old_ids)
        assert any(path.read_bytes()!=body for path,body in candidates.items()) is False
        state.update(complete=True,first=first,fresh=fresh,counts=json.loads(counts()))
        private_file(proof/'QUEUE_CHANGED_STATE_SAME_MEMBERSHIP.json',json.dumps({'before':first,'after':updated},indent=2)+'\n')

    def cleanup(owner):
        failures=[]
        for selected in list(state['sessions']):
            try: retire_session(selected)
            except BaseException as error: failures.append(type(error).__name__)
        for role in state['roles']:
            try:
                exists=owner('select exists(select 1 from pg_roles where rolname='+quote(role)+');','queue_role_exists',database='postgres')
                assert exists in ('t','f')
                if exists=='t':
                    sensitive_admin('alter role '+role+' nologin;')
                    assert owner('select rolcanlogin from pg_roles where rolname='+quote(role)+';','queue_role_retired',database='postgres')=='f'
            except BaseException as error: failures.append(type(error).__name__)
        if failures: raise RuntimeError('Queue cleanup requires retained-state inspection')
    with fixed_trial_guard(): result=trial(projection_observer=observe,trial_cleanup=cleanup)
    assert state['complete']
    receipt={'evidenceKind':'actual_invented_correction_queue_membership','observedAt':datetime.now(timezone.utc).isoformat(),
        'candidateSha256':pins,'counts':state['counts'],'firstCapturedMembers':4,'freshCapturedMembers':5,
        'lateCommitRequiresNewSnapshot':True,'frozenMembershipWithCurrentPageState':True,'rollbackLeftNoTicket':True,
        'actualScopeAndTicketExpiryWaits':True,'membershipCapRefusesWithoutTicket':True,'detailBindsStoredIntentAndTicket':True,
        'alternateInventedKindAndEmptySourceActuallyReadable':True,
        'concurrentLastSnapshotAllowanceEnforcedAfterCommit':True,
        'storedNonbreakingSpacesPreserved':True,'controlledUnicodeResultPreserved':True,'ordinaryUnicodeIntakeClaimed':False,
        'denials':state['denials'],'actualTypeScriptContractsChecked':True,'retainedOwnerCapFixtureReports':60,
        'readOnlyEventRecovery':state['recovery'],
        'actualSourceRequests':0,'modelCalls':0,'realReports':0,'primaryChanged':False,'liveReviewEnabled':False,
        'privacyPolicySelected':False,'publicContentChangedByQueue':False,'browserVerified':False,
        'temporaryAccountsRetired':True,'ownedCloneStopped':True,'privateEvidenceDirectory':result['privateEvidenceDirectory']}
    private_file(state['proof']/'CORRECTION_QUEUE_RESULT.json',json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2)); return 0


if __name__=='__main__': raise SystemExit(main())
