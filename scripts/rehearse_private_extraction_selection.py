"""Fresh committed inventory -> explicit choice -> exact full artifact/report."""
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
    seed_one,cold_document,owner_query,reference_profile,private_profile,private_defaults,snapshot,private_snapshot)
from scripts.rehearse_private_extraction_reader import freeze_worker
from scripts.rehearse_private_extraction_inventory import freeze_inventory
from workers.feed_collection_inventory import prepare_inventory_request
from workers.private_extraction_inventory import prepare_private_extraction_inventory
from workers.private_extraction_selection import read_selected_private_extraction,PrivateExtractionSelectionError
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import committed_pg_json,_time,COMMIT_MARKER
ROOT=Path(__file__).resolve().parents[1]


def freeze_selection(trial):
    names={'scripts/rehearse_private_extraction_selection.py','workers/private_extraction_selection.py'};queue=list(names);rows=[]
    while queue:
        name=queue.pop()
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Private selection dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with path.open('xb') as stream:stream.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row=dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest());rows.append(row);trial.source_bindings.append(row)
    trial.record('PRIVATE_SELECTION_SOURCE_BINDINGS',rows)


def cases(trial):
    roles,scope,expectations,operation,receipt_sha=seed_one(trial)
    trial.stop();trial.start();roles.verify()
    page=prepare_inventory_request(scope,item_limit=20)
    current=cold_document(trial,trial,roles,page,expectations[0],'PRIVATE_SELECTION_CURRENT')
    previous=cold_document(trial,trial,roles,page,expectations[1],'PRIVATE_SELECTION_PREVIOUS')
    expected=prepare_private_extraction_inventory(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,
        maximum_output_tokens=100,observed_at=datetime.now(timezone.utc))
    inventory=owner_query(trial,roles,expected.statement())
    delivered=WorkerOutput(inventory.stdout,inventory.stderr,inventory.returncode)
    raw=committed_pg_json(inventory.stdout,inventory.stderr,inventory.returncode)
    before=(snapshot(trial),private_snapshot(trial.query));access=(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))
    trial.record('PRIVATE_SELECTION_BEFORE',dict(base=before[0],private=before[1],baseAccess=access[0],privateAccess=access[1],defaults=access[2],
        fixedExplicitChoice=operation,choiceFromResultPosition=False))
    calls=[];ticks=[]
    def clock():
        at=datetime.now(timezone.utc);ticks.append(_time(at));return at
    def query(sql):
        output=owner_query(trial,roles,sql,allowed=True)
        calls.append(dict(statementSHA256=sha256(sql.encode()).hexdigest(),stdoutSHA256=sha256(output.stdout).hexdigest(),returncode=output.returncode))
        return WorkerOutput(output.stdout,output.stderr,output.returncode)
    result=read_selected_private_extraction(delivered,expected,operation_id=operation,query=query,utc_now=clock)
    trial.check('private_selection_explicit_member_exact_one_read_and_four_clock_ticks',len(calls)==1 and len(ticks)==4)
    trial.check('private_selection_actual_complete_receipt_matches_seeded_intent',sha256(result.read.reopened.full_receipt).hexdigest()==receipt_sha)
    trial.check('private_selection_actual_all_chosen_metadata_matches_full_result',result.candidate.artifact_id==result.read.reopened.stored.artifact_id
        and result.candidate.output_sha256==result.read.reopened.stored.output_sha256 and result.candidate.prepared_at==result.read.reopened.result.prepared_at
        and result.candidate.stored_at==result.read.reopened.stored.stored_at)
    path=trial.proof/'PRIVATE_SELECTION_REPORT.bin'
    with path.open('xb') as stream:stream.write(result.read.report_raw)
    path.chmod(0o600)
    trial.record('PRIVATE_SELECTION_REPORT_BINDING',dict(bytes=len(result.read.report_raw),sha256=sha256(result.read.report_raw).hexdigest(),reviewState='unverified',automaticChoice=False))
    changed=json.loads(raw);changed['candidates'][0]['output_sha256']='f'*64
    bad_raw=json.dumps(changed,ensure_ascii=False,separators=(',',':')).encode()
    bad=WorkerOutput(bad_raw+b'\n'+COMMIT_MARKER+b'\n',b'',0)
    lost=WorkerOutput(raw,b'',0)
    for label,output,choice,count in [('nonmember',delivered,str(uuid4()),0),('lost_inventory_commit',lost,operation,0),('simulated_changed_metadata',bad,operation,1)]:
        previous_calls=len(calls)
        try:read_selected_private_extraction(output,expected,operation_id=choice,query=query,utc_now=clock)
        except PrivateExtractionSelectionError as error:
            trial.check('private_selection_'+label+'_curated_exact_dispatch',str(error)=='private_extraction_selection_unavailable' and len(calls)==previous_calls+count)
        else:raise FeedPgTrialError('Private selection expected hold unavailable')
    trial.check('private_selection_reads_and_delivery_faults_change_no_ten_table_rows',(snapshot(trial),private_snapshot(trial.query))==before)
    trial.check('private_selection_no_new_schema_grant_functions_or_defaults',(reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))==access)
    trial.stop();trial.start();roles.verify()
    recovered=read_selected_private_extraction(delivered,expected,operation_id=operation,query=query,utc_now=clock)
    trial.check('private_selection_restart_full_artifact_metadata_still_exact',recovered.candidate==result.candidate and recovered.read.reopened.full_receipt==result.read.reopened.full_receipt)
    trial.check('private_selection_final_rows_profiles_exact',(snapshot(trial),private_snapshot(trial.query))==before
        and (reference_profile(trial.query),private_profile(trial.query),private_defaults(trial.query))==access)
    trial.record('PRIVATE_SELECTION_FINAL_TRACE',dict(calls=calls,ticks=ticks))
    return dict(schemas=7,tables=10,functions=25,modelCalls=0,sourceRequests=0,newSQLObjects=0,newGrants=0,
        automaticChoice=False,actualLogin=False,operationalAcceptance=False,simulatedMetadataChangeNotNativeMutation=True,
        finalRestartReusesOriginalsAndInventory=True)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented private selection trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_restore(trial);freeze_worker(trial);freeze_inventory(trial);freeze_selection(trial)
        trial.create();scope=cases(trial)
        trial.record('PRIVATE_SELECTION_RESULT',dict(state='PASS_INVENTED_PRIVATE_SELECTION',assertions=trial.assertions,assertionCount=len(trial.assertions),scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('PRIVATE_SELECTION_FAILED',dict(type=type(error).__name__,message='invented_private_selection_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_PRIVATE_SELECTION')
        if trial.identity is not None:trial.record('PRIVATE_SELECTION_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_INVENTED_PRIVATE_SELECTION',primaryChanged=False)))


if __name__=='__main__':main()
