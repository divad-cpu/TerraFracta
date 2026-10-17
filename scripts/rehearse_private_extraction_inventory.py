"""Fixed invented exact-pair private metadata discovery, not automatic choice."""
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from scripts.rehearse_private_extraction_restore import (freeze_all,freeze_change,freeze_reference,freeze_private,freeze_restore,
    seed_one,cold_document,owner_query,reference_profile,private_profile,private_defaults,snapshot,private_snapshot,whole_scope)
from scripts.rehearse_private_extraction_reader import freeze_worker
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_postgres_contract import committed_pg_json
from workers.bounded_worker_process import WorkerOutput
from workers.private_extraction_reader import read_private_extraction
from workers.private_extraction_result import prepare_private_extraction_result
from workers.private_extraction_postgres import prepare_private_extraction_store
from workers.private_extraction_inventory import (prepare_private_extraction_inventory,
    parse_private_extraction_inventory,PrivateExtractionInventoryError)
ROOT=Path(__file__).resolve().parents[1]


def freeze_inventory(trial):
    names={'scripts/rehearse_private_extraction_inventory.py','workers/private_extraction_inventory.py'};queue=list(names);rows=[]
    while queue:
        name=queue.pop()
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Private inventory dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with path.open('xb') as stream:stream.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row=dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest());rows.append(row);trial.source_bindings.append(row)
    trial.record('PRIVATE_INVENTORY_SOURCE_BINDINGS',rows)


def cases(trial):
    roles,scope,expectations,seed_operation,_=seed_one(trial)
    trial.stop();trial.start();roles.verify()
    page=prepare_inventory_request(scope,item_limit=20)
    current=cold_document(trial,trial,roles,page,expectations[0],'PRIVATE_INVENTORY_CURRENT')
    previous=cold_document(trial,trial,roles,page,expectations[1],'PRIVATE_INVENTORY_PREVIOUS')
    arguments=dict(current=current.reopened,current_receipt=current.full_receipt,
        previous=previous.reopened,previous_receipt=previous.full_receipt,maximum_output_tokens=100)
    expected=prepare_private_extraction_inventory(**arguments,observed_at=datetime.now(timezone.utc))
    statement=expected.statement()
    trial.check('private_inventory_requires_no_remembered_artifact_operation',seed_operation not in statement)
    def observe(request,label):
        output=owner_query(trial,roles,request.statement())
        raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
        result=parse_private_extraction_inventory(raw,request,observed_at=datetime.now(timezone.utc))
        trial.record(label,dict(candidates=[dict(operationId=r.operation_id,artifactId=r.artifact_id,outputSHA256=r.output_sha256) for r in result.candidates],
            rawBytes=len(raw),rawSHA256=sha256(raw).hexdigest(),automaticallySelected=False))
        return result
    initial=observe(expected,'PRIVATE_INVENTORY_INITIAL')
    trial.check('private_inventory_one_exact_historical_candidate',len(initial.candidates)==1 and initial.candidates[0].operation_id==seed_operation)
    # Explicit fixture-plan choice, independent of the inventory result order.
    trial.record('PRIVATE_INVENTORY_FIXED_EXPLICIT_CHOICE',dict(operationId=seed_operation,fromResultPosition=False,operationalChoice=False))
    def query(sql):
        output=owner_query(trial,roles,sql,allowed=True);return WorkerOutput(output.stdout,output.stderr,output.returncode)
    chosen=read_private_extraction(**arguments,operation_id=seed_operation,query=query,utc_now=lambda:datetime.now(timezone.utc))
    trial.check('private_inventory_explicit_choice_still_fully_reopens',chosen.reopened.stored.operation_id==seed_operation and chosen.reopened.result.proposal.review_state=='unverified')
    # A different untrusted output for the same exact request is not auto-selected.
    value=json.loads(chosen.reopened.result.output_raw);value['proposed_assertion']='A second invented unverified candidate.'
    raw=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode();at=datetime.now(timezone.utc)
    alias=arguments['current'].result_request.operation_id
    result=prepare_private_extraction_result(arguments['current'],arguments['current_receipt'],arguments['previous'],arguments['previous_receipt'],
        request=chosen.reopened.result.request,output_raw=raw,operation_id=alias,prepared_at=at,observed_at=at,maximum_output_tokens=100)
    owner_query(trial,roles,prepare_private_extraction_store(result).statement())
    both=observe(expected,'PRIVATE_INVENTORY_MULTIPLE')
    trial.check('private_inventory_multiple_outputs_same_exact_request_no_selection',len(both.candidates)==2
        and {r.operation_id for r in both.candidates}=={seed_operation,alias}
        and len({r.output_sha256 for r in both.candidates})==2)
    other=prepare_private_extraction_inventory(**{**arguments,'maximum_output_tokens':101},observed_at=datetime.now(timezone.utc))
    none=observe(other,'PRIVATE_INVENTORY_OTHER_CEILING')
    trial.check('private_inventory_zero_scoped_matches_is_not_redispatch_authority',none.candidates==())
    before=(snapshot(trial),private_snapshot(trial.query));access=(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))
    trial.record('PRIVATE_INVENTORY_SCOPE_BEFORE_DENIALS',dict(base=before[0],private=before[1],baseAccess=access[0],privateAccess=access[1],defaults=access[2],whole=whole_scope(trial.query)))
    refused=roles.query('tf_feed_lab_observer',statement,allowed=True)
    trial.check('private_inventory_observer_cannot_select_private_table',refused.returncode!=0 and b'permission denied' in refused.stderr)
    admin=trial.query(statement)
    raw_admin=committed_pg_json(admin.stdout,admin.stderr,admin.returncode)
    try:parse_private_extraction_inventory(raw_admin,expected,observed_at=datetime.now(timezone.utc))
    except PrivateExtractionInventoryError:
        trial.check('private_inventory_other_principal_not_empty_or_partial',json.loads(raw_admin)['principal']=='postgres')
    else:raise FeedPgTrialError('Private inventory principal refusal unavailable')
    trial.check('private_inventory_denials_and_reads_change_no_ten_table_rows',(snapshot(trial),private_snapshot(trial.query))==before)
    trial.check('private_inventory_no_schema_grant_function_or_default_change',(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))==access)
    trial.stop();trial.start();roles.verify()
    recovered=observe(expected,'PRIVATE_INVENTORY_AFTER_RESTART')
    trial.check('private_inventory_restart_exact_historical_candidates',recovered.candidates==both.candidates)
    trial.check('private_inventory_final_ten_tables_profiles_exact',(snapshot(trial),private_snapshot(trial.query))==before
        and (reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))==access)
    return dict(schemas=7,tables=10,functions=25,candidates=2,newSQLObjects=0,newGrants=0,modelCalls=0,sourceRequests=0,
        automaticChoice=False,actualLogin=False,operationalAcceptance=False,secondRestartFreshOriginals=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented private inventory trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_restore(trial);freeze_worker(trial);freeze_inventory(trial)
        trial.create();scope=cases(trial)
        trial.record('PRIVATE_INVENTORY_RESULT',dict(state='PASS_INVENTED_PRIVATE_INVENTORY',assertions=trial.assertions,assertionCount=len(trial.assertions),scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('PRIVATE_INVENTORY_FAILED',dict(type=type(error).__name__,message='invented_private_inventory_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_PRIVATE_INVENTORY')
        if trial.identity is not None:trial.record('PRIVATE_INVENTORY_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_INVENTED_PRIVATE_INVENTORY',primaryChanged=False)))


if __name__=='__main__':main()
