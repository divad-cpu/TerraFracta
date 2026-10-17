"""Fresh invented observer read: explicit artifact AND both raw-stream scopes.

No operational disclosure policy, new account, primary, provider or context grant.
Native execution requires separate source-bound review and parent dispatch.
"""
from datetime import datetime,timezone
from dataclasses import asdict
from hashlib import sha256
from pathlib import Path
import ast,json,os,sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN
from scripts.rehearse_stream_reader import freeze_all
from scripts.rehearse_reopened_change import freeze_change
from scripts.rehearse_document_reference import freeze_reference,reference_profile
from scripts.rehearse_private_extraction import freeze_private,owner_query,private_profile
from scripts.rehearse_private_extraction_restore import seed_one,cold_document,private_defaults,decode_private_archive,ALL_SCHEMAS
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_collection_reader import restricted_inventory_statement
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER,committed_pg_json,_time
from workers.pair_native_sql import _literal
from workers.private_extraction_result import prepare_private_extraction_result
from workers.private_extraction_postgres import prepare_private_extraction_store,parse_stored_private_extraction_result
from workers.document_result_reopen import parse_reopened_document
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request
from workers.restricted_private_extraction_reader import read_restricted_private_extraction,restricted_private_extraction_statement,RestrictedPrivateExtractionReadError
ROOT=Path(__file__).resolve().parents[1]
ENTRY='scripts/rehearse_restricted_private_extraction_reader.py'
FIXTURE='tests/fixtures/invented_private_extraction_reader.sql'
NEW_TABLE='tf_feed_runtime.private_result_read_scopes'
NEW_FUNCTION='tf_feed_runtime.private_result_receipt'
TABLES=tuple(sorted(['tf_feed_rehearsal.'+n for n in('streams','pages','items','outcomes','document_results')]+['tf_feed_windows.collections','tf_feed_windows.windows','tf_feed_runtime.allowed_streams','tf_feed_runtime.allowed_collections','tf_private_extraction.results']))


def freeze_reader(trial):
    names={ENTRY,FIXTURE,'workers/restricted_private_extraction_reader.py'};queue=list(names);rows=[]
    while queue:
        name=queue.pop()
        if not name.endswith('.py'):continue
        for n in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(n,ast.ImportFrom)and n.module:
                child=n.module.replace('.','/')+'.py'
                if(ROOT/child).is_file()and child not in names and child not in trial.frozen:names.add(child);queue.append(child)
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Restricted reader dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb')as f:f.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw;row=dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest());rows.append(row);trial.source_bindings.append(row)
    trial.record('RESTRICTED_PRIVATE_SOURCE_BINDINGS',rows)
    trial.record('RESTRICTED_PRIVATE_INTENT',dict(newTables=1,newReadFunctions=1,newPrincipals=0,explicitPrivateArtifactAssignmentRequired=True,bothActualOriginalStreamScopesRequired=True,fullPreparationAndAssociationGranted=False,operationalDisclosurePolicy=False,primaryChanged=False))
    trial.verify_sources('RESTRICTED_PRIVATE_BEFORE_CREATE')
    if trial.counter!=0 or trial.identity is not None:raise FeedPgTrialError('Restricted reader freeze must precede native execution')


def row_statement(include_new=True):
    if type(include_new)is not bool:raise FeedPgTrialError('Fixed restricted snapshot scope required')
    names=sorted((*TABLES,NEW_TABLE))if include_new else list(TABLES);clauses=[]
    for name in names:
        clauses.append('select '+_literal(name)+"::text name,jsonb_build_object('rows',jsonb_array_length(body),'bytes',octet_length(body::text),'sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex'))receipt from(select coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),'[]'::jsonb)body from "+name+' r)scope')
    return 'begin isolation level repeatable read read only;select jsonb_object_agg(name,receipt order by name)from('+' union all '.join(clauses)+')whole;commit;'


def snapshot(trial,label,*,include_new=True):
    rows=json.loads(trial.query(row_statement(include_new)).stdout)
    if sorted(rows)!=sorted((*TABLES,NEW_TABLE)if include_new else TABLES):raise FeedPgTrialError('Restricted reader actual table set mismatch')
    trial.record(label,rows);return rows


