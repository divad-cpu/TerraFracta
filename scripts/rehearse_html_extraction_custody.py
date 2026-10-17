"""Manual fixed fresh-owned HTML extraction byte custody, never a provider route.

Original stores are prerequisites only. SQL holds opaque asserted metadata; cold
Python reopening rederives both HTML originals and the complete exact request.
"""
from __future__ import annotations
import ast,base64,json,os,sys
from dataclasses import asdict,replace
from datetime import datetime,timezone
from hashlib import sha256
from uuid import uuid4

from scripts import rehearse_html_original_custody as original
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json,_time
from workers.html_original_custody import parse_stored_html_original,prepare_html_original_reopen
from workers.html_extraction_custody import (prepare_html_extraction_store,parse_stored_html_extraction,prepare_html_extraction_reopen,reopen_html_extraction,HtmlExtractionCustodyError)
from workers.stored_html_change import compile_stored_html_request
from workers.html_private_extraction import prepare_html_private_extraction
from workers.pair_native_sql import _literal

ROOT=original.ROOT
ENTRY='scripts/rehearse_html_extraction_custody.py'
NEW_FILES=(ENTRY,'tests/test_html_extraction_custody_scope.py','workers/html_extraction_custody.py','tests/test_html_extraction_custody.py','tests/fixtures/invented_html_extraction.sql')
FreshFeedPostgres=original.FreshFeedPostgres
FeedPgTrialError=original.FeedPgTrialError


def freeze_extraction(trial):
    if trial.counter!=0 or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError('Freeze must precede every resource command')
    original.freeze_html(trial) # exactly once: inherits the fixed runtime and notices
    names=set(NEW_FILES);pending=list(names)
    while pending:
        name=pending.pop();body=original._read(ROOT/name)
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(body)):
                modules=[node.module] if isinstance(node,ast.ImportFrom) and node.module else [n.name for n in node.names] if isinstance(node,ast.Import) else []
                for module in modules:
                    child=module.replace('.','/')+'.py'
                    if (ROOT/child).is_file() and child not in names:names.add(child);pending.append(child)
    rows=[]
    for name in sorted(names):
        body=original._read(ROOT/name)
        if name in trial.frozen:
            if trial.frozen[name]!=body:raise FeedPgTrialError('Frozen source changed')
            continue
        dest=trial.proof/'inputs'/name;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with dest.open('xb') as stream:stream.write(body)
        dest.chmod(0o600);trial.frozen[name]=body;rows.append(dict(path=name,bytes=len(body),sha256=sha256(body).hexdigest()))
    trial.source_bindings.extend(rows);trial.record('HTML_EXTRACTION_SOURCE_BINDINGS',rows)


def install_extraction(trial):
    for name in ('tests/fixtures/invented_html_originals.sql','tests/fixtures/invented_html_extraction.sql'):
        trial.query("begin;set local statement_timeout='10s';"+trial.frozen[name].decode()+'commit;')


def profile(trial,schema):
    if schema not in ('tf_feed_rehearsal','tf_html_rehearsal','tf_html_extraction'):raise FeedPgTrialError('Fixed schema only')
    return json.loads(trial.query('begin isolation level repeatable read read only;'+original.PROFILE_SQL.replace('SCHEMA',_literal(schema))+'commit;').stdout)


def expected_profile(value):
    if value['schema']['name']!='tf_html_extraction' or value['schema']['owner']!='postgres' or len(value['tables'])!=1:return False
    table=value['tables'][0]
    expected={'refuse_mutation':('','trigger'),'result_receipt':('p_operation uuid','jsonb'),'store_result':('p_metadata bytea, p_request bytea, p_output bytea','jsonb')}
    return (table['name']=='results' and table['owner']=='postgres' and table['rls'] and not table['forced'] and table['policies']==[]
        and [c['name'] for c in table['columns']]==['operation_id','artifact_id','current_operation_id','previous_operation_id','metadata','request_raw','output_raw','stored_at']
        and not any(c['acl'] for c in table['columns']) and all(c['notnull'] for c in table['columns'])
        and [(r['name'],r['kind'],r['owner'],r['persistence']) for r in value['objects']]==[('results','r','postgres','p'),('results_artifact_id_key','i','postgres','p'),('results_pkey','i','postgres','p')]
        and len(table['constraints'])==9 and all(c['validated'] for c in table['constraints'])
        and sorted(c['kind'] for c in table['constraints'])==['c','c','c','c','c','f','f','p','u']
        and len(table['triggers'])==1 and table['triggers'][0]['name']=='html_extraction_append_only' and table['triggers'][0]['enabled']=='O'
        and len(value['functions'])==3 and {f['name'] for f in value['functions']}==set(expected)
        and all((f['args'],f['result'])==expected[f['name']] and f['owner']=='postgres' and not f['definer'] and f['volatility']=='v' and f['config']==['search_path=pg_catalog'] for f in value['functions'])
        and bool(value['privileges']) and all(r['grantee']==r['grantor']=='postgres' for r in value['privileges']))


