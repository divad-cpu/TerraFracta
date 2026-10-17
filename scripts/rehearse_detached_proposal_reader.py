"""Fixed one-read preparation worker/report composition over fresh owned data."""
from dataclasses import replace
from datetime import datetime,timezone
from hashlib import sha256
import json,os,sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from scripts.rehearse_stream_reader import freeze_all
from scripts.rehearse_reopened_change import freeze_change
from scripts.rehearse_document_reference import freeze_reference
from scripts.rehearse_private_extraction import freeze_private,owner_query
from scripts.rehearse_private_extraction_restore import cold_artifact
from scripts.rehearse_detached_proposal import (freeze_detached,seed_preparation,all_rows,all_profiles,whole_detached_scope)
from workers.bounded_worker_process import WorkerOutput
from workers.detached_proposal_custody import DetachedPreparationIntent
from workers.detached_proposal_reader import read_detached_proposal,DetachedProposalReadError
from workers.detached_proposal_report import detached_proposal_review_report
from workers.feed_postgres_contract import COMMIT_MARKER,_time


def cases(trial):
    roles,scope,expectations,operation,intent,receipt_sha=seed_preparation(trial)
    rows=all_rows(trial,'DETACHED_WORKER_INITIAL_ROWS');profiles=all_profiles(trial,'DETACHED_WORKER_INITIAL_PROFILES')
    trial.record('DETACHED_WORKER_WHOLE_SCOPE',whole_detached_scope(trial.query))
    trial.stop();trial.start();roles.verify()
    extraction=cold_artifact(trial,trial,roles,scope,expectations,operation,'DETACHED_WORKER_FRESH')
    calls=[];ticks=[]
    def clock():
        at=datetime.now(timezone.utc);ticks.append(_time(at));return at
    def query(sql):
        output=owner_query(trial,roles,sql,allowed=True)
        calls.append(dict(statementSHA256=sha256(sql.encode()).hexdigest(),stdoutBytes=len(output.stdout),stdoutSHA256=sha256(output.stdout).hexdigest(),returncode=output.returncode))
        return WorkerOutput(output.stdout,output.stderr,output.returncode)
    result=read_detached_proposal(extraction,intent,query=query,utc_now=clock)
    trial.record('DETACHED_WORKER_TRACE',dict(calls=calls.copy(),ticks=ticks.copy(),queryCount=result.query_count))
    trial.check('detached_worker_one_fixed_full_read_three_observations',len(calls)==1 and len(ticks)==3 and result.query_count==1)
    trial.check('detached_worker_unknown_fourpart_receipt_matches_original_digest',sha256(result.reopened.full_receipt).hexdigest()==receipt_sha)
    report=detached_proposal_review_report(result.reopened);projection=json.loads(report)
    with (trial.proof/'DETACHED_WORKER_REPORT.bin').open('xb') as f:f.write(report)
    trial.record('DETACHED_WORKER_REPORT_BINDING',dict(bytes=len(report),sha256=sha256(report).hexdigest(),intentSHA256=sha256(intent.canonical_metadata).hexdigest(),
        reviewState=projection['review_state'],exactPartBytes=[len(projection['parts'][key].encode()) for key in ('payload_json','selection_json','provenance_json','context_json')],actualHeldCapture=False,modelCalls=0,sourceCalls=0))
    trial.check('detached_worker_report_contains_current_and_earlier_selected_text',projection['extraction_report']['review_state']=='unverified'
        and projection['extraction_report']['selected_passages'][0]['earlier'][0]['text'] is not None
        and projection['evidence_state']=='historical_preparation_not_current_qualification_or_held_capture')
    different=json.loads(intent.canonical_metadata);different['operation_id']=str(uuid4());foreign=DetachedPreparationIntent(json.dumps(different,sort_keys=True,separators=(',',':')).encode())
    for label,item,expected,port,count in (
        ('broken_full_artifact',replace(extraction,full_receipt=b'{}'),intent,query,0),
        ('foreign_absent_operation',extraction,foreign,query,1),
        # Actual committed full read followed by simulated delivery framing loss.
        ('withheld_commit_marker',extraction,intent,None,1),
    ):
        # Keep one actual invocation in the withheld-marker port too.
        if label=='withheld_commit_marker':
            def port(sql):
                output=query(sql);return WorkerOutput(output.stdout.removesuffix(b'\n'+COMMIT_MARKER+b'\n'),output.stderr,output.returncode)
        before=len(calls)
        try:read_detached_proposal(item,expected,query=port,utc_now=clock)
        except DetachedProposalReadError as error:
            trial.check('detached_worker_'+label+'_whole_hold',str(error)=='detached_proposal_read_unavailable' and len(calls)==before+count)
        else:raise FeedPgTrialError('Expected detached worker hold absent')
    trial.check('detached_worker_reads_preserve_all_eleven_tables',all_rows(trial,'DETACHED_WORKER_FINAL_ROWS')==rows)
    trial.check('detached_worker_no_new_acl_defaults_or_function',all_profiles(trial,'DETACHED_WORKER_FINAL_PROFILES')==profiles)
    trial.record('DETACHED_WORKER_FINAL_TRACE',dict(calls=calls,ticks=ticks))
    whole_detached_scope(trial.query)
    return dict(schemas=8,tables=11,functions=28,reportBytes=len(report),queryCount=result.query_count,oldPartsSupplied=False,
        targetAuthentication=False,actualHeldCapture=False,actualLogin=False,offHost=False,modelCalls=0,sourceCalls=0,operationalAcceptance=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented preparation reader takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial)
        freeze_detached(trial,extra=('scripts/rehearse_detached_proposal_reader.py','workers/detached_proposal_reader.py','workers/detached_proposal_report.py'))
        trial.create();scope=cases(trial)
        trial.record('DETACHED_WORKER_RESULT',dict(state='PASS_INVENTED_DETACHED_WORKER',assertions=trial.assertions,scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('DETACHED_WORKER_FAILED',dict(type=type(error).__name__,message='invented_detached_worker_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_DETACHED_WORKER')
        if trial.identity is not None:trial.record('DETACHED_WORKER_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(state='PASS_INVENTED_DETACHED_WORKER',proof=str(trial.proof),assertions=len(trial.assertions),primaryChanged=False)))

if __name__=='__main__':main()