def profile(trial,label):
    names=','.join(_literal(n)for n in ALL_SCHEMAS);where='n.nspname in('+names+')';value={}
    statements={
      'schemas':"select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text)order by nspname)from pg_namespace where nspname !~ '^pg_'and nspname<>'information_schema';",
      'tables':"select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity)order by n.nspname,c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'and "+where+';',
      'functions':"select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,'acl',p.proacl::text,'writer',has_function_privilege('tf_feed_lab_writer',p.oid,'EXECUTE'),'observer',has_function_privilege('tf_feed_lab_observer',p.oid,'EXECUTE'),'definitionSHA256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'))order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))from pg_proc p join pg_namespace n on n.oid=p.pronamespace where "+where+';',
      'constraints':"select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',p.conname,'type',p.contype,'validated',p.convalidated,'definition',pg_get_constraintdef(p.oid))order by n.nspname,c.relname,p.conname)from pg_constraint p join pg_class c on c.oid=p.conrelid join pg_namespace n on n.oid=c.relnamespace where "+where+';',
      'triggers':"select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))order by n.nspname,c.relname,t.tgname)from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and "+where+';',
      'policies':"select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',p.polname,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))order by n.nspname,c.relname,p.polname),'[]'::jsonb)from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where "+where+';',
      'defaults':"select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(defaclrole),'namespace',defaclnamespace::bigint,'type',defaclobjtype,'acl',defaclacl::text)order by defaclrole,defaclnamespace,defaclobjtype),'[]'::jsonb)from pg_default_acl;",
      'extra':"select jsonb_build_object('publicTables',(select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),'publicFunctions',(select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),'extensions',(select jsonb_agg(extname order by extname)from pg_extension),'events',(select count(*)from pg_event_trigger));"}
    for key,sql in statements.items():value[key]=json.loads(trial.query(sql).stdout)
    if [r['name']for r in value['schemas']]!=['public',*sorted(ALL_SCHEMAS)]or value['extra']!=dict(publicTables=0,publicFunctions=0,extensions=['plpgsql'],events=0):raise FeedPgTrialError('Restricted private whole scope unavailable')
    trial.record(label,value);return value


def validate_addition(before,after):
    stripped={k:([r for r in rows if r.get('name')!=NEW_FUNCTION]if k=='functions'else[r for r in rows if r.get('name')!=NEW_TABLE]if k=='tables'else[r for r in rows if r.get('table')!=NEW_TABLE]if k in('constraints','policies','triggers')else rows)for k,rows in after.items()}
    if stripped!=before:raise FeedPgTrialError('Private restricted overlay changed old objects')
    tables=[r for r in after['tables']if r['name']==NEW_TABLE];functions=[r for r in after['functions']if r['name']==NEW_FUNCTION];constraints=[r for r in after['constraints']if r['table']==NEW_TABLE]
    if(len(before['tables'])!=10 or len(after['tables'])!=11 or len(after['functions'])!=len(before['functions'])+1 or len(tables)!=1 or tables[0]['owner']!='tf_feed_lab_owner'or tables[0]['rls']is not True or tables[0]['acl']not in(None,'{tf_feed_lab_owner=arwdDxtm/tf_feed_lab_owner}')or len(functions)!=1):raise FeedPgTrialError('Restricted private new table/function scope unavailable')
    f=functions[0]
    if(f['owner']!='tf_feed_lab_owner'or f['definer']is not True or f['path']!=['search_path=pg_catalog']or f['writer']is not False or f['observer']is not True or f['acl']!='{tf_feed_lab_owner=X/tf_feed_lab_owner,tf_feed_lab_observer=X/tf_feed_lab_owner}'or len([c for c in constraints if c['type']=='f'and c['validated']and 'REFERENCES tf_private_extraction.results(operation_id)'in c['definition']])!=1 or not any(c['type']=='c'and c['validated']and 'tf_feed_lab_observer'in c['definition']for c in constraints)):raise FeedPgTrialError('Restricted private least-permission profile unavailable')


def assign(trial,roles,operation,enabled,label):
    sql=('insert into tf_feed_runtime.private_result_read_scopes(operation_id,reader_role)values('+_literal(operation)+"::uuid,'tf_feed_lab_observer');")if enabled else('delete from tf_feed_runtime.private_result_read_scopes where operation_id='+_literal(operation)+'::uuid;')
    owner_query(trial,roles,'begin;'+sql+'commit;')
    trial.record(label,dict(operation=operation,readerRole='tf_feed_lab_observer',assigned=enabled,explicitInventedOwnerDisclosure=True,sourceRightsOrFactualApproval=False))


