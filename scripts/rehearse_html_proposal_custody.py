"""Manual fresh-owned HTML preparation byte custody, never held-capture authority.

The minimal two-original/one-result setup is inherited, not its adversarial suite.
All context is independently supplied invented correspondence, never DB trust.
"""
from __future__ import annotations
import ast,base64,json,os,sys
from dataclasses import asdict,replace
from datetime import datetime,timezone
from hashlib import sha256
from uuid import uuid4
from scripts import rehearse_html_extraction_custody as custody
from workers.html_proposal_custody import prepare_html_proposal_custody,intent_metadata
from workers.html_proposal_postgres import (prepare_html_proposal_store,parse_stored_html_proposal,
    prepare_html_preparation_reopen,reopen_stored_html_proposal,HtmlProposalPostgresError)
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json,_time
from workers.pair_native_sql import _literal

ROOT=custody.ROOT
ENTRY='scripts/rehearse_html_proposal_custody.py'
NEW_FILES=(ENTRY,'tests/test_html_proposal_custody_scope.py','workers/html_proposal_custody.py','tests/test_html_proposal_custody.py','workers/html_proposal_postgres.py','tests/test_html_proposal_postgres.py','tests/fixtures/invented_html_preparation.sql')
FreshFeedPostgres=custody.FreshFeedPostgres
FeedPgTrialError=custody.FeedPgTrialError
PREPARATION_SCHEMA='tf_html_preparation'


