"""Fixed metadata rediscovery and explicit independent-intent full selection.

No new SQL object/grant. All records are invented in fresh owned network-none
resources. Metadata never chooses a candidate or authenticates its issuer.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json,os,sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from scripts.rehearse_stream_reader import freeze_all
from scripts.rehearse_reopened_change import freeze_change
from scripts.rehearse_document_reference import freeze_reference
from scripts.rehearse_private_extraction import freeze_private,owner_query
from scripts.rehearse_private_extraction_restore import seed_one,cold_artifact
from scripts.rehearse_detached_proposal import (freeze_detached,install_detached,invented_context,all_rows,all_profiles,whole_detached_scope)
from workers.detached_proposal_custody import prepare_detached_proposal_custody
from workers.detached_proposal_postgres import prepare_detached_proposal_store,parse_stored_detached_proposal
from workers.detached_proposal_inventory import prepare_detached_proposal_inventory,parse_detached_proposal_inventory
from workers.detached_proposal_selection import read_selected_detached_proposal,DetachedProposalSelectionError
from workers.detached_proposal_report import detached_proposal_review_report
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import committed_pg_json,_time


def catalogue(trial,roles,extraction,label):
    expected=prepare_detached_proposal_inventory(extraction,observed_at=datetime.now(timezone.utc))
    output=owner_query(trial,roles,expected.statement());worker=WorkerOutput(output.stdout,output.stderr,output.returncode)
    raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    observation=parse_detached_proposal_inventory(raw,expected,observed_at=datetime.now(timezone.utc))
    trial.record(label,dict(candidateCount=len(observation.candidates),rawBytes=len(raw),rawSHA256=sha256(raw).hexdigest(),
        operations=[row.operation_id for row in observation.candidates],metadataOnly=True,automaticChoice=False))
    return expected,worker,observation


def store_preparation(trial,roles,extraction,label):
    at=datetime.now(timezone.utc);context=invented_context(extraction,at=at);context['content']['title']=label
    prepared=prepare_detached_proposal_custody(extraction,json.dumps(context,ensure_ascii=False,indent=1).encode(),operation_id=str(uuid4()),observed_at=datetime.now(timezone.utc))
    request=prepare_detached_proposal_store(prepared)
    # Bound before dispatch, separately from database-discovered metadata.
    trial.record(label+'_RETAINED_PREWRITE_INTENT',json.loads(prepared.intent.canonical_metadata))
    output=owner_query(trial,roles,request.statement());raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    stored=parse_stored_detached_proposal(raw,request,observed_at=datetime.now(timezone.utc))
    trial.record(label+'_STORE',dict(operationId=stored.operation_id,artifactId=stored.artifact_id,receiptSHA256=sha256(raw).hexdigest()))
    return prepared.intent,sha256(raw).hexdigest()


def cases(trial):
    roles,scope,expectations,operation,private_sha=seed_one(trial);install_detached(trial,roles)
    profiles=all_profiles(trial,'DETACHED_SELECTION_INITIAL_PROFILES')
    extraction=cold_artifact(trial,trial,roles,scope,expectations,operation,'DETACHED_SELECTION_INITIAL')
    expected,output,empty=catalogue(trial,roles,extraction,'DETACHED_SELECTION_EMPTY')
    trial.check('detached_metadata_empty_is_explicit_and_not_auto_dispatch',len(empty.candidates)==0 and all_rows(trial,'DETACHED_SELECTION_EMPTY_ROWS')['preparations']['rows']==0)
    first,first_sha=store_preparation(trial,roles,extraction,'Invented first historical candidate')
    # Same full extraction observation predates the just-stored preparation.
    expected,output,one=catalogue(trial,roles,extraction,'DETACHED_SELECTION_ONE_AFTER_STORE')
    calls=[]
    def query(sql):
        result=owner_query(trial,roles,sql,allowed=True);calls.append(dict(statementSHA256=sha256(sql.encode()).hexdigest(),stdoutSHA256=sha256(result.stdout).hexdigest(),returncode=result.returncode))
        return WorkerOutput(result.stdout,result.stderr,result.returncode)
    try:read_selected_detached_proposal(output,expected,intent=first,query=query,utc_now=lambda:datetime.now(timezone.utc))
    except DetachedProposalSelectionError as error:trial.check('detached_metadata_later_store_requires_fresher_complete_artifact_before_read',str(error)=='detached_proposal_selection_unavailable' and len(calls)==0)
    else:raise FeedPgTrialError('Expected artifact observation hold absent')
    second,second_sha=store_preparation(trial,roles,extraction,'Invented second historical candidate')
    del extraction,expected,output,one,empty
    before=all_rows(trial,'DETACHED_SELECTION_TWO_STORED_ROWS')
    trial.stop();trial.start();roles.verify()
    extraction=cold_artifact(trial,trial,roles,scope,expectations,operation,'DETACHED_SELECTION_FRESH')
    trial.check('detached_selection_private_artifact_receipt_unchanged',sha256(extraction.full_receipt).hexdigest()==private_sha)
    expected,output,observation=catalogue(trial,roles,extraction,'DETACHED_SELECTION_TWO_CHOICES')
    trial.check('detached_metadata_exact_two_stored_members',len(observation.candidates)==2 and {row.operation_id for row in observation.candidates}=={json.loads(first.canonical_metadata)['operation_id'],json.loads(second.canonical_metadata)['operation_id']})
    reports=[]
    for index,(intent,expected_sha) in enumerate(((first,first_sha),(second,second_sha)),1):
        count=len(calls);ticks=[]
        def clock():
            at=datetime.now(timezone.utc);ticks.append(_time(at));return at
        selected=read_selected_detached_proposal(output,expected,intent=intent,query=query,utc_now=clock)
        trial.check('detached_explicit_choice_'+str(index)+'_one_full_read_four_ticks',len(calls)==count+1 and selected.read.query_count==1 and len(ticks)==4)
        trial.check('detached_explicit_choice_'+str(index)+'_matches_independent_prewrite_receipt',sha256(selected.read.reopened.full_receipt).hexdigest()==expected_sha)
        raw=detached_proposal_review_report(selected.read.reopened);name='DETACHED_SELECTION_REPORT_'+str(index)+'.bin'
        with (trial.proof/name).open('xb') as f:f.write(raw)
        reports.append(dict(file=name,bytes=len(raw),sha256=sha256(raw).hexdigest(),intentSHA256=sha256(intent.canonical_metadata).hexdigest(),ticks=ticks))
    trial.record('DETACHED_SELECTION_REPORTS',reports)
    raw_inventory=committed_pg_json(output.stdout,output.stderr,output.returncode)
    with (trial.proof/'DETACHED_SELECTION_INVENTORY.bin').open('xb') as f:f.write(raw_inventory)
    trial.record('DETACHED_SELECTION_TRACE',dict(calls=calls,automaticChoice=False,retainedIntentRequired=True))
    trial.check('detached_metadata_and_explicit_reads_preserve_all_eleven_tables',all_rows(trial,'DETACHED_SELECTION_FINAL_ROWS')==before)
    trial.check('detached_metadata_and_explicit_reads_add_no_acl_default_or_function',all_profiles(trial,'DETACHED_SELECTION_FINAL_PROFILES')==profiles)
    trial.record('DETACHED_SELECTION_WHOLE_SCOPE',whole_detached_scope(trial.query))
    return dict(schemas=8,tables=11,functions=28,preparations=2,fullReads=2,metadataMaximumNativeObserved=2,automaticChoice=False,
        independentAuthentication=False,modelCalls=0,sourceCalls=0,actualHeldCapture=False,actualLogin=False,offHost=False,operationalAcceptance=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented preparation selection takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial)
        freeze_detached(trial,extra=('scripts/rehearse_detached_proposal_selection.py','workers/detached_proposal_inventory.py','workers/detached_proposal_selection.py','workers/detached_proposal_report.py'))
        trial.create();scope=cases(trial)
        trial.record('DETACHED_SELECTION_RESULT',dict(state='PASS_INVENTED_DETACHED_SELECTION',assertions=trial.assertions,scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('DETACHED_SELECTION_FAILED',dict(type=type(error).__name__,message='invented_detached_selection_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_DETACHED_SELECTION')
        if trial.identity is not None:trial.record('DETACHED_SELECTION_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(state='PASS_INVENTED_DETACHED_SELECTION',proof=str(trial.proof),assertions=len(trial.assertions),primaryChanged=False)))

if __name__=='__main__':main()