def raw_scope(trial,roles,stream,enabled,label):
    sql=('insert into tf_feed_runtime.allowed_streams(stream_id)values('+_literal(stream)+'::uuid);')if enabled else('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(stream)+'::uuid;')
    owner_query(trial,roles,'begin;'+sql+'commit;');trial.record(label,dict(stream=stream,assigned=enabled,existingSharedWriterScope=True))


def cold_pair(trial,roles,scope,expectations,label):
    inventory=prepare_inventory_request(scope,item_limit=20)
    current=cold_document(trial,trial,roles,inventory,expectations[0],label+'_CURRENT')
    previous=cold_document(trial,trial,roles,inventory,expectations[1],label+'_PREVIOUS')
    return current,previous


def read(trial,roles,current,previous,operation,label,*,allowed=False):
    calls=[];ticks=[]
    def clock():
        at=datetime.now(timezone.utc);ticks.append(_time(at));return at
    def query(sql):
        output=roles.query('tf_feed_lab_observer',sql,allowed=True);calls.append(dict(statementSHA256=sha256(sql.encode()).hexdigest(),stdoutSHA256=sha256(output.stdout).hexdigest(),returncode=output.returncode))
        return WorkerOutput(output.stdout,output.stderr,output.returncode)
    try:
        result=read_restricted_private_extraction(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,operation_id=operation,maximum_output_tokens=100,query=query,utc_now=clock)
    except RestrictedPrivateExtractionReadError:
        trial.record(label+'_TRACE',dict(calls=calls,ticks=ticks,returned=False))
        if not allowed:raise
        trial.check(label+'_one_read_generic_hold',len(calls)==1 and len(ticks)==3 and calls[0]['returncode']!=0);return None
    trial.record(label+'_TRACE',dict(calls=calls,ticks=ticks,returned=True))
    if allowed:raise FeedPgTrialError('Restricted private expected hold absent')
    trial.check(label+'_one_private_read_after_confirmed_originals',len(calls)==1 and result.query_count==1 and len(ticks)==3)
    with(trial.proof/(label+'_REPORT.bin')).open('xb')as f:f.write(result.report_raw)
    with(trial.proof/(label+'_RECEIPT.bin')).open('xb')as f:f.write(result.reopened.full_receipt)
    return result


def deny_worker(trial,roles,current,previous,operation,label):
    before=snapshot(trial,label+'_BEFORE');read(trial,roles,current,previous,operation,label,allowed=True)
    trial.check(label+'_all_eleven_rows_unchanged',snapshot(trial,label+'_AFTER')==before)


def deny_sql(trial,label,sql,needle=b'permission denied'):
    before=snapshot(trial,label+'_BEFORE');output=trial.query(sql,allowed=True)
    trial.check(label+'_actual_refusal',output.returncode!=0 and needle in output.stderr)
    trial.check(label+'_all_eleven_rows_unchanged',snapshot(trial,label+'_AFTER')==before)


def measure_restore_candidate(trial):
    # Only measures a possible matching archive under the OLD strict decoder;
    # it is not a restore, never opens a second target and never widens a cap.
    trial.run(['docker','exec',trial.identity,'/bin/bash','-c','test -x /bin/gzip'])
    command=BIN+'pg_dump -h /tmp -U postgres -d postgres --format=c | /bin/gzip -c -9 -n'
    result=trial.run(['docker','exec',trial.identity,'/bin/bash','-o','pipefail','-c',command],timeout=20)
    if result.stderr:raise FeedPgTrialError('Restricted matching archive measurement unavailable')
    with(trial.proof/'RESTRICTED_PRIVATE_MATCHING_CANDIDATE.gz').open('xb')as f:f.write(result.stdout)
    meta=dict(gzipBytes=len(result.stdout),gzipSHA256=sha256(result.stdout).hexdigest(),matchingRestoreExecuted=False,decodedLimit=294912)
    try:custom=decode_private_archive(result.stdout)
    except FeedPgTrialError:meta.update(state='HELD_OLD_STRICT_ARCHIVE_LIMIT',customBytes=None,customSHA256=None)
    else:meta.update(state='FIT_ONLY_RESTORE_STILL_OPEN',customBytes=len(custom),customSHA256=sha256(custom).hexdigest())
    trial.record('RESTRICTED_PRIVATE_MATCHING_RESTORE_NEXT',meta)


def cases(trial):
    roles,scope,expectations,operation,receipt_sha=seed_one(trial)
    # Retain the explicit original metadata before any new nonowner read. This
    # is invented same-execution input, not an authenticated source assignment.
    documents=[]
    for binding,mapping,association in expectations:
        body=asdict(binding);body['retrieved_at']=_time(binding.retrieved_at)
        documents.append(dict(binding=body,mapping=asdict(mapping),association=asdict(association)))
    trial.record('RESTRICTED_PRIVATE_INDEPENDENT_READ_EXPECTATIONS',dict(schema_version=1,kind='invented_restricted_private_read_expectations',collection=asdict(scope),documents=documents,privateOperation=operation,receiptSHA256=receipt_sha,maximumOutputTokens=100,inventoryItemLimit=20,authenticatedSourceAssignment=False))
    # Qualify the unchanged old checks only before the additive fixture. Their
    # fixed scope is not weakened to accept the new table/function.
    old_checks=dict(base=reference_profile(trial.query),private=private_profile(trial.query),defaults=private_defaults(trial.query))
    trial.record('RESTRICTED_PRIVATE_OLD_CHECKS',old_checks)
    before_rows=snapshot(trial,'RESTRICTED_PRIVATE_BASE_ROWS',include_new=False);before_profile=profile(trial,'RESTRICTED_PRIVATE_BASE_PROFILE');role_bound=roles.bound
    trial.query('begin;'+trial.frozen[FIXTURE].decode()+'commit;');added_profile=profile(trial,'RESTRICTED_PRIVATE_ADDED_PROFILE');validate_addition(before_profile,added_profile)
    after_rows=snapshot(trial,'RESTRICTED_PRIVATE_EMPTY_ASSIGNMENT_ROWS')
    trial.check('RESTRICTED_PRIVATE_old_ten_rows_preserved_new_empty_permission_table',all(after_rows[n]==before_rows[n]for n in TABLES)and after_rows[NEW_TABLE]['rows']==0)
    current,previous=cold_pair(trial,roles,scope,expectations,'RESTRICTED_PRIVATE_FIRST_ORIGINALS')
    current_stream=current.reopened.request.feed.capture.stream_id;previous_stream=previous.reopened.request.feed.capture.stream_id
    trial.check('RESTRICTED_PRIVATE_fixture_two_distinct_actual_streams',current_stream!=previous_stream)
    trial.record('RESTRICTED_PRIVATE_ACTUAL_DOCUMENT_DEPENDENCIES',dict(operation=operation,currentDocumentOperation=current.reopened.result_request.operation_id,previousDocumentOperation=previous.reopened.result_request.operation_id,currentStream=current_stream,previousStream=previous_stream))
    # Both originals are already confirmed; raw scope alone must not disclose
    # an independently generated private output.
    deny_worker(trial,roles,current,previous,operation,'RESTRICTED_PRIVATE_NO_ARTIFACT_ASSIGNMENT')
    assign(trial,roles,operation,True,'RESTRICTED_PRIVATE_EXPLICIT_ASSIGNMENT')
    first=read(trial,roles,current,previous,operation,'RESTRICTED_PRIVATE_FIRST_ALLOWED')
    trial.check('RESTRICTED_PRIVATE_exact_owner_receipt_and_unverified_report',sha256(first.reopened.full_receipt).hexdigest()==receipt_sha and json.loads(first.report_raw)['review_state']=='unverified')
    # A second valid artifact over the SAME exact pair remains independently
    # withheld. This is why another stream assignment cannot encode this need.
    pair=prepare_reopened_document_change(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,observed_at=datetime.now(timezone.utc));request=compile_extraction_request(pair.current,pair.previous,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    output=json.loads(first.reopened.result.output_raw);output['proposed_assertion']='A separate explicitly invented private output.';second_operation=str(uuid4());at=datetime.now(timezone.utc)
    second=prepare_private_extraction_result(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,request=request,output_raw=json.dumps(output,ensure_ascii=False,separators=(',',':')).encode(),operation_id=second_operation,prepared_at=at,observed_at=at,maximum_output_tokens=100)
    store=prepare_private_extraction_store(second);second_output=owner_query(trial,roles,store.statement());second_raw=committed_pg_json(second_output.stdout,second_output.stderr,second_output.returncode);second_stored=parse_stored_private_extraction_result(second_raw,store,observed_at=datetime.now(timezone.utc))
    trial.record('RESTRICTED_PRIVATE_SECOND_WITHHELD_ARTIFACT',dict(operation=second_operation,artifactId=second_stored.artifact_id,receiptSHA256=sha256(second_raw).hexdigest(),sameCurrentDocument=store.result.current.result_request.operation_id,samePreviousDocument=store.result.previous.result_request.operation_id,assigned=False))
    deny_worker(trial,roles,current,previous,second_operation,'RESTRICTED_PRIVATE_OTHER_ARTIFACT_SAME_PAIR')
    deny_worker(trial,roles,current,previous,str(uuid4()),'RESTRICTED_PRIVATE_UNKNOWN_OPERATION')
    assign(trial,roles,operation,False,'RESTRICTED_PRIVATE_REVOKED_ARTIFACT')
    deny_worker(trial,roles,current,previous,operation,'RESTRICTED_PRIVATE_ARTIFACT_REVOKED_AFTER_ORIGINALS')
    # Raw access is still allowed after private assignment revocation. Only two
    # already-known original byte routes are exercised, not another full chain.
    from workers.feed_stream_reader import stream_document_original_statement
    for value,label in((current,'CURRENT'),(previous,'PREVIOUS')):
        result=roles.query('tf_feed_lab_observer',stream_document_original_statement(value.reopened.request))
        raw=committed_pg_json(result.stdout,result.stderr,result.returncode);again=parse_reopened_document(raw,value.reopened.request,observed_at=datetime.now(timezone.utc))
        trial.check('RESTRICTED_PRIVATE_'+label+'_raw_access_survives_artifact_revoke',again.result_request.document_raw==value.reopened.result_request.document_raw and again.artifact_id==value.reopened.artifact_id)
    assign(trial,roles,operation,True,'RESTRICTED_PRIVATE_REASSIGNED_ARTIFACT')
    for stream,label in((current_stream,'CURRENT'),(previous_stream,'PREVIOUS')):
        raw_scope(trial,roles,stream,False,'RESTRICTED_PRIVATE_'+label+'_RAW_REVOKE')
        deny_worker(trial,roles,current,previous,operation,'RESTRICTED_PRIVATE_MISSING_'+label+'_RAW_AFTER_ORIGINALS')
        raw_scope(trial,roles,stream,True,'RESTRICTED_PRIVATE_'+label+'_RAW_REASSIGN')
    raw_scope(trial,roles,current_stream,False,'RESTRICTED_PRIVATE_METADATA_ONLY_CURRENT_REVOKE');raw_scope(trial,roles,previous_stream,False,'RESTRICTED_PRIVATE_METADATA_ONLY_PREVIOUS_REVOKE')
    deny_worker(trial,roles,current,previous,operation,'RESTRICTED_PRIVATE_METADATA_ONLY')
    inv=roles.query('tf_feed_lab_observer',restricted_inventory_statement(prepare_inventory_request(scope,item_limit=20)))
    trial.check('RESTRICTED_PRIVATE_metadata_permission_survives_raw_denial',bool(committed_pg_json(inv.stdout,inv.stderr,inv.returncode)))
    raw_scope(trial,roles,current_stream,True,'RESTRICTED_PRIVATE_METADATA_CURRENT_REASSIGN');raw_scope(trial,roles,previous_stream,True,'RESTRICTED_PRIVATE_METADATA_PREVIOUS_REASSIGN')
    statement=restricted_private_extraction_statement(operation)
    deny_sql(trial,'RESTRICTED_PRIVATE_WRITER','set session authorization tf_feed_lab_writer;'+statement)
    deny_sql(trial,'RESTRICTED_PRIVATE_SET_ROLE_IS_NOT_OBSERVER_SESSION','set role tf_feed_lab_observer;'+statement,b'invented_private_reader_unavailable')
    deny_sql(trial,'RESTRICTED_PRIVATE_OWNER_NOT_OBSERVER_SESSION','set session authorization tf_feed_lab_owner;'+statement,b'invented_private_reader_unavailable')
    op=_literal(operation)+'::uuid'
    deny_sql(trial,'RESTRICTED_PRIVATE_READ_WRITE_CONTEXT','set session authorization tf_feed_lab_observer;begin isolation level repeatable read;select tf_feed_runtime.private_result_receipt('+op+');commit;',b'invented_private_reader_read_only_required')
    deny_sql(trial,'RESTRICTED_PRIVATE_READ_COMMITTED_CONTEXT','set session authorization tf_feed_lab_observer;begin read only;select tf_feed_runtime.private_result_receipt('+op+');commit;',b'invented_private_reader_read_only_required')
    for label,sql in [('OLD_OWNER_RECEIPT','select tf_private_extraction.result_receipt('+op+');'),('DIRECT_RESULTS','select *from tf_private_extraction.results;'),('DIRECT_ASSIGNMENTS','select *from tf_feed_runtime.private_result_read_scopes;'),('ASSIGNMENT_WRITE',"insert into tf_feed_runtime.private_result_read_scopes values("+op+",'tf_feed_lab_observer');")]:
        deny_sql(trial,'RESTRICTED_PRIVATE_DENY_'+label,'set session authorization tf_feed_lab_observer;begin;'+sql+'commit;')
    deny_sql(trial,'RESTRICTED_PRIVATE_ASSIGNMENT_FOREIGN_KEY',"begin;set local role tf_feed_lab_owner;insert into tf_feed_runtime.private_result_read_scopes values("+_literal(str(uuid4()))+"::uuid,'tf_feed_lab_observer');commit;",b'foreign key')
    deny_sql(trial,'RESTRICTED_PRIVATE_ASSIGNMENT_FIXED_READER',"begin;set local role tf_feed_lab_owner;insert into tf_feed_runtime.private_result_read_scopes values("+_literal(second_operation)+"::uuid,'tf_feed_lab_writer');commit;",b'check constraint')
    # Temp names cannot shadow fully qualified actual dependencies/helper. The
    # local temporary objects disappear at this fixed child session's exit.
    old=snapshot(trial,'RESTRICTED_PRIVATE_TEMP_BEFORE');temp=roles.query('tf_feed_lab_observer',"create temporary table private_result_read_scopes(operation_id uuid,reader_role text);create temporary table results(operation_id uuid);create temporary table allowed_streams(stream_id uuid);"+statement)
    trial.check('RESTRICTED_PRIVATE_temp_shadow_cannot_change_full_receipt',sha256(committed_pg_json(temp.stdout,temp.stderr,temp.returncode)).hexdigest()==receipt_sha and snapshot(trial,'RESTRICTED_PRIVATE_TEMP_AFTER')==old)
    final_rows=snapshot(trial,'RESTRICTED_PRIVATE_BEFORE_RESTART_ROWS');trial.check('RESTRICTED_PRIVATE_profiles_and_roles_exact_before_restart',profile(trial,'RESTRICTED_PRIVATE_BEFORE_RESTART_PROFILE')==added_profile and roles.bound==role_bound)
    del first,current,previous,second,store,pair,request
    trial.stop();trial.start();roles.verify()
    current,previous=cold_pair(trial,roles,scope,expectations,'RESTRICTED_PRIVATE_RESTART_ORIGINALS')
    final=read(trial,roles,current,previous,operation,'RESTRICTED_PRIVATE_RESTART_ALLOWED')
    trial.check('RESTRICTED_PRIVATE_restart_exact_receipt_unknown_output_and_profile_rows',sha256(final.reopened.full_receipt).hexdigest()==receipt_sha and snapshot(trial,'RESTRICTED_PRIVATE_FINAL_ROWS')==final_rows and profile(trial,'RESTRICTED_PRIVATE_FINAL_PROFILE')==added_profile)
    trial.record('RESTRICTED_PRIVATE_FINAL_ROLES',roles.bound)
    return dict(schemas=7,tables=11,readFunctionsAdded=1,permissionTablesAdded=1,actualPrivateArtifacts=2,assignedArtifacts=1,newPrincipals=0,originalReadResponses=28,positivePrivateReads=2,fullContextOrAppendedAssociationAccess=False,actualAuthentication=False,operationalDisclosurePolicy=False,matchingRestore=False,sourceRequests=0,modelCalls=0,primaryChanged=False,publication=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed restricted private trial accepts no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_reader(trial)
        trial.create();scope=cases(trial)
        try:measure_restore_candidate(trial)
        except Exception as error:trial.record('RESTRICTED_PRIVATE_MATCHING_RESTORE_HELD',dict(type=type(error).__name__,message='matching_archive_measurement_unavailable',restoreExecuted=False))
        trial.record('RESTRICTED_PRIVATE_RESULT',dict(state='PASS_INVENTED_RESTRICTED_PRIVATE_READER',assertions=trial.assertions,assertionCount=len(trial.assertions),scope=scope))
    except BaseException as error:
        trial.record('RESTRICTED_PRIVATE_FAILED',dict(type=type(error).__name__,message='invented_restricted_private_reader_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_RESTRICTED_PRIVATE')
        if trial.identity is not None:trial.record('RESTRICTED_PRIVATE_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(state='PASS_INVENTED_RESTRICTED_PRIVATE_READER',proof=str(trial.proof),assertions=len(trial.assertions),primaryChanged=False)))

if __name__=='__main__':main()
