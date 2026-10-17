"""Fixed fresh owned PostgreSQL original-document result/outcome trial.

Reuses the reviewed local-only feed custodian. No target/connection selector,
primary, migration replay, fetch, model, login or public writer is present.
"""
from __future__ import annotations
import ast
import base64
from dataclasses import replace
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,seed,rss,entry,capture_context,capture
from scripts.feed_postgres_trial_cases import parallel
from workers.document_passage_binding import PlainDocumentReceipt,DocumentPassageBinding,DocumentByteSpan,DocumentSpanMap
from workers.document_result_contract import (
    FeedDocumentAssociation,prepare_invented_document_result,parse_stored_invented_document_result,
    invented_document_result_read_statement,DocumentResultContractError,
)
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json
from workers.feed_postgres_processing import invented_pg_item_history_statement,parse_invented_pg_item_history
from workers.pair_native_sql import _literal

ROOT=Path(__file__).resolve().parents[1]
URL='https://example.org/invented-document.txt'


def freeze_additional(trial):
    names={'scripts/rehearse_invented_document_results.py','workers/document_result_contract.py','tests/fixtures/invented_document_results.sql'}
    queue=list(names)
    while queue:
        name=queue.pop()
        if not name.endswith('.py'):continue
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    rows=[]
    for name in sorted(names):
        body=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if body!=trial.frozen[name]:raise FeedPgTrialError('Additional scope input changed')
            continue
        trial.frozen[name]=body;destination=trial.proof/'inputs'/name;destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with destination.open('xb') as output:output.write(body)
        destination.chmod(0o600);rows.append({'path':name,'bytes':len(body),'sha256':sha256(body).hexdigest()})
    trial.source_bindings.extend(rows);trial.record('DOCUMENT_SOURCE_BINDINGS',rows)
    trial.record('DOCUMENT_SCOPE',{'state':'invented_owner_only_result_trial','primaryChanged':False,'sourceRequests':0,'modelCalls':0,
        'applicationRoleCreated':False,'sourcePermissionIssued':False,'publicationEnabled':False})


def result_request(trial,*,feed=None,page_raw=None,operation=None,body=None,item_index=0,revision=0):
    if feed is None:
        stream=seed(trial)
        feed=capture_context(rss(entry('document-lead',URL)),stream)
        _,page_raw=capture(trial,feed)
    page=json.loads(page_raw);item=page['items'][item_index]['item_id']
    raw=body or 'Invented original\n  Exact Å source passage.\r\nIgnored metadata.'.encode('utf8')
    start=raw.index(b'  ');end=raw.index(b'\r\n');version=str(uuid4());digest=sha256(raw).hexdigest()
    at=datetime(2026,10,15,tzinfo=timezone.utc);recipe=sha256(b'invented stable document mapping v1').hexdigest()
    document=PlainDocumentReceipt('fictional-document','document-one',version,URL,digest,at)
    binding=DocumentPassageBinding('fictional-document','document-one',version,URL,digest,recipe,'en',at)
    mapping=DocumentSpanMap(version,digest,recipe,'en',(DocumentByteSpan('section:one',start,end),))
    association=FeedDocumentAssociation(feed.operation_id,item,'fictional-document','document-one',version,digest,URL)
    return prepare_invented_document_result(feed,page_raw,document_raw=raw,document=document,binding=binding,mapping=mapping,
        association=association,operation_id=operation or str(uuid4()),expected_revision=revision,observed_at=datetime.now(timezone.utc))


def counts(trial,request):
    item=_literal(request.association.feed_item_id)+'::uuid'
    return json.loads(trial.query("begin isolation level repeatable read read only;select jsonb_build_object('results',(select count(*) from tf_feed_rehearsal.document_results where feed_item_id="+item+"),'outcomes',(select count(*) from tf_feed_rehearsal.outcomes where item_id="+item+"));commit;").stdout)


def store(trial,request):
    output=trial.query(request.statement());raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    return parse_stored_invented_document_result(raw,request,observed_at=datetime.now(timezone.utc)),raw


def inspect_result(trial,request):
    output=trial.query(invented_document_result_read_statement(request));raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    return parse_stored_invented_document_result(raw,request,observed_at=datetime.now(timezone.utc)),raw


def refuse(trial,label,request,statement=None):
    before=counts(trial,request);result=trial.query(statement or request.statement(),allowed=True)
    trial.check(label+'_refuses',result.returncode!=0 and bool(result.stderr))
    trial.check(label+'_unchanged',counts(trial,request)==before)
    return result


