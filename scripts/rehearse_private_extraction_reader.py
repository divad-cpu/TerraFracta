"""Fixed invented one-read worker on fresh retained originals/private artifact.

No arguments, primary connection, new SQL/grant, source/provider/network or
operational login. Existing unchanged custody, SQL/profile and cold-read seams.
"""
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from scripts.rehearse_private_extraction_restore import (freeze_all,freeze_change,freeze_reference,freeze_private,freeze_restore,
    seed_one,cold_document,owner_query,reference_profile,private_profile,private_defaults,snapshot,private_snapshot,whole_scope)
from workers.feed_collection_inventory import prepare_inventory_request
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import _time
from workers.private_extraction_result import prepare_private_extraction_result
from workers.private_extraction_postgres import prepare_private_extraction_store
from workers.feed_postgres_contract import committed_pg_json
from workers.private_extraction_reader import read_private_extraction,PrivateExtractionReadError
ROOT=Path(__file__).resolve().parents[1]


def freeze_worker(trial):
    names={'scripts/rehearse_private_extraction_reader.py','workers/private_extraction_reader.py','workers/private_extraction_report.py'}
    queue=list(names);rows=[]
    while queue:
        name=queue.pop()
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Private worker dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with path.open('xb') as stream:stream.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row=dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest());rows.append(row);trial.source_bindings.append(row)
    trial.record('PRIVATE_WORKER_SOURCE_BINDINGS',rows)


