"""One new owned two-table PDF preparation laboratory; never held capture."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from dataclasses import replace
import ast, base64, json, sys
from scripts import rehearse_pdf_result_custody as custody
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER
from workers.pair_native_sql import _literal
from workers.pdf_result_custody import prepare_pdf_result_custody, pdf_result_custody_read_statement
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody, PdfPreparationIntent, intent_metadata
from workers.pdf_preparation_postgres import (prepare_pdf_preparation_store,parse_stored_pdf_preparation,
    prepare_pdf_preparation_reopen,reopen_stored_pdf_preparation)
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json

ROOT=custody.ROOT
ENTRY='scripts/rehearse_pdf_preparation_custody.py'
SCHEMA='tests/fixtures/invented_pdf_preparation_custody.sql'
TEST='tests/test_pdf_preparation_custody_scope.py'
OPERATION='c2000000-0000-4000-8000-000000000001'
ROLLBACK='c2000000-0000-4000-8000-000000000002'


def project_closure(seeds):
    """Fixed source closure including module aliases, relative imports and init."""
    names=set(seeds);pending=list(names)
    def paths(module):
        parts=module.split('.')
        if not module or any(not p.isidentifier()for p in parts):return []
        found=[]
        for i in range(1,len(parts)+1):
            name='/'.join(parts[:i])+'/__init__.py'
            if(ROOT/name).is_file():found.append(name)
        name=module.replace('.','/')+'.py'
        if(ROOT/name).is_file():found.append(name)
        return found
    while pending:
        name=pending.pop();part=Path(name)
        if part.is_absolute()or '..'in part.parts or str(part)!=name:raise ValueError
        raw=(ROOT/name).read_bytes()
        if not name.endswith('.py'):continue
        parent=name.rsplit('/',1)[0].replace('/','.')if'/'in name else''
        for node in ast.walk(ast.parse(raw)):
            modules=[]
            if isinstance(node,ast.Import):modules=[v.name for v in node.names]
            elif isinstance(node,ast.ImportFrom):
                if node.level:
                    parts=parent.split('.')if parent else[];keep=len(parts)-node.level+1
                    if keep<0:raise ValueError
                    base='.'.join(parts[:keep]+([node.module]if node.module else[]))
                else:base=node.module or''
                modules=[base]+[(base+'.'if base else'')+v.name for v in node.names if v.name!='*']
            for module in modules:
                for child in paths(module):
                    if child not in names:names.add(child);pending.append(child)
    return names


def freeze_preparation(trial,extras=()):
    if trial.counter or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:raise custody.FeedPgTrialError('Preparation freeze requires no resource commands')
    names=project_closure({*trial.frozen,ENTRY,SCHEMA,TEST,'tests/test_pdf_preparation_postgres.py','workers/_pdf_text_worker.py','workers/native_parent_guard.py','pyproject.toml','uv.lock',*extras})
    rows=[]
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise custody.FeedPgTrialError('Preparation source changed')
            continue
        dest=trial.proof/'inputs'/name;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with dest.open('xb')as f:f.write(raw)
        dest.chmod(0o600);trial.frozen[name]=raw;rows.append(dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest()))
    trial.source_bindings.extend(rows);trial.record('PDF_PREPARATION_SOURCE_BINDINGS',rows)


class FreshPdfPreparation(custody.FreshPdfResultPostgres):
    def __init__(self):super().__init__();freeze_preparation(self)
    def bootstrap_schema(self):
        sql=self.frozen[custody.SCHEMA].decode('utf8')+self.frozen[SCHEMA].decode('utf8')
        self.query("begin;set local statement_timeout='10s';set local lock_timeout='1s';"+sql+'commit;')


def context(expected,receipt,at):
    """Explicit fictional support/head; native getter supplies only row identity."""
    row=json.loads(receipt);b=expected.current.binding;uid=lambda n:f'c1000000-0000-4000-8000-{n:012d}'
    return dict(schema_version=1,kind='invented_detached_extraction_context',snapshot_intent='single_claim_technical_review_not_issue_replacement',
        artifact=dict(operation_id=expected.operation_id,artifact_id=row['artifact_id'],request_sha256=expected.request.request_sha256,output_sha256=expected.output_sha256),
        held=dict(run_id=uid(1),decision_id=uid(2),item_key=b.item_key,source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator='selected-page',jurisdiction_id='fictional-region',decided_at=_stamp(at),disposition='held'),
        issue=dict(issue_id=uid(3),jurisdiction_id='fictional-region',jurisdiction_slug='fictional-region',issue_slug='invented-native-pdf-preparation',created_at='2026-10-01T00:00:00.000000Z',observed_at=_stamp(at),head=dict(publication_id=None,content_sha256=None,changed_at=None)),
        content=dict(capture_id=uid(4),claim_id=uid(5),title='Invented durable PDF preparation',summary='One detached proposed claim; no complete-issue replacement or support acceptance.',period_label='Separately supplied invented period',last_evidence_review_on='2026-10-17',review_date_basis='independently_supplied_not_inferred',publisher='Invented publisher',source_title='Invented supplied PDF document',source_published_on=None),
        support=dict(source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator='selected-page',assertion='An entirely invented condition requires independent editorial verification.',claim_type='condition',relation='supports',assignment_state='proposed_only'),
        translation=dict(display_language='en',status='unreviewed'))


def fingerprints(trial):
    sql="select jsonb_build_object('results',(select coalesce(jsonb_agg(jsonb_build_array(operation_id,artifact_id,stored_at,encode(sha256(intent),'hex'),encode(sha256(packet),'hex')) order by operation_id),'[]'::jsonb) from tf_pdf_result_rehearsal.results),'preparations',(select coalesce(jsonb_agg(jsonb_build_array(operation_id,artifact_id,result_operation_id,stored_at,encode(sha256(intent),'hex'),encode(sha256(packet),'hex')) order by operation_id),'[]'::jsonb) from tf_pdf_result_rehearsal.preparations));"
    return json.loads(custody.committed(trial,HEAD+'begin isolation level repeatable read read only;'+sql+'commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'))


def profile(trial):
    sql="""select jsonb_build_object(
      'schema_owner',(select pg_get_userbyid(nspowner) from pg_namespace where nspname='tf_pdf_result_rehearsal'),
      'public_schema_grants',(select count(*) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='tf_pdf_result_rehearsal' and a.grantee=0),
      'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname like 'tf_%'),
      'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tf_pdf_result_rehearsal' and c.relkind='r'),
      'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tf_pdf_result_rehearsal'),
      'policies',(select count(*) from pg_policies where schemaname='tf_pdf_result_rehearsal'),
      'public_table_grants',(select count(*) from information_schema.table_privileges where table_schema='tf_pdf_result_rehearsal' and grantee='PUBLIC'),
      'public_function_grants',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='tf_pdf_result_rehearsal' and a.grantee=0),
      'result_fk',(select count(*) from pg_constraint where conrelid='tf_pdf_result_rehearsal.preparations'::regclass and confrelid='tf_pdf_result_rehearsal.results'::regclass and contype='f'),
      'fk_index',(select count(*) from pg_indexes where schemaname='tf_pdf_result_rehearsal' and indexname='pdf_preparation_result_idx'),
      'append_only_triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='tf_pdf_result_rehearsal' and not t.tgisinternal and t.tgenabled='O'));
    """
    raw=custody.committed(trial,HEAD+'begin isolation level repeatable read read only;'+sql+'commit;\n\\echo '+COMMIT_MARKER.decode()+'\n');v=json.loads(raw)
    functions=['preparation_receipt','refuse_mutation','refuse_preparation_mutation','result_receipt','store_preparation','store_result']
    expected=dict(schema_owner='postgres',public_schema_grants=0,schemas=['tf_pdf_result_rehearsal'],tables=[dict(name=n,owner='postgres',rls=True)for n in ('preparations','results')],functions=[dict(name=n,owner='postgres',definer=False,config=['search_path=pg_catalog'])for n in functions],policies=0,public_table_grants=0,public_function_grants=0,result_fk=1,fk_index=1,append_only_triggers=4)
    if _json(v)!=_json(expected):raise custody.FeedPgTrialError('Preparation declared profile differs')
    return raw


def direct(intent,packet):
    args=','.join("decode("+_literal(base64.b64encode(p).decode())+",'base64')"for p in (intent,packet))
    sql=HEAD+'begin isolation level read committed read write;select tf_pdf_result_rehearsal.store_preparation('+args+');commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    if len(sql.encode())>294912:raise ValueError
    return sql


def refusal(trial,statement,state,message,before):
    result=trial.query('\\set VERBOSITY verbose\n'+statement,allowed=True)
    if result.returncode==0 or not custody.matches_native_refusal(result.stderr,state,message) or COMMIT_MARKER in result.stdout:raise custody.FeedPgTrialError('Preparation exact refusal differs')
    if fingerprints(trial)!=before:raise custody.FeedPgTrialError('Preparation refusal changed historical rows')
    return dict(sqlstate=state,message=message,stdoutBytes=len(result.stdout),uncommittedStdoutAdopted=False,rowsUnchanged=True)


def save(trial,name,raw):
    with(trial.proof/name).open('xb')as f:f.write(raw)
    (trial.proof/name).chmod(0o600)


def exercise(trial):
    packet,expected,_=custody._decode(trial.frozen[custody.FIXTURE])
    source=prepare_pdf_result_custody(packet,expected,observed_at=datetime.now(timezone.utc))
    custody.committed(trial,source.statement)
    result_receipt=custody.committed(trial,pdf_result_custody_read_statement(expected.operation_id))
    # Actual fresh source UUID/stored time precede all independently supplied
    # invented decisions. No old receipt/provenance is patched for this target.
    at=datetime.now(timezone.utc);ctx=context(expected,result_receipt,at);context_raw=_json(ctx)
    prepared=prepare_pdf_proposal_custody(result_receipt,expected,context_raw,intent_raw=source.canonical_intent,operation_id=OPERATION,observed_at=at)
    request=prepare_pdf_preparation_store(prepared)
    raw=custody.committed(trial,request.statement());stored=parse_stored_pdf_preparation(raw,request,observed_at=datetime.now(timezone.utc))
    if custody.committed(trial,request.statement())!=raw:raise custody.FeedPgTrialError('Preparation replay identity changed')
    reopen_expected=prepare_pdf_preparation_reopen(intent=prepared.intent,artifact_id=stored.artifact_id,stored_at=stored.stored_at,observed_at=datetime.now(timezone.utc))
    read=custody.committed(trial,reopen_expected.statement())
    if read!=raw:raise custody.FeedPgTrialError('Preparation complete getter differs')
    cold=reopen_stored_pdf_preparation(read,reopen_expected,receipt=result_receipt,extraction_expected=expected,intent_raw=source.canonical_intent,observed_at=datetime.now(timezone.utc))
    if cold.result.parts!=prepared.parts:raise custody.FeedPgTrialError('Preparation historical parts differ')
    save(trial,'PREPARATION_FULL_RECEIPT.json',raw);save(trial,'SOURCE_RESULT_FULL_RECEIPT.json',result_receipt)
    save(trial,'PREPARATION_INTENT.json',prepared.intent.canonical_metadata);save(trial,'SOURCE_RESULT_INTENT.json',source.canonical_intent);save(trial,'INDEPENDENT_CONTEXT.json',context_raw)
    trial.stop();trial.start()
    restart_raw=custody.committed(trial,reopen_expected.statement());restart_result=custody.committed(trial,pdf_result_custody_read_statement(expected.operation_id))
    if restart_raw!=raw or restart_result!=result_receipt:raise custody.FeedPgTrialError('Preparation restart changed either full receipt')
    restart_cold=reopen_stored_pdf_preparation(restart_raw,reopen_expected,receipt=restart_result,extraction_expected=expected,intent_raw=source.canonical_intent,observed_at=datetime.now(timezone.utc))
    if restart_cold.result.parts!=prepared.parts or restart_cold.stored!=stored:raise custody.FeedPgTrialError('Preparation restart cold history differs')
    before=fingerprints(trial)
    if len(before['results'])!=1 or len(before['preparations'])!=1:raise custody.FeedPgTrialError('Unexpected preparation rows')
    negatives=[]
    changed=json.loads(context_raw);changed['content']['summary']='A separately supplied alternative invented summary, still detached and unverified.'
    alternate=prepare_pdf_proposal_custody(result_receipt,expected,_json(changed),intent_raw=source.canonical_intent,operation_id=OPERATION,observed_at=prepared.observed_at)
    conflict=prepare_pdf_preparation_store(alternate)
    negatives.append(refusal(trial,conflict.statement(),'23505','invented_pdf_preparation_replay_conflict',before))
    metadata=intent_metadata(prepared.intent);metadata['operation_id']=ROLLBACK
    rollback=prepare_pdf_preparation_store(replace(prepared,intent=PdfPreparationIntent(_json(metadata))))
    negatives.append(refusal(trial,rollback.statement().replace('commit;','select 1/0;commit;'),'22012','division by zero',before))
    for statement in ["update tf_pdf_result_rehearsal.preparations set packet=packet;","delete from tf_pdf_result_rehearsal.preparations;","truncate tf_pdf_result_rehearsal.preparations;"]:
        negatives.append(refusal(trial,HEAD+'begin;'+statement+'commit;\n\\echo '+COMMIT_MARKER.decode()+'\n','55000','invented_pdf_preparation_append_only',before))
    negatives.append(refusal(trial,request.statement().replace('read committed','repeatable read'),'25001','invented_pdf_preparation_transaction_required',before))
    # Genuine source crosslink negatives are separately resealed as byte-only
    # probes; they are not claimed as valid full-original candidate producers.
    for field,value,state,message in [('extraction_operation_id','c2000000-0000-4000-8000-000000000099','23503','invented_pdf_preparation_result_missing'),('extraction_artifact_id','c2000000-0000-4000-8000-000000000098','22023','invented_pdf_preparation_crosslink_invalid')]:
        meta=intent_metadata(prepared.intent);meta[field]=value;intent=_json(meta);frame=json.loads(request.packet_raw);frame['intent_base64']=base64.b64encode(intent).decode()
        negatives.append(refusal(trial,direct(intent,_json(frame)),state,message,before))
    for label,mutate in [('current_packet',lambda p:p['current'].update(packet_sha256='f'*64)),('previous_packet',lambda p:p['previous'].update(packet_sha256='f'*64)),('receipt',lambda p:p.update(full_receipt_sha256='f'*64))]:
        frame=json.loads(request.packet_raw);proof=json.loads(base64.b64decode(frame['provenance_base64']));mutate(proof);proofraw=_json(proof);meta=intent_metadata(prepared.intent);meta['provenance_sha256']=sha256(proofraw).hexdigest();intent=_json(meta);frame.update(intent_base64=base64.b64encode(intent).decode(),provenance_base64=base64.b64encode(proofraw).decode())
        negatives.append(refusal(trial,direct(intent,_json(frame)),'22023','invented_pdf_preparation_crosslink_invalid',before))
    role="create role tf_pdf_preparation_probe nologin;set role tf_pdf_preparation_probe;select tf_pdf_result_rehearsal.preparation_receipt('"+OPERATION+"'::uuid);"
    negatives.append(refusal(trial,HEAD+role,'42501','permission denied for schema tf_pdf_result_rehearsal',before))
    actual_profile=profile(trial);save(trial,'PREPARATION_PROFILE.json',actual_profile);trial.record('PREPARATION_ROWS',before);trial.record('PREPARATION_NEGATIVES',negatives)
    archive=custody.export_archive(trial)
    restore=dict(kind='invented_pdf_preparation_restore_inputs',archive_base64=base64.b64encode((trial.proof/'PDF_RESULT_ARCHIVE.dump').read_bytes()).decode(),archive_sha256=archive['sha256'],result_independent_input_base64=base64.b64encode(trial.frozen[custody.FIXTURE]).decode(),result_receipt_base64=base64.b64encode(result_receipt).decode(),result_intent_base64=base64.b64encode(source.canonical_intent).decode(),preparation_receipt_base64=base64.b64encode(raw).decode(),preparation_intent_base64=base64.b64encode(prepared.intent.canonical_metadata).decode(),profile_base64=base64.b64encode(actual_profile).decode(),rows=before)
    trial.record('PREPARATION_RESTORE_INPUTS',restore)
    return dict(resultReceiptSHA256=sha256(result_receipt).hexdigest(),preparationReceiptSHA256=sha256(raw).hexdigest(),preparationArtifact=stored.artifact_id,preparationStoredAt=_stamp(stored.stored_at),negatives=len(negatives),archiveSHA256=archive['sha256'],sourceProfile='same_declared_two_table_lab_not_operational',captureExecuted=False)


def main():
    if sys.argv[1:]:print('pdf_preparation_arguments_refused',file=sys.stderr);return 2
    trial=None;result=None;failed=False;cleanup=[]
    try:
        trial=FreshPdfPreparation();trial.verify_sources('PREPARATION_BEFORE');trial.create();profile(trial)
        result=exercise(trial);trial.verify_sources('PREPARATION_AFTER')
    except Exception:failed=True
    finally:
        if trial is not None:
            for label,action in [('cluster_stopped',trial.stop),('initializer_stopped',trial.stop_initializer)]:
                try:action();cleanup.append(dict(check=label,status='PASS'))
                except Exception:failed=True;cleanup.append(dict(check=label,status='FAIL'))
            try:trial.record('PREPARATION_CLEANUP',cleanup);trial.verify_sources('PREPARATION_FINAL')
            except Exception:failed=True
    if failed or result is None:
        if trial is not None:
            try:trial.record('PREPARATION_FAILURE',dict(status='FAIL',code='pdf_preparation_trial_unavailable'))
            except Exception:pass
        print('pdf_preparation_trial_unavailable',file=sys.stderr);return 1
    trial.record('PREPARATION_RESULT',dict(status='PASS',scope='invented_two_table_pdf_preparation_custody_only',evidence=str(trial.proof),owned_resources_stopped=True,**result))
    print(json.dumps(dict(status='PASS',evidence=str(trial.proof))));return 0

if __name__=='__main__':raise SystemExit(main())