def full_rows(trial):
    base=original.rows(trial)
    result=trial.query("begin isolation level repeatable read read only;select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'current_operation_id',current_operation_id,'previous_operation_id',previous_operation_id,'metadata_sha256',encode(sha256(metadata),'hex'),'request_sha256',encode(sha256(request_raw),'hex'),'output_sha256',encode(sha256(output_raw),'hex'),'stored_at',stored_at) order by operation_id),'[]'::jsonb) from tf_html_extraction.results;commit;")
    return dict(**base,extraction=json.loads(result.stdout))


def direct(metadata,request,output):
    operands=','.join('decode('+_literal(base64.b64encode(v).decode())+",'base64')" for v in (metadata,request,output))
    sql=HEAD+"set time zone 'UTC';begin isolation level read committed read write;select tf_html_extraction.store_result("+operands+');commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    if sum(map(len,(metadata,request,output)))>155648 or len(sql.encode())>294912:raise FeedPgTrialError('Fixed extraction pipe bound refused')
    return sql


def _json_value(value):
    if isinstance(value,datetime):return _time(value)
    if type(value) is bytes:return dict(base64=base64.b64encode(value).decode())
    if type(value) is dict:return {key:_json_value(item) for key,item in value.items()}
    if type(value) in (tuple,list):return [_json_value(item) for item in value]
    return value