def cases(trial):
    request=result_request(trial)
    # Failure after inserting the processed event rolls the event back too.
    trial.query('alter table tf_feed_rehearsal.document_results add constraint trial_result_denied check(false) not valid;')
    refuse(trial,'artifact_insert_failure_rolls_back_event',request)
    trial.check('no_event_or_artifact_after_failed_insert',counts(trial,request)=={'results':0,'outcomes':0})
    trial.query('alter table tf_feed_rehearsal.document_results drop constraint trial_result_denied;')
    # Inject an earlier event time only in this new invented table. The
    # result wrapper must roll back both rows instead of legitimizing it.
    trial.query("create function tf_feed_rehearsal.trial_old_event() returns trigger language plpgsql as $$begin new.recorded_at:='2026-10-14T00:00:02Z'::timestamptz;return new;end$$;create trigger trial_old_event before insert on tf_feed_rehearsal.outcomes for each row execute function tf_feed_rehearsal.trial_old_event();")
    refuse(trial,'event_before_document_rolls_back',request)
    trial.query('drop trigger trial_old_event on tf_feed_rehearsal.outcomes;drop function tf_feed_rehearsal.trial_old_event();')
    value,raw=store(trial,request)
    trial.check('actual_stored_document_passage',value.result.snapshot.passages[0].text=='  Exact Å source passage.')
    trial.check('actual_joint_result_and_processed_event',counts(trial,request)=={'results':1,'outcomes':1})
    again,replayed=store(trial,request);trial.check('exact_result_replay',again==value and replayed==raw)
    conflict=result_request(trial,feed=request.feed_capture,page_raw=request.capture_receipt,operation=request.operation_id,
        body='Invented original\n  Changed source passage.\r\nIgnored metadata.'.encode())
    refuse(trial,'conflicting_result_operation',conflict)
    terminal=replace(request,operation_id=str(uuid4()),expected_revision=1)
    # Rebuild the closed request rather than use forged dataclass payload.
    terminal=prepare_invented_document_result(terminal.feed_capture,terminal.capture_receipt,document_raw=terminal.document_raw,
        document=terminal.document,binding=terminal.binding,mapping=terminal.mapping,association=terminal.association,
        operation_id=terminal.operation_id,expected_revision=1,observed_at=datetime.now(timezone.utc))
    refuse(trial,'processed_item_not_reopened',terminal)
    restored,inspected=inspect_result(trial,request);trial.check('read_only_result_inspection',restored==value and inspected==raw)
    # Existing standalone processed events remain explicit; not retroactively
    # adopted as if an original artifact had been committed at their time.
    adopted=result_request(trial)
    trial.query(HEAD+'begin;select tf_feed_rehearsal.record_outcome('+_literal(adopted.operation_id)+'::uuid,'+
        _literal(adopted.association.feed_item_id)+"::uuid,0,'processed');commit;")
    refuse(trial,'standalone_event_not_adopted',adopted)
    trial.check('standalone_event_has_no_artifact',counts(trial,adopted)=={'results':0,'outcomes':1})
    # Abort after the native joint result was emitted, but before COMMIT.
    aborted=result_request(trial)
    failed=refuse(trial,'post_result_precommit_abort',aborted,aborted.statement().replace('commit;','select 1/0;commit;'))
    try:committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    except ValueError:trial.check('precommit_joint_result_withheld',True)
    else:trial.check('precommit_joint_result_withheld',False)
    # Native checks recompute exact bytes/spans/hash, not just source hashes.
    malformed=result_request(trial);p=json.loads(malformed.canonical_input)
    p['snapshot']['passages'][0]['text']='forged'
    sql=HEAD+'begin;select tf_feed_rehearsal.complete_document_result('+_literal(json.dumps(p))+"::jsonb,decode("+_literal(base64.b64encode(malformed.feed_capture.raw).decode())+",'base64'));commit;"
    refuse(trial,'native_forged_passage_rejected',malformed,sql)
    # Direct owner JSON probes close missing/null shape holes as well as the
    # trusted Python producer. Every refusal preserves both artifact and event.
    malformed=result_request(trial)
    mutations=[('missing_recipe_both',lambda p:(p['mapping'].pop('mapping_sha256'),p['snapshot'].pop('mapping_sha256'))),
        ('null_recipe_both',lambda p:(p['mapping'].update(mapping_sha256=None),p['snapshot'].update(mapping_sha256=None))),
        ('missing_language_both',lambda p:(p['mapping'].pop('language_code'),p['snapshot'].pop('language_code'))),
        ('null_manifest',lambda p:p.update(span_manifest_sha256=None)),
        ('extra_mapping',lambda p:p['mapping'].update(extra=True)),
        ('extra_snapshot',lambda p:p['snapshot'].update(extra=True)),
        ('extra_association',lambda p:p['association'].update(extra=True)),
        ('extra_span',lambda p:p['mapping']['spans'][0].update(extra=True)),
        ('extra_passage',lambda p:p['snapshot']['passages'][0].update(extra=True)),
        ('null_passage_text',lambda p:p['snapshot']['passages'][0].update(text=None)),
        ('boolean_span',lambda p:p['mapping']['spans'][0].update(start=True))]
    for label,mutation in mutations:
        payload=json.loads(malformed.canonical_input);mutation(payload)
        statement=HEAD+'begin;select tf_feed_rehearsal.complete_document_result('+_literal(json.dumps(payload))+"::jsonb,decode("+_literal(base64.b64encode(malformed.feed_capture.raw).decode())+",'base64'));commit;"
        refuse(trial,label,malformed,statement)
    # Actual missing marker after COMMIT: inspect, then exact replay only.
    lost=result_request(trial)
    output=trial.query(lost.statement().replace('\\echo '+COMMIT_MARKER.decode(),'-- intentionally withheld marker'))
    try:committed_pg_json(output.stdout,output.stderr,output.returncode)
    except ValueError:trial.check('actual_result_ack_loss_uncertain',True)
    else:trial.check('actual_result_ack_loss_uncertain',False)
    recovered,recovered_raw=inspect_result(trial,lost);_,retry_raw=store(trial,lost)
    trial.check('actual_result_ack_recovery_one_effect',recovered_raw==retry_raw and counts(trial,lost)=={'results':1,'outcomes':1})
    # Distinct simultaneous operations serialize one terminal result/event.
    left=result_request(trial);right=prepare_invented_document_result(left.feed_capture,left.capture_receipt,
        document_raw=left.document_raw,document=left.document,binding=left.binding,mapping=left.mapping,
        association=left.association,operation_id=str(uuid4()),expected_revision=0,observed_at=datetime.now(timezone.utc))
    outputs=parallel(trial,[left.statement(),right.statement()])
    trial.check('concurrent_result_single_winner',sorted(o.returncode for o in outputs)==[0,3])
    trial.check('concurrent_result_single_effect',counts(trial,left)=={'results':1,'outcomes':1})
    winner=(left,right)[next(i for i,o in enumerate(outputs) if o.returncode==0)];inspect_result(trial,winner)
    identical=result_request(trial);outputs=parallel(trial,[identical.statement(),identical.statement()])
    records=[committed_pg_json(o.stdout,o.stderr,o.returncode) for o in outputs]
    trial.check('concurrent_exact_result_retry_identical',records[0]==records[1] and counts(trial,identical)=={'results':1,'outcomes':1})
    # A processed history and its original result remain after actual restart.
    history=trial.query(invented_pg_item_history_statement(request.feed_capture,request.association.feed_item_id))
    history_raw=committed_pg_json(history.stdout,history.stderr,history.returncode)
    current=parse_invented_pg_item_history(history_raw,request.feed_capture,item_id=request.association.feed_item_id,observed_at=datetime.now(timezone.utc))
    trial.check('processed_history_has_matching_result_event',current.state=='processed' and current.outcomes[0].operation_id==value.operation_id)
    trial.stop();trial.start();after_restart,after_raw=inspect_result(trial,request)
    trial.check('actual_result_restart_exact',after_restart==value and after_raw==raw)
    return {'firstOperationId':request.operation_id,'artifactId':value.artifact_id,'firstItemId':request.association.feed_item_id}


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented document trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_additional(trial);trial.create()
        fixture=trial.frozen['tests/fixtures/invented_document_results.sql'].decode('utf8')
        trial.query("begin;set local statement_timeout='10s';"+fixture+'commit;')
        result=cases(trial)
        trial.record('DOCUMENT_RESULT',{'state':'PASS_INVENTED_DOCUMENT_RESULT_CUSTODY','assertions':trial.assertions,'identities':result,
            'sourceRequests':0,'modelCalls':0,'primaryChanged':False,'ownerOnly':True,'applicationRoleAccepted':False,
            'semanticMappingQualified':False,'sourcePermissionIssued':False,'publicationEnabled':False})
    except BaseException as failure:
        trial.record('DOCUMENT_FAILURE',{'exceptionClass':type(failure).__name__,'state':'held','evidenceRetained':True})
        raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_DOCUMENT')
        if trial.identity is not None:trial.record('DOCUMENT_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_DOCUMENT_RESULT_CUSTODY','primaryChanged':False}))


if __name__=='__main__':main()