def cases(trial):
    roles,scope,expectations,operation,receipt_sha=seed_one(trial)
    before=(snapshot(trial),private_snapshot(trial.query));profiles=(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))
    trial.record('PRIVATE_WORKER_BEFORE',dict(base=before[0],private=before[1],baseAccess=profiles[0],privateAccess=profiles[1],defaults=profiles[2],whole=whole_scope(trial.query)))
    trial.stop();trial.start();roles.verify()
    inventory=prepare_inventory_request(scope,item_limit=20)
    current=cold_document(trial,trial,roles,inventory,expectations[0],'PRIVATE_WORKER_CURRENT')
    previous=cold_document(trial,trial,roles,inventory,expectations[1],'PRIVATE_WORKER_PREVIOUS')
    calls=[];ticks=[]
    def clock():
        at=datetime.now(timezone.utc);ticks.append(_time(at));return at
    def query(sql):
        output=owner_query(trial,roles,sql,allowed=True)
        calls.append(dict(statementSHA256=sha256(sql.encode()).hexdigest(),stdoutSHA256=sha256(output.stdout).hexdigest(),returncode=output.returncode))
        return WorkerOutput(output.stdout,output.stderr,output.returncode)
    kwargs=dict(current=current.reopened,current_receipt=current.full_receipt,previous=previous.reopened,
        previous_receipt=previous.full_receipt,operation_id=operation,maximum_output_tokens=100)
    result=read_private_extraction(**kwargs,query=query,utc_now=clock)
    trial.record('PRIVATE_WORKER_TRACE',dict(calls=calls,ticks=ticks,queryCount=result.query_count))
    trial.check('private_worker_exact_one_read_after_fourteen_original_reads',len(calls)==1 and result.query_count==1 and len(ticks)==3)
    trial.check('private_worker_complete_unknown_output_receipt_exact',sha256(result.reopened.full_receipt).hexdigest()==receipt_sha)
    report=json.loads(result.report_raw)
    path=trial.proof/'PRIVATE_WORKER_REPORT.bin'
    with path.open('xb') as stream:stream.write(result.report_raw)
    path.chmod(0o600)
    trial.record('PRIVATE_WORKER_REPORT_BINDING',dict(bytes=len(result.report_raw),sha256=sha256(result.report_raw).hexdigest(),reviewState=report['review_state'],modelCalls=0,sourceRequests=0))
    trial.check('private_worker_unverified_selected_and_earlier_text',report['review_state']=='unverified' and report['selected_passages'][0]['earlier'][0]['text'] is not None)
    for label,changes,port,expected_calls in [
      ('missing_prior',dict(previous=None),query,0),
      ('broken_full_receipt',dict(previous_receipt=b'{}'),query,0),
      ('foreign_absent_operation',dict(operation_id=str(uuid4())),query,1),
      ('lost_commit_marker',{},lambda sql:WorkerOutput(query(sql).stdout.removesuffix(b'\nTF_INVENTED_FEED_COMMITTED\n'),b'',0),1),
    ]:
        count=len(calls)
        try:read_private_extraction(**{**kwargs,**changes},query=port,utc_now=clock)
        except PrivateExtractionReadError as error:
            trial.check('private_worker_'+label+'_fixed_refusal',str(error)=='private_extraction_read_unavailable' and len(calls)==count+expected_calls)
        else:raise FeedPgTrialError('Private worker expected refusal unavailable')
    trial.check('private_worker_reads_do_not_change_ten_tables',(snapshot(trial),private_snapshot(trial.query))==before)
    trial.check('private_worker_no_new_acl_default_or_function',(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))==profiles)
    trial.stop();trial.start();roles.verify()
    again=read_private_extraction(**kwargs,query=query,utc_now=clock)
    trial.check('private_worker_second_restart_exact_stored_intent',again.reopened.full_receipt==result.reopened.full_receipt and again.reopened.result.request.body==result.reopened.result.request.body)
    trial.check('private_worker_second_restart_same_source_tables',(snapshot(trial),private_snapshot(trial.query))==before)
    # Separate operation tables may legitimately reuse one UUID. Create a
    # second exact invented artifact through the existing store, not direct DML.
    at=datetime.now(timezone.utc);alias=kwargs['current'].result_request.operation_id
    value=prepare_private_extraction_result(kwargs['current'],kwargs['current_receipt'],kwargs['previous'],kwargs['previous_receipt'],
        request=again.reopened.result.request,output_raw=again.reopened.result.output_raw,operation_id=alias,
        prepared_at=at,observed_at=at,maximum_output_tokens=100)
    store=prepare_private_extraction_store(value)
    output=owner_query(trial,roles,store.statement())
    alias_raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    alias_result=read_private_extraction(**{**kwargs,'operation_id':alias},query=query,utc_now=clock)
    trial.check('private_worker_legitimate_cross_table_operation_same_uuid',alias_result.reopened.full_receipt==alias_raw
        and alias_result.reopened.stored.operation_id==kwargs['current'].result_request.operation_id)
    path=trial.proof/'PRIVATE_WORKER_ALIAS_REPORT.bin'
    with path.open('xb') as stream:stream.write(alias_result.report_raw)
    path.chmod(0o600)
    trial.record('PRIVATE_WORKER_ALIAS_REPORT_BINDING',dict(bytes=len(alias_result.report_raw),sha256=sha256(alias_result.report_raw).hexdigest(),operationId=alias))
    trial.check('private_worker_namespace_successor_only_new_private_artifact',snapshot(trial)==before[0]
        and private_snapshot(trial.query)['rows']==before[1]['rows']+1)
    trial.check('private_worker_namespace_successor_profiles_still_exact',(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))==profiles)
    trial.record('PRIVATE_WORKER_FINAL_TRACE',dict(calls=calls,ticks=ticks))
    return dict(schemas=7,tables=10,functions=25,modelCalls=0,sourceRequests=0,actualLogin=False,operationalAcceptance=False,reportBytes=len(result.report_raw))


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented private reader trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_restore(trial);freeze_worker(trial)
        trial.create();scope=cases(trial)
        trial.record('PRIVATE_WORKER_RESULT',dict(state='PASS_INVENTED_PRIVATE_WORKER',assertions=trial.assertions,assertionCount=len(trial.assertions),scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('PRIVATE_WORKER_FAILED',dict(type=type(error).__name__,message='invented_private_worker_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_PRIVATE_WORKER')
        if trial.identity is not None:trial.record('PRIVATE_WORKER_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_INVENTED_PRIVATE_WORKER',primaryChanged=False)))


if __name__=='__main__':main()