def freeze_preparation(trial):
    if trial.counter!=0 or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError('Preparation freeze must precede all resource commands')
    custody.freeze_extraction(trial) # one inherited runtime freeze, no old cases
    names=set(NEW_FILES);pending=list(names)
    while pending:
        name=pending.pop();body=custody.original._read(ROOT/name)
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(body)):
                modules=[node.module] if isinstance(node,ast.ImportFrom) and node.module else [n.name for n in node.names] if isinstance(node,ast.Import) else []
                for module in modules:
                    child=module.replace('.','/')+'.py'
                    if (ROOT/child).is_file() and child not in names:names.add(child);pending.append(child)
    rows=[]
    for name in sorted(names):
        body=custody.original._read(ROOT/name)
        if name in trial.frozen:
            if trial.frozen[name]!=body:raise FeedPgTrialError('Frozen source changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as stream:stream.write(body)
        path.chmod(0o600);trial.frozen[name]=body;rows.append(dict(path=name,bytes=len(body),sha256=sha256(body).hexdigest()))
    trial.source_bindings.extend(rows);trial.record('HTML_PREPARATION_SOURCE_BINDINGS',rows)


def install_preparation(trial):
    custody.install_extraction(trial)
    trial.query("begin;set local statement_timeout='10s';"+trial.frozen['tests/fixtures/invented_html_preparation.sql'].decode()+'commit;')


def profile(trial,schema):
    if schema not in ('tf_feed_rehearsal','tf_html_rehearsal','tf_html_extraction',PREPARATION_SCHEMA):raise FeedPgTrialError('Fixed schema only')
    return json.loads(trial.query('begin isolation level repeatable read read only;'+custody.original.PROFILE_SQL.replace('SCHEMA',_literal(schema))+'commit;').stdout)


def expected_profile(value):
    if value['schema']['name']!=PREPARATION_SCHEMA or value['schema']['owner']!='postgres' or len(value['tables'])!=1:return False
    table=value['tables'][0];expected={'preparation_receipt':('p_operation uuid','jsonb'),'refuse_mutation':('','trigger'),
        'store_preparation':('p_metadata bytea, p_payload bytea, p_selection bytea, p_provenance bytea, p_context bytea','jsonb')}
    return (table['name']=='preparations' and table['owner']=='postgres' and table['rls'] and not table['forced'] and table['policies']==[]
        and [c['name'] for c in table['columns']]==['operation_id','artifact_id','extraction_operation_id','metadata','payload_raw','selection_raw','provenance_raw','context_raw','stored_at']
        and not any(c['acl'] for c in table['columns']) and all(c['notnull'] for c in table['columns'])
        and [(r['name'],r['kind'],r['owner'],r['persistence']) for r in value['objects']]==[('preparations','r','postgres','p'),('preparations_artifact_id_key','i','postgres','p'),('preparations_pkey','i','postgres','p')]
        and len(table['constraints'])==14 and all(c['validated'] for c in table['constraints'])
        and sorted(c['kind'] for c in table['constraints'])==['c']*11+['f','p','u']
        and len(table['triggers'])==1 and table['triggers'][0]['name']=='detached_preparation_append_only' and table['triggers'][0]['enabled']=='O'
        and len(value['functions'])==3 and {f['name'] for f in value['functions']}==set(expected)
        and all((f['args'],f['result'])==expected[f['name']] and f['owner']=='postgres' and not f['definer'] and f['volatility']=='v' and f['config']==['search_path=pg_catalog'] for f in value['functions'])
        and bool(value['privileges']) and all(r['grantee']==r['grantor']=='postgres' for r in value['privileges']))


def full_rows(trial):
    base=custody.full_rows(trial)
    sql="begin isolation level repeatable read read only;select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'extraction_operation_id',extraction_operation_id,'metadata_sha256',encode(sha256(metadata),'hex'),'payload_sha256',encode(sha256(payload_raw),'hex'),'selection_sha256',encode(sha256(selection_raw),'hex'),'provenance_sha256',encode(sha256(provenance_raw),'hex'),'context_sha256',encode(sha256(context_raw),'hex'),'stored_at',stored_at) order by operation_id),'[]'::jsonb) from tf_html_preparation.preparations;commit;"
    return dict(**base,preparation=json.loads(trial.query(sql).stdout))


def direct(values):
    if type(values) is not tuple or len(values)!=5 or any(type(raw) is not bytes for raw in values):raise FeedPgTrialError('Fixed five byte operands required')
    if any(not 1<=len(raw)<=limit for raw,limit in zip(values,(4096,16384,2048,65536,32768))):raise FeedPgTrialError('Preparation operand bounds refused')
    sql=HEAD+"set time zone 'UTC';begin isolation level read committed read write;select tf_html_preparation.store_preparation("+','.join("decode("+_literal(base64.b64encode(raw).decode())+",'base64')" for raw in values)+');commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    if len(sql.encode())>294912:raise FeedPgTrialError('Preparation pipe bound refused')
    return sql


def invented_context(extraction_expected):
    """Independent fixed editorial inputs; do not derive support from output."""
    source=extraction_expected.current_expected.document
    metadata=json.loads(extraction_expected.canonical_metadata)
    decided=datetime.now(timezone.utc);head_observed=datetime.now(timezone.utc)
    return dict(schema_version=1,kind='invented_detached_extraction_context',snapshot_intent='single_claim_technical_review_not_issue_replacement',
        artifact=dict(operation_id=extraction_expected.operation_id,artifact_id=extraction_expected.artifact_id,
            request_sha256=metadata['request_sha256'],output_sha256=metadata['output_sha256']),
        held=dict(run_id=str(uuid4()),decision_id=str(uuid4()),item_key=source.item_key,source_version_id=source.source_version_id,
            content_sha256=source.content_sha256,locator='article:one',jurisdiction_id='fictional-region',decided_at=_time(decided),disposition='held'),
        issue=dict(issue_id=str(uuid4()),jurisdiction_id='fictional-region',jurisdiction_slug='fictional-region',issue_slug='invented-html-issue',
            created_at='2020-01-01T00:00:00.000000Z',observed_at=_time(head_observed),head=dict(publication_id=None,content_sha256=None,changed_at=None)),
        content=dict(capture_id=str(uuid4()),claim_id=str(uuid4()),title='Invented HTML review candidate',summary='A detached unverified technical example.',
            period_label='Independently supplied period',last_evidence_review_on=head_observed.date().isoformat(),review_date_basis='independently_supplied_not_inferred',
            publisher='Invented publisher',source_title='Invented HTML source',source_published_on=None),
        support=dict(source_version_id=source.source_version_id,content_sha256=source.content_sha256,locator='article:one',
            assertion='An invented source statement remains unverified.',claim_type='condition',relation='supports',assignment_state='proposed_only'),
        translation=dict(display_language=extraction_expected.current_expected.binding.language_code,status='unreviewed'))


def prepare_one(trial):
    """Return only independent selectors and full SHA, never prepared bodies."""
    extraction_expected,_,_=custody.store_pair_and_result(trial)
    _,extraction,current,previous=custody.cold_read(trial,extraction_expected)
    trial.record('HTML_PREPARATION_PREREQUISITE_ROWS',custody.full_rows(trial))
    context_raw=json.dumps(invented_context(extraction_expected),indent=2,ensure_ascii=False).encode()+b'\n'
    prepared=prepare_html_proposal_custody(extraction,extraction_expected,context_raw,current_receipt=current,previous_receipt=previous,
        operation_id=str(uuid4()),observed_at=datetime.now(timezone.utc))
    request=prepare_html_proposal_store(prepared)
    receipt=custody.original.committed(trial,request.statement())
    stored=parse_stored_html_proposal(receipt,request,observed_at=datetime.now(timezone.utc))
    expected=prepare_html_preparation_reopen(intent=prepared.intent,artifact_id=stored.artifact_id,stored_at=stored.stored_at,observed_at=datetime.now(timezone.utc))
    (trial.proof/'HTML_PREPARATION_FULL_RECEIPT.json').write_bytes(receipt)
    for name,raw in [('INTENT',prepared.intent.canonical_metadata),('PAYLOAD',prepared.parts.payload_raw),('SELECTION',prepared.parts.selection_raw),('PROVENANCE',prepared.parts.provenance_raw),('CONTEXT',prepared.parts.context_raw)]:
        (trial.proof/('HTML_PREPARATION_'+name+'.json')).write_bytes(raw)
    trial.record('HTML_PREPARATION_INDEPENDENT_EXPECTATIONS',custody._json_value(asdict(expected)))
    return expected,extraction_expected,sha256(receipt).hexdigest()


def cold_read(trial,expected,extraction_expected):
    _,extraction,current,previous=custody.cold_read(trial,extraction_expected)
    preparation=custody.original.committed(trial,expected.statement())
    reopened=reopen_stored_html_proposal(preparation,expected,extraction_receipt=extraction,extraction_expected=extraction_expected,
        current_receipt=current,previous_receipt=previous,observed_at=datetime.now(timezone.utc))
    return reopened,preparation,extraction,current,previous


def cases(trial):
    feed=profile(trial,'tf_feed_rehearsal');principal=custody.original.roles(trial)
    install_preparation(trial)
    profiles={schema:profile(trial,schema) for schema in ('tf_html_rehearsal','tf_html_extraction',PREPARATION_SCHEMA)}
    trial.record('HTML_PREPARATION_INSTALLED_PROFILES',dict(profiles=profiles,feed=feed,roles=principal))
    trial.check('new_preparation_exact_owner_inventory',expected_profile(profiles[PREPARATION_SCHEMA]))
    trial.check('seven_tables_initially_empty',full_rows(trial)==dict(feed=[0,0,0,0],html=[],extraction=[],preparation=[]))
    expected,extraction_expected,receipt_sha=prepare_one(trial);baseline=full_rows(trial)
    source_rows=json.loads(custody.original._read(trial.proof/'HTML_PREPARATION_PREREQUISITE_ROWS.json'))
    trial.check('only_preparation_added_to_two_original_one_result_prerequisite',len(baseline['preparation'])==1 and len(baseline['html'])==2 and len(baseline['extraction'])==1 and baseline['feed']==[0,0,0,0] and {key:baseline[key] for key in source_rows}==source_rows)
    reopened,receipt,extraction,current,previous=cold_read(trial,expected,extraction_expected)
    metadata=intent_metadata(expected.intent)
    trial.check('full_stored_preparation_read_byte_exact',sha256(receipt).hexdigest()==receipt_sha and reopened.stored.artifact_id==expected.artifact_id
        and sha256(reopened.result.parts.context_raw).hexdigest()==metadata['context_raw_sha256'] and reopened.result.parts.context_raw.endswith(b'\n'))
    value=json.loads(receipt);operands=tuple(base64.b64decode(value[key],validate=True) for key in ('metadata_base64','payload_base64','selection_base64','provenance_base64','context_base64'))
    trial.check('full_five_operand_committed_replay',custody.original.committed(trial,direct(operands))==receipt and full_rows(trial)==baseline)
    for label,index in [('metadata',0),('payload',1),('selection',2),('provenance',3),('context',4),('cross_extraction',0),('operation_reuse',0)]:
        changed=list(operands)
        if label=='metadata':
            meta=json.loads(changed[0]);meta['kind']='foreign';changed[0]=json.dumps(meta,sort_keys=True,separators=(',',':')).encode()
        elif label=='cross_extraction':
            meta=json.loads(changed[0]);meta['extraction_operation_id']=str(uuid4());changed[0]=json.dumps(meta,sort_keys=True,separators=(',',':')).encode()
        elif label=='operation_reuse':changed[0]=json.dumps(json.loads(changed[0]),indent=2).encode()
        else:changed[index]+=b' '
        failed=trial.query(direct(tuple(changed)),allowed=True)
        trial.check(label+'_native_refused_without_row_effect',failed.returncode!=0 and b'invented_html_preparation_unavailable' in failed.stderr and full_rows(trial)==baseline)
    for action in ('update tf_html_preparation.preparations set metadata=metadata','delete from tf_html_preparation.preparations'):
        failed=trial.query(HEAD+'begin;'+action+';commit;',allowed=True)
        trial.check('preparation_append_only_'+action.split()[0],failed.returncode!=0 and b'invented_html_preparation_append_only' in failed.stderr and full_rows(trial)==baseline)
    late=list(operands);meta=json.loads(late[0]);meta['operation_id']=str(uuid4());late[0]=json.dumps(meta,sort_keys=True,separators=(',',':')).encode()
    injected=direct(tuple(late)).replace('commit;\n',"select jsonb_build_object('late_visible',(select count(*) from tf_html_preparation.preparations where operation_id="+_literal(meta['operation_id'])+"::uuid));select 1/0;commit;\n")
    failed=trial.query(injected,allowed=True);lines=failed.stdout.splitlines()
    trial.check('actual_preparation_visible_before_outer_transaction_fault',failed.returncode!=0 and len(lines)==2 and json.loads(lines[1])==dict(late_visible=1) and COMMIT_MARKER not in failed.stdout)
    try:committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    except ValueError:trial.check('faulted_preparation_receipt_withheld',True)
    else:trial.check('faulted_preparation_receipt_withheld',False)
    trial.check('separate_connection_full_rollback',full_rows(trial)==baseline)
    del reopened,receipt,extraction,current,previous,value,operands,changed,late
    trial.stop();trial.start()
    cold,receipt,extraction,current,previous=cold_read(trial,expected,extraction_expected)
    trial.check('cold_four_fresh_receipts_preserve_historical_preparation',sha256(receipt).hexdigest()==receipt_sha and _time(cold.result.prepared_at)==metadata['prepared_at']
        and cold.result.parts.provenance_raw==base64.b64decode(json.loads(receipt)['provenance_base64'],validate=True)
        and cold.result.evidence_state=='invented_html_historical_preparation_not_current_qualification_or_capture')
    try:reopen_stored_html_proposal(receipt,replace(expected,artifact_id=str(uuid4())),extraction_receipt=extraction,extraction_expected=extraction_expected,
            current_receipt=current,previous_receipt=previous,observed_at=datetime.now(timezone.utc))
    except HtmlProposalPostgresError:trial.check('cold_independent_preparation_selection_hold_all_or_none',True)
    else:trial.check('cold_independent_preparation_selection_hold_all_or_none',False)
    trial.check('seven_table_hashes_full_profiles_and_principals_exact',full_rows(trial)==baseline and all(profile(trial,schema)==before for schema,before in profiles.items())
        and profile(trial,'tf_feed_rehearsal')==feed and custody.original.roles(trial)==principal)
    trial.record('HTML_PREPARATION_FINAL_ROWS',baseline)
    trial.record('HTML_PREPARATION_COLD_BINDINGS',dict(preparation=sha256(receipt).hexdigest(),extraction=sha256(extraction).hexdigest(),currentOriginal=sha256(current).hexdigest(),previousOriginal=sha256(previous).hexdigest(),preparedAt=metadata['prepared_at'],reobservedAt=_time(cold.observed_at)))
    return dict(storedOriginals=2,storedExtractions=1,storedPreparations=1,heldCaptures=0,feedProcessed=0,sourceRequests=0,modelCalls=0,publicationEnabled=False,ordinaryRestartOnly=True)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed HTML preparation trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_preparation(trial);trial.create();result=cases(trial)
        trial.record('HTML_PREPARATION_RESULT',dict(state='PASS_BOUNDED_INVENTED_HTML_PREPARATION_CUSTODY',assertions=trial.assertions,**result))
    except BaseException as error:
        trial.record('HTML_PREPARATION_FAILURE',dict(state='held',exceptionClass=type(error).__name__,preserved=True));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:
                trial.verify_sources('HTML_PREPARATION_FINAL')
                if hasattr(trial,'html_runtime'):custody.original.verify_runtime(trial,'PREPARATION_FINAL')
        if trial.identity is not None:trial.record('HTML_PREPARATION_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_BOUNDED_INVENTED_HTML_PREPARATION_CUSTODY',primaryChanged=False)))


if __name__=='__main__':main()
