"""Fresh same-execution actual fictional workflow, using existing frozen APIs.

No arguments, web-triggered native setup, shared reader export, primary schema,
real report/source, contact, operational provider or publication activation.
The existing driver owns the stopped network-none clone and cleanup.
"""
from hashlib import sha256
import json
import secrets
import sys
from uuid import uuid4

from scripts import check_invented_correction_intake as intake
from scripts import check_invented_correction_reliability as reliability
from scripts import check_invented_correction_review as review
from scripts import check_invented_correction_queue as queue
from scripts import invented_correction_recovery_cases as recovery
from scripts.captured_fictional_pipeline import ROOT, private_file
from scripts.check_authenticated_capture_pipeline import command, sensitive_admin
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.fictional_workflow_consumer import FixedWorkflowConsumer
from scripts.run_authenticated_successor_pipeline import trial

EXPECTED_OPERATIONS = ['current','submit','queue','detail','review','recover','detail','review','detail','complete']


def main():
    if sys.argv[1:]: raise ValueError('Fixed fictional workflow takes no arguments')
    candidates = {path:path.read_bytes() for path in (intake.CANDIDATE,reliability.RELIABILITY,review.REVIEW,queue.QUEUE,recovery.RECOVERY)}
    if sha256(candidates[intake.CANDIDATE]).hexdigest() != 'f429be4fff02b48d07b841d2bc568b24d45f09e945b9ac64eab1b0597fd8953b':
        raise ValueError('Frozen intake identity differs')
    state = {'roles':[], 'complete':False}

    def observe(phase, projection, database, proof, owner):
        if any(path.read_bytes()!=body for path,body in candidates.items()): raise ValueError('Frozen correction candidate changed')
        if phase == 'first':
            for path,body in candidates.items(): private_file(proof/('EXACT_WORKFLOW_'+path.name),body.decode())
            owner('begin;'+''.join(body.decode() for body in candidates.values())+'commit;','workflow_frozen_candidates')
            return
        state['proof']=proof
        suffix=proof.name.removeprefix('authenticated-successor-')
        writer='terra_correction_successor_'+suffix
        reader='terra_correction_first_'+suffix
        reviewer='terra_correction_review_'+suffix
        passwords={role:secrets.token_urlsafe(48) for role in (writer,reader,reviewer)}
        for role in passwords:
            state['roles'].append(role)
            sensitive_admin('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(passwords[role])+';')
        owner('insert into terra_correction_test_api.principal_scopes values('+quote(writer)+','+quote(projection['issueId'])+
            ",clock_timestamp()+interval '8 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to "+writer+
            ';grant execute on function terra_correction_test_api.submit_request(jsonb) to '+writer+';','workflow_writer_scope')
        owner('insert into terra_correction_test_api.reviewer_scopes values('+quote(reviewer)+','+quote(projection['issueId'])+
            ",clock_timestamp()+interval '8 minutes',true);grant usage on schema terra_correction_test_api to "+reviewer+
            ';grant execute on function terra_correction_test_api.read_review_queue(jsonb),terra_correction_test_api.read_review_detail(jsonb),terra_correction_test_api.review_report(jsonb),terra_correction_test_api.lookup_review_event(jsonb) to '+reviewer+';','workflow_reviewer_scope')
        owner('grant usage on schema terra_private to '+reader+';grant execute on function terra_private.read_issue_candidate(text,text) to '+reader+';','workflow_fixed_reader_grant')
        wire=reliability.request_wire(projection)
        request=wire['requests'][0]
        execution_id=str(uuid4())
        publication_sql="select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from terra_private.issue_publications p;"
        publication_before=json.loads(owner(publication_sql,'workflow_publications_before'))
        if len(publication_before)!=2: raise ValueError('Fixed publication baseline differs')
        requests=[]; receipts=[]; intake_receipt=None; captured_queue=None; start_request=None
        def client(role,sql):
            args=review.reviewer_args(role,database) if role==reviewer else intake.client_args(role,database)
            result=command(args,data=passwords[role]+'\n'+sql,timeout=15)
            if result.returncode: raise ValueError('Fixed workflow ordinary command held')
            return json.loads(result.stdout)
        with FixedWorkflowConsumer(proof) as consumer:
            consumer.send({'schemaVersion':1,'evidenceKind':'owned_fictional_workflow_context','executionId':execution_id,'request':request})
            for expected in EXPECTED_OPERATIONS:
                message=consumer.receive()
                if type(message) is not dict or message.get('operation')!=expected: raise ValueError('Fixed workflow operation order differs')
                if expected=='complete':
                    if set(message)!= {'operation','state','checks','html','recovery'}: raise ValueError('Fixed workflow completion shape differs')
                    final=message;break
                if set(message)!= {'operation','request'}: raise ValueError('Fixed workflow command shape differs')
                selected=message['request'];requests.append(message)
                private_file(proof/('WORKFLOW_WIRE_COMMAND_'+str(len(requests)).zfill(2)+'.json'),json.dumps(message,indent=2)+'\n')
                outcome=None
                if expected=='current':
                    if selected is not None: raise ValueError('Fixed current read cannot take selectors')
                    raw=client(reader,"select terra_private.read_issue_candidate('fictional-country','fictional-share');")
                    checked=command(['node','--experimental-strip-types','scripts/check_public_candidate.mjs'],data=json.dumps(raw),timeout=5)
                    if checked.returncode: raise ValueError('Fixed workflow current materializer held')
                    result=json.loads(checked.stdout)
                    if result!=projection: raise ValueError('Fresh current projection differs')
                elif expected=='submit':
                    if selected!=request: raise ValueError('Fixed authored request differs')
                    result=client(writer,reliability.submit_sql(selected));intake_receipt=result;outcome='confirmed'
                elif expected=='queue':
                    if selected!=queue.START: raise ValueError('Fixed queue selection differs')
                    result=client(reviewer,queue.queue_sql(selected));captured_queue=result
                elif expected=='detail':
                    if selected!={'schemaVersion':1,'snapshotId':captured_queue['snapshotId'],'reportId':intake_receipt['reportId']}: raise ValueError('Fixed detail membership differs')
                    result=client(reviewer,queue.detail_sql(selected))
                elif expected=='review':
                    starting=start_request is None
                    fixed={'schemaVersion':1,'eventId':'c8a11111-1111-4111-8111-111111111111' if starting else 'c8a22222-2222-4222-8222-222222222222',
                        'reportId':intake_receipt['reportId'],'expectedState':'new' if starting else 'in_review',
                        'nextState':'in_review' if starting else 'closed','resolutionNote':None if starting else review.NOTE}
                    if selected!=fixed: raise ValueError('Fixed review command differs')
                    result=client(reviewer,review.review_sql(selected))
                    if starting: start_request=selected;outcome='unknown'
                    else: outcome='confirmed'
                elif expected=='recover':
                    if selected!=start_request: raise ValueError('Fixed historical lookup differs')
                    result=client(reviewer,recovery.lookup_sql(selected))
                receipts.append({'operation':expected,'request':selected,'result':result,'deliveredOutcome':outcome})
                private_file(proof/('WORKFLOW_WIRE_RECEIPT_'+str(len(receipts)).zfill(2)+'.json'),json.dumps(receipts[-1],indent=2)+'\n')
                consumer.send({'executionId':execution_id,'result':None if outcome=='unknown' else result,**({'outcome':outcome} if outcome else {})})
            consumer.finish()
            counts=json.loads(owner("select jsonb_build_object('reports',(select count(*) from terra_private.correction_reports),'requests',(select count(*) from terra_correction_test_api.request_receipts),'events',(select count(*) from terra_correction_test_api.review_events),'tickets',(select count(*) from terra_correction_test_api.queue_snapshots));",'workflow_exact_counts'))
            if counts!={'reports':1,'requests':1,'events':2,'tickets':1}: raise ValueError('Fixed workflow exact counts differ')
            if final['state']['executionId']!=execution_id or final['state']['detail']['report']['reviewState']!='closed': raise ValueError('Fixed workflow final identity differs')
            if owner('select current_publication_id from terra_private.issue_heads;','workflow_unchanged_publication')!=projection['publicationId']: raise ValueError('Report changed publication')
            publication_after=json.loads(owner(publication_sql,'workflow_publications_after'))
            if publication_after!=publication_before: raise ValueError('Report changed immutable publication rows')
            publication_binding={'rows':len(publication_before),'beforeSha256':sha256(json.dumps(publication_before,sort_keys=True).encode()).hexdigest(),
                'afterSha256':sha256(json.dumps(publication_after,sort_keys=True).encode()).hexdigest(),'exactlyUnchanged':True}
            private_file(proof/'WORKFLOW_PUBLICATION_BINDING.json',json.dumps(publication_binding,indent=2)+'\n')
            private_file(proof/'WORKFLOW_NATIVE_COMMANDS.json',json.dumps(requests,indent=2)+'\n')
            private_file(proof/'WORKFLOW_NATIVE_RECEIPTS.json',json.dumps(receipts,indent=2)+'\n')
            private_file(proof/'WORKFLOW_FINAL_STATE.json',json.dumps(final['state'],indent=2)+'\n')
            private_file(proof/'WORKFLOW_FINAL_PRESENTER.html',final['html'])
            recovered=final['recovery']
            recovery_receipt=next(item['result'] for item in receipts if item['operation']=='recover')
            if type(recovered) is not dict or set(recovered)!={'state','html'} or recovered['state']['executionId']!=execution_id or recovered['state']['recovery']!=recovery_receipt:
                raise ValueError('Fixed observed recovery identity differs')
            private_file(proof/'WORKFLOW_RECOVERY_STATE.json',json.dumps(recovered['state'],indent=2)+'\n')
            private_file(proof/'WORKFLOW_RECOVERY_PRESENTER.html',recovered['html'])
            state.update(complete=True,executionId=execution_id,counts=counts,checks={**final['checks'],'publicationRowsExactlyUnchanged':True})
    def cleanup(owner):
        failed=False
        for role in state['roles']:
            try:
                exists=owner('select exists(select 1 from pg_roles where rolname='+quote(role)+');','workflow_role_exists',database='postgres')
                if exists=='t':sensitive_admin('alter role '+role+' nologin;')
                elif exists!='f':failed=True
            except BaseException:failed=True
        predicate='rolname in('+','.join(map(quote,state['roles']))+')' if state['roles'] else 'false'
        remaining=owner('select count(*) from pg_roles where '+predicate+' and rolcanlogin;','workflow_roles_retired',database='postgres')
        if failed or remaining!='0':raise RuntimeError('Fixed workflow account retirement held')

    with fixed_trial_guard(): receipt=trial(projection_observer=observe,trial_cleanup=cleanup,isolated_reader=True)
    if not state['complete'] or not receipt['ownedCloneStopped'] or not receipt['temporaryAccountsRetired']:raise ValueError('Fixed workflow cleanup held')
    result={'evidenceKind':'actual_same_execution_fictional_correction_workflow','executionId':state['executionId'],
        'counts':state['counts'],'checks':state['checks'],'ownedCloneStopped':True,'temporaryAccountsRetired':True,
        'readerArchiveMode':receipt['readerArchiveMode'],'primaryChanged':False,'actualSourceRequests':0,'realReports':0,
        'browserVerified':False,'privateEvidenceDirectory':str(state['proof'])}
    private_file(state['proof']/'WORKFLOW_RESULT.json',json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