def store_pair_and_result(trial):
    """Return cold expectations plus hashes, never a prebuilt result or raw body."""
    originals=[]
    for label,text in [('previous','Earlier invented Å wording.'),('current','Revised invented Å &amp; exact wording.')]:
        prepared=original.prepare_example(text)
        receipt=original.committed(trial,prepared.statement())
        stored=parse_stored_html_original(receipt,prepared,observed_at=datetime.now(timezone.utc))
        expected=prepare_html_original_reopen(intent=prepared.intent,document=prepared.document,binding=prepared.binding,mapping=prepared.mapping,artifact_id=stored.artifact_id,stored_at=stored.stored_at,observed_at=datetime.now(timezone.utc))
        (trial.proof/('HTML_EXTRACTION_'+label.upper()+'_ORIGINAL_RECEIPT.json')).write_bytes(receipt)
        originals.append((receipt,expected))
    previous,current=originals
    plan=compile_stored_html_request(current[0],current[1],previous[0],previous[1],observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    output=json.dumps(dict(schema_version=1,source_version_id=current[1].document.source_version_id,source_sha256=current[1].document.content_sha256,locator='article:one',proposed_claim_type='condition',proposed_assertion='An invented source statement remains unverified.',source_date_text=None,language_code='en')).encode()
    prepared_at=datetime.now(timezone.utc)
    packet=prepare_html_private_extraction(current[0],current[1],previous[0],previous[1],request=plan.request,output_raw=output,operation_id=str(uuid4()),prepared_at=prepared_at,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    request=prepare_html_extraction_store(packet)
    receipt=original.committed(trial,request.statement())
    stored=parse_stored_html_extraction(receipt,request,observed_at=datetime.now(timezone.utc))
    expected=prepare_html_extraction_reopen(operation_id=stored.operation_id,artifact_id=stored.artifact_id,stored_at=stored.stored_at,prepared_at=prepared_at,current_expected=current[1],previous_expected=previous[1],maximum_output_tokens=100,canonical_metadata=request.canonical_metadata,observed_at=datetime.now(timezone.utc))
    (trial.proof/'HTML_EXTRACTION_CANONICAL_PACKET.json').write_bytes(packet.canonical_input)
    (trial.proof/'HTML_EXTRACTION_FULL_RECEIPT.json').write_bytes(receipt)
    trial.record('HTML_EXTRACTION_INDEPENDENT_EXPECTATIONS',_json_value(asdict(expected)))
    return expected,sha256(packet.canonical_input).hexdigest(),sha256(receipt).hexdigest()


def cold_read(trial,expected):
    current=original.committed(trial,expected.current_expected.statement())
    previous=original.committed(trial,expected.previous_expected.statement())
    receipt=original.committed(trial,expected.statement())
    stored=reopen_html_extraction(receipt,expected,current_receipt=current,previous_receipt=previous,observed_at=datetime.now(timezone.utc))
    return stored,receipt,current,previous


def cases(trial):
    feed=profile(trial,'tf_feed_rehearsal');principal=original.roles(trial)
    install_extraction(trial)
    html=profile(trial,'tf_html_rehearsal');extraction=profile(trial,'tf_html_extraction')
    trial.record('HTML_EXTRACTION_INSTALLED_PROFILES',dict(original=html,extraction=extraction,feed=feed))
    trial.check('exact_new_two_schema_owner_profiles',original.expected_profile(html) and expected_profile(extraction))
    trial.check('empty_all_six_tables',full_rows(trial)==dict(feed=[0,0,0,0],html=[],extraction=[]))
    expected,packet_sha,receipt_sha=store_pair_and_result(trial)
    baseline=full_rows(trial)
    trial.check('actual_commit_full_receipt_pair_and_result_only',len(baseline['html'])==2 and len(baseline['extraction'])==1 and baseline['feed']==[0,0,0,0])
    stored,receipt,current,previous=cold_read(trial,expected)
    trial.check('fresh_full_receipt_semantic_reopening',sha256(receipt).hexdigest()==receipt_sha and sha256(stored.result.canonical_input).hexdigest()==packet_sha and stored.result.proposal.review_state=='unverified')
    value=json.loads(receipt);metadata=base64.b64decode(value['metadata_base64'],validate=True);request=base64.b64decode(value['request_base64'],validate=True);output=base64.b64decode(value['output_base64'],validate=True)
    replay=original.committed(trial,direct(metadata,request,output))
    trial.check('byte_exact_committed_result_replay',replay==receipt and full_rows(trial)==baseline)
    for label in ('metadata','original_reference','request','output','operation_reuse'):
        changed=json.loads(metadata);changed_request=request;changed_output=output
        if label=='metadata':changed['kind']='foreign'
        elif label=='original_reference':changed['current_original']['artifact_id']=str(uuid4())
        elif label=='request':changed_request=request+b' '
        elif label=='output':changed_output=output+b' '
        else:changed['prepared_at']=_time(datetime.now(timezone.utc))
        changed_raw=json.dumps(changed,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
        failed=trial.query(direct(changed_raw,changed_request,changed_output),allowed=True)
        trial.check(label+'_native_refusal_no_effect',failed.returncode!=0 and (label!='operation_reuse' or b'invented_html_extraction_operation_conflict' in failed.stderr) and full_rows(trial)==baseline)
    for action in ('update tf_html_extraction.results set metadata=metadata','delete from tf_html_extraction.results'):
        failed=trial.query(HEAD+'begin;'+action+';commit;',allowed=True)
        trial.check('result_append_only_'+action.split()[0],failed.returncode!=0 and b'invented_html_extraction_append_only' in failed.stderr and full_rows(trial)==baseline)
    late=json.loads(metadata);late['operation_id']=str(uuid4());late['prepared_at']=_time(datetime.now(timezone.utc));late_raw=json.dumps(late,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
    injected=direct(late_raw,request,output).replace('commit;\n',"select jsonb_build_object('late_visible',(select count(*) from tf_html_extraction.results where operation_id="+_literal(late['operation_id'])+"::uuid));select 1/0;commit;\n")
    failed=trial.query(injected,allowed=True);lines=failed.stdout.splitlines()
    trial.check('actual_late_result_visible_before_outer_fault',failed.returncode!=0 and len(lines)==2 and json.loads(lines[1])==dict(late_visible=1) and COMMIT_MARKER not in failed.stdout)
    try:committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    except ValueError:trial.check('late_fault_full_receipt_withheld',True)
    else:trial.check('late_fault_full_receipt_withheld',False)
    trial.check('separate_connection_late_rollback',full_rows(trial)==baseline)
    del stored,receipt,current,previous,metadata,request,output,value,replay
    trial.stop();trial.start()
    cold,receipt,current,previous=cold_read(trial,expected)
    trial.check('cold_both_originals_whole_request_output',sha256(receipt).hexdigest()==receipt_sha and sha256(cold.result.canonical_input).hexdigest()==packet_sha and cold.result.proposal.review_state=='unverified')
    tampered=json.loads(receipt);tampered['request_base64']=base64.b64encode(cold.result.plan.request.body+b' ').decode();bad=json.dumps(tampered).encode()
    for label,raw,expect in [('body',bad,expected),('independent_artifact',receipt,replace(expected,artifact_id=str(uuid4())))]:
        try:reopen_html_extraction(raw,expect,current_receipt=current,previous_receipt=previous,observed_at=datetime.now(timezone.utc))
        except HtmlExtractionCustodyError:trial.check('cold_'+label+'_held_all_or_none',True)
        else:trial.check('cold_'+label+'_held_all_or_none',False)
    trial.check('final_full_rows_profiles_roles_feed_unchanged',full_rows(trial)==baseline and profile(trial,'tf_html_rehearsal')==html and profile(trial,'tf_html_extraction')==extraction and profile(trial,'tf_feed_rehearsal')==feed and original.roles(trial)==principal)
    trial.record('HTML_EXTRACTION_FINAL_ROWS',baseline)
    return dict(storedOriginals=2,storedExtractions=1,feedProcessed=0,sourceRequests=0,modelCalls=0,publicationEnabled=False,semanticDerivationVerifiedBySql=False,ordinaryRestartOnly=True)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed extraction trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_extraction(trial);trial.create();result=cases(trial)
        trial.record('HTML_EXTRACTION_RESULT',dict(state='PASS_BOUNDED_INVENTED_HTML_EXTRACTION_CUSTODY',assertions=trial.assertions,**result))
    except BaseException as error:
        trial.record('HTML_EXTRACTION_FAILURE',dict(state='held',exceptionClass=type(error).__name__,preserved=True));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:
                trial.verify_sources('HTML_EXTRACTION_FINAL')
                if hasattr(trial,'html_runtime'):original.verify_runtime(trial,'EXTRACTION_FINAL')
        if trial.identity is not None:trial.record('HTML_EXTRACTION_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_BOUNDED_INVENTED_HTML_EXTRACTION_CUSTODY',primaryChanged=False)))


if __name__=='__main__':main()
