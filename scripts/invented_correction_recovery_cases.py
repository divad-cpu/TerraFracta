"""Read-only application-row recovery cases inside the owned fictional trial.

No standalone entry point, credential creation, real reports or retry dispatch.
The caller owns all ordinary sessions and their unconditional cleanup.
"""
from hashlib import sha256
import json
import time
from scripts.captured_fictional_pipeline import ROOT, private_file
from scripts.check_authenticated_capture_pipeline import command
from scripts.check_run_admission_concurrency import quote
from scripts import check_invented_correction_review as review

RECOVERY = ROOT/'research/pending/TF007_invented_correction_review_recovery.sql'


def lookup_sql(request):
    return 'select terra_correction_test_api.lookup_review_event('+quote(json.dumps(request))+'::jsonb);'


def checked_result(request, result):
    checked = command(['node','--experimental-strip-types','scripts/check_invented_correction_recovery_results.mjs'],
        data=json.dumps({'request':request,'result':result}),timeout=5)
    expected = {'schemaVersion':1,'evidenceKind':'checked_private_invented_recovery_contract',
                'sourceRequests':0,'liveReviewEnabled':False}
    if checked.returncode or len(checked.stdout.encode('utf-8'))>4096:
        raise ValueError('Invented recovery contract differs')
    actual = json.loads(checked.stdout)
    if type(actual) is not dict or actual != expected or type(actual.get('schemaVersion')) is not int \
        or type(actual.get('sourceRequests')) is not int or actual.get('liveReviewEnabled') is not False:
        raise ValueError('Invented recovery contract differs')
    return result


def run_cases(*, owner, proof, reviewer, other, client, other_client, other_session, retire_session, old_ids):
    # A committed start from the preceding genuine scope-expiry wait belongs
    # to Other. Commit closure without consuming its reply; then revoke writing.
    start = {'schemaVersion':1,'eventId':'c8a22222-2222-4222-8222-222222222222',
             'reportId':old_ids[0],'expectedState':'new','nextState':'in_review','resolutionNote':None}
    finish = {**start,'eventId':'c8a66666-6666-4666-8666-666666666666',
              'expectedState':'in_review','nextState':'closed','resolutionNote':review.NOTE}
    unconsumed = other_session()
    unconsumed.send('begin;'+review.review_sql(finish)+'commit;','RECOVERYUNCONSUMED')
    deadline = time.monotonic()+3
    while owner('select exists(select 1 from terra_correction_test_api.review_events where reviewer='+quote(other)+
                ' and event_id='+quote(finish['eventId'])+');','recovery_closure_commit')!='t':
        if time.monotonic()>=deadline: raise ValueError('Recovery unconsumed closure commit not observed')
        time.sleep(.025)
    retire_session(unconsumed)
    owner('revoke execute on function terra_correction_test_api.review_report(jsonb) from '+other+';','recovery_revoke_mutation')
    def row_bytes():
        return owner("select jsonb_build_object('reports',(select jsonb_agg(to_jsonb(c) order by id) from terra_private.correction_reports c),"
                     "'receipts',(select jsonb_agg(to_jsonb(r) order by principal,request_id) from terra_correction_test_api.request_receipts r),"
                     "'events',(select jsonb_agg(to_jsonb(e) order by report_id,sequence) from terra_correction_test_api.review_events e),"
                     "'publications',(select jsonb_agg(to_jsonb(p) order by id) from terra_private.issue_publications p),"
                     "'heads',(select jsonb_agg(to_jsonb(h) order by issue_id) from terra_private.issue_heads h));",'recovery_exact_rows')
    baseline = row_bytes(); results=[]; denials=[]
    def observe(label, request, selected=other_client):
        result = selected(lookup_sql(request)); assert result.returncode==0,label
        value=checked_result(request,json.loads(result.stdout)); assert row_bytes()==baseline,label
        results.append({'case':label,'request':request,'result':value}); return value
    closed=observe('closure_after_unconsumed_commit',finish)
    assert closed['outcome']=='recorded' and closed['current']['reviewState']=='closed'
    historical=observe('historical_start_with_current_closed',start)
    assert historical['outcome']=='recorded' and historical['recordedEvent']['toState']=='in_review' and historical['current']['reviewState']=='closed'
    missing={**start,'eventId':'c8a77777-7777-4777-8777-777777777777','reportId':old_ids[1]}
    absent=observe('never_dispatched_on_new_report',missing)
    assert absent['outcome']=='not_observed' and absent['current']['reviewState']=='new'
    private_actor=observe('same_event_id_different_principal',finish,selected=client)
    assert private_actor['outcome']=='not_observed' and private_actor['current']['reviewState']=='closed'
    def deny(label, request=None, *, sql=None, expected, selected=other_client):
        result=selected(sql if sql is not None else lookup_sql(request))
        assert result.returncode!=0 and expected in result.stderr,label
        assert row_bytes()==baseline,label
        denials.append(label); private_file(proof/('RECOVERY_DENIED_'+label+'.log'),result.stdout+'\n'+result.stderr)
    deny('mutation_privilege_revoked',sql=review.review_sql(missing),expected='permission denied')
    deny('same_own_event_conflict',{**finish,'reportId':old_ids[1]},expected='Invented review recovery request conflicts')
    deny('client_audit_time',{**start,'recordedAt':'2026-10-03T00:00:00Z'},expected='Invented review recovery input refused')
    deny('null_request',None,expected='Invented review recovery input refused')
    deny('invalid_uuid',{**start,'eventId':'c8a22222-2222-9222-8222-222222222222'},expected='Invented review recovery input refused')
    deny('missing_report',{**start,'reportId':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},expected='Invented review recovery report unavailable')
    deny('isolation',sql='begin isolation level repeatable read;'+lookup_sql(start),expected='Invented correction review isolation refused')
    owner('update terra_correction_test_api.reviewer_scopes set enabled=false where principal='+quote(other)+';','recovery_disabled_scope')
    deny('disabled_scope',start,expected='Invented correction reviewer scope refused')
    owner('update terra_correction_test_api.reviewer_scopes set enabled=true,expires_at=clock_timestamp()-interval \'1 second\' where principal='+quote(other)+';','recovery_expired_scope')
    deny('expired_scope',finish,expected='Invented correction reviewer scope refused')
    for broad in ('anon','authenticated','service_role','terra_collector','terra_operator','terra_reviewer','terra_issue_reader'):
        assert owner('select has_function_privilege('+quote(broad)+",'terra_correction_test_api.lookup_review_event(jsonb)','execute');",'recovery_broad_grant')=='f'
    private_file(proof/'RECOVERY_EXACT_ROW_BASELINE.json',baseline+'\n')
    private_file(proof/'RECOVERY_OBSERVATIONS.json',json.dumps(results,indent=2)+'\n')
    receipt={'evidenceKind':'actual_private_invented_review_receipt_lookup','observations':len(results),'denials':denials,
        'closureReplyNotConsumed':True,'writePrivilegeRevokedBeforeLookup':True,'exactApplicationRowsUnchangedByLookup':True,
        'historicalReceiptDidNotReopen':True,'missingEventDidNotDispatch':True,'crossPrincipalEventNotEnumerated':True,
        'applicationRowsSha256':sha256(baseline.encode()).hexdigest(),'actualSourceRequests':0,'liveReviewEnabled':False}
    private_file(proof/'CORRECTION_RECOVERY_RESULT.json',json.dumps(receipt,indent=2)+'\n')
    return receipt
