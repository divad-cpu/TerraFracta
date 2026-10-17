"""Fixed fresh owner-only invented recurrent-window transaction laboratory.

No old target, role/grant, login/password, source request or schedule. New first
page/all items and successful collection head commit together, or all roll back.
"""
from __future__ import annotations
import ast
from dataclasses import replace
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, FeedPgTrialError, seed, rss, entry, capture_context, capture
from scripts.feed_postgres_trial_cases import parallel
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER, committed_pg_json
from workers.feed_postgres_processing import prepare_invented_pg_outcome, parse_invented_pg_outcome, invented_pg_item_history_statement, parse_invented_pg_item_history
from workers.feed_window_lineage import (
    InventedCollectionScope, FeedWindowLineageError, invented_collection_head_statement, parse_invented_collection_head,
    prepare_invented_window_advance, invented_window_receipt_statement, parse_invented_window_started,
)
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_feed_windows.sql'


def freeze_windows(trial):
    names={'scripts/rehearse_feed_windows.py',FIXTURE,'workers/feed_window_lineage.py'};queue=list(names)
    while queue:
        name=queue.pop()
        if not name.endswith('.py'):continue
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    rows=[]
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if raw!=trial.frozen[name]:raise FeedPgTrialError('Window input changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as f:f.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
    trial.record('WINDOW_SOURCE_BINDINGS',rows)
    trial.record('WINDOW_SCOPE',{'ownerOnly':True,'windowLimit':32,'pageLimitPerStream':64,
        'rolesOrGrantsChanged':False,'collectionPermissionIssued':False,'schedulesCreated':False,
        'sourceHistoryComplete':False,'primaryChanged':False})


def current(trial,scope,previous):
    out=trial.query(invented_collection_head_statement(scope,previous));raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
    return parse_invented_collection_head(raw,scope,previous,observed_at=datetime.now(timezone.utc)),raw


def initialize(trial,previous):
    scope=InventedCollectionScope(str(uuid4()),previous.source.source_key,'https://example.org/feed.xml',previous.format)
    trial.query('begin;select tf_feed_windows.initialize('+_literal(scope.collection_id)+'::uuid,'+_literal(previous.stream_id)+'::uuid);commit;')
    return scope


def successor(trial,scope,previous,raw=None,*,head=None,capture_context_override=None):
    if head is None:_,head=current(trial,scope,previous)
    first=capture_context_override or capture_context(raw or rss(entry('repeated')+entry('independent')),str(uuid4()))
    return prepare_invented_window_advance(scope,previous,head,first,observed_at=datetime.now(timezone.utc))


def advance(trial,request):
    out=trial.query(request.statement());raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
    return parse_invented_window_started(raw,request,observed_at=datetime.now(timezone.utc)),raw


def inspect_window(trial,request):
    out=trial.query(invented_window_receipt_statement(request));raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
    return parse_invented_window_started(raw,request,observed_at=datetime.now(timezone.utc)),raw


def snapshot(trial,*,old_stream=None):
    # Hash exact canonical complete-row arrays inside native SQL to keep the
    # response bounded even at32 windows and two actual64-page predecessors.
    tables=[('streams','tf_feed_rehearsal.streams','id'),('pages','tf_feed_rehearsal.pages','operation_id'),
        ('items','tf_feed_rehearsal.items','item_id'),('outcomes','tf_feed_rehearsal.outcomes','operation_id')]
    if old_stream is None:tables += [('collections','tf_feed_windows.collections','id'),('windows','tf_feed_windows.windows','operation_id')]
    fields=[]
    for key,table,order in tables:
        where=''
        if old_stream is not None:
            literal=_literal(old_stream)+'::uuid'
            where=' where '+('id='+literal if key=='streams' else 'stream_id='+literal if key in ('pages','items') else 'item_id in (select item_id from tf_feed_rehearsal.items where stream_id='+literal+')')
        fields += [_literal(key),"(select jsonb_build_object('rows',jsonb_array_length(body),'bytes',octet_length(body::text),'sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from (select coalesce(jsonb_agg(to_jsonb(t) order by "+order+"),'[]'::jsonb) body from "+table+' t'+where+') scope)']
    return json.loads(trial.query('begin isolation level repeatable read read only;select jsonb_build_object('+','.join(fields)+');commit;').stdout)


def refuse(trial,label,statement):
    before=snapshot(trial);out=trial.query(statement,allowed=True)
    trial.check(label+'_refused',out.returncode!=0 and bool(out.stderr))
    trial.check(label+'_exact_rows_unchanged',snapshot(trial)==before)
    return out


def direct(payload,after=''):
    return HEAD+'begin;select tf_feed_windows.advance('+_literal(json.dumps(payload,separators=(',',':')))+'::jsonb);'+after+'commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'


def raw_successor(scope,previous,head,first):
    # Negative native tests intentionally bypass pure admission, never claim
    # these owner-supplied malformed requests were issued by the typed port.
    return {'collection_id':scope.collection_id,'expected_window_revision':head.window_revision,
        'previous_stream_id':previous.stream_id,'previous_page_id':head.page.page.page_record_id,
        'capture':json.loads(first.canonical_input)}


def cases(trial):
    empty=seed(trial)
    refuse(trial,'uncaptured_initial_collection',"begin;select tf_feed_windows.initialize("+_literal(str(uuid4()))+"::uuid,"+_literal(empty)+"::uuid);commit;")
    previous=capture_context(rss(entry('repeated')+entry('held','http://127.0.0.1/private')+entry('old-only')),seed(trial))
    initial,initial_raw=capture(trial,previous);scope=initialize(trial,previous)
    old_item=initial.items[0].item_state_record_id
    failure=prepare_invented_pg_outcome(previous,initial_raw,observed_at=datetime.now(timezone.utc),item_id=old_item,
        operation_id=str(uuid4()),expected_revision=0,state='failed')
    out=trial.query(failure.statement());parse_invented_pg_outcome(committed_pg_json(out.stdout,out.stderr,out.returncode),failure,observed_at=datetime.now(timezone.utc))
    old_rows=snapshot(trial,old_stream=previous.stream_id)
    first=successor(trial,scope,previous,raw=rss(entry('repeated',title='Changed metadata')+entry('new-only')))
    # Each constraint fails at a different point after new stream allocation.
    for table,label in [('pages','page_insert'),('items','item_insert'),('tf_feed_windows.windows','after_first_capture')]:
        name=table if '.' in table else 'tf_feed_rehearsal.'+table
        trial.query('alter table '+name+' add constraint trial_window_denied check(false) not valid;')
        refuse(trial,label,first.statement())
        trial.query('alter table '+name+' drop constraint trial_window_denied;')
    out=refuse(trial,'post_head_precommit_abort',first.statement().replace('commit;','select 1/0;commit;'))
    try:committed_pg_json(out.stdout,out.stderr,out.returncode)
    except ValueError:trial.check('precommit_window_output_withheld',True)
    else:trial.check('precommit_window_output_withheld',False)
    value,first_raw=advance(trial,first)
    trial.check('new_page_all_occurrences_and_successful_head',value.window_revision==2 and len(value.page.items)==2)
    trial.check('old_pending_failed_rows_retained',snapshot(trial,old_stream=previous.stream_id)==old_rows)
    trial.check('repeated_id_new_pending_occurrence',value.page.items[0].processing_state=='pending'
        and value.page.items[0].item_state_record_id!=old_item)
    replay,replay_raw=advance(trial,first);trial.check('exact_window_retry_one_receipt',replay==value and replay_raw==first_raw)
    second=successor(trial,scope,first.first_capture);_,second_raw=advance(trial,second)
    historical,historical_raw=advance(trial,first)
    head,_=current(trial,scope,second.first_capture)
    trial.check('historical_retry_not_current_head',historical_raw==first_raw and historical.window_revision==2 and head.window_revision==3)
    lost=successor(trial,scope,second.first_capture)
    out=trial.query(lost.statement().replace('\\echo '+COMMIT_MARKER.decode(),'-- deliberately withheld acknowledgement'))
    try:committed_pg_json(out.stdout,out.stderr,out.returncode)
    except ValueError:trial.check('committed_window_ack_loss_uncertain',True)
    else:trial.check('committed_window_ack_loss_uncertain',False)
    recovered,recovered_raw=inspect_window(trial,lost);_,retry_raw=advance(trial,lost)
    trial.check('lost_ack_inspection_exact_retry',recovered_raw==retry_raw and recovered.window_revision==4)
    # Closed direct native JSON/profile/CAS/time refusals preserve every table.
    p=json.loads(lost.canonical_input)
    changes=[('null_collection',lambda x:x.update(collection_id=None)),('extra_root',lambda x:x.update(extra=True)),
        ('bool_revision',lambda x:x.update(expected_window_revision=True)),
        ('foreign_collection',lambda x:x.update(collection_id=str(uuid4()))),
        ('conflicting_operation',lambda x:x.update(previous_page_id=str(uuid4()))),
        ('changed_replay_payload',lambda x:x['capture'].update(advertised_next_url='https://example.org/feed.xml?changed=1'))]
    for label,mutation in changes:
        altered=json.loads(json.dumps(p));mutation(altered);refuse(trial,label,direct(altered))
    fresh=successor(trial,scope,lost.first_capture);newp=json.loads(fresh.canonical_input)
    changes=[('wrong_predecessor',lambda x:x.update(previous_stream_id=str(uuid4()))),
        ('wrong_page',lambda x:x.update(previous_page_id=str(uuid4()))),
        ('stale_window_revision',lambda x:x.update(expected_window_revision=3)),
        ('wrong_format',lambda x:x['capture'].update(format='atom10')),
        ('wrong_initial_endpoint',lambda x:x['capture']['source'].update(feed_url='https://example.org/feed.xml?foreign=1')),
        ('wrong_source',lambda x:x['capture']['source'].update(source_key='fictional-foreign')),
        ('regressing_observation',lambda x:x['capture']['source'].update(retrieved_at='2026-10-13T00:00:00.000000Z')),
        ('future_observation',lambda x:x['capture']['source'].update(retrieved_at='2099-10-14T00:00:00.000000Z')),
        ('old_source_version_reused',lambda x:x['capture']['source'].update(source_version_id=previous.source.source_version_id))]
    for label,mutation in changes:
        altered=json.loads(json.dumps(newp));mutation(altered);refuse(trial,label,direct(altered))
    trial.query("update tf_feed_windows.collections set created_at=created_at+interval '1 day' where id="+_literal(scope.collection_id)+'::uuid;')
    refuse(trial,'future_native_predecessor_clock',fresh.statement())
    trial.query("update tf_feed_windows.collections set created_at=created_at-interval '1 day' where id="+_literal(scope.collection_id)+'::uuid;')
    competing=successor(trial,scope,lost.first_capture)
    outputs=parallel(trial,[fresh.statement(),competing.statement()])
    trial.check('same_head_competition_one_winner',sorted(o.returncode for o in outputs)==[0,3])
    winner=(fresh,competing)[next(i for i,o in enumerate(outputs) if o.returncode==0)]
    _,winner_raw=inspect_window(trial,winner);head,_=current(trial,scope,winner.first_capture)
    trial.check('same_head_competition_one_window',head.window_revision==5)
    exact=successor(trial,scope,winner.first_capture);outputs=parallel(trial,[exact.statement(),exact.statement()])
    records=[committed_pg_json(o.stdout,o.stderr,o.returncode) for o in outputs]
    trial.check('concurrent_exact_retry_one_effect',records[0]==records[1])
    head,_=current(trial,scope,exact.first_capture);trial.check('concurrent_exact_retry_one_head',head.window_revision==6)
    latest=exact.first_capture
    # Actual incomplete and permission-held windows cannot be recycled.
    for allowed,label in [(True,'incomplete_next_ready'),(False,'unresolved_next_permission')]:
        next_url='https://example.org/feed.xml?page=2';incomplete=capture_context(rss(entry('partial'),next_url),seed(trial),next_url=next_url if allowed else None)
        capture(trial,incomplete);partial_scope=initialize(trial,incomplete);partial_head,partial_raw=current(trial,partial_scope,incomplete)
        candidate=capture_context(rss(entry('would-repoll')),str(uuid4()))
        try:prepare_invented_window_advance(partial_scope,incomplete,partial_raw,candidate,observed_at=datetime.now(timezone.utc))
        except FeedWindowLineageError:trial.check(label+'_pure_held',True)
        else:trial.check(label+'_pure_held',False)
        refuse(trial,label+'_native_held',direct(raw_successor(partial_scope,incomplete,partial_head,candidate)))
    mixed_stream=seed(trial);next_url='https://example.org/feed.xml?page=2'
    mixed_first=capture_context(rss(entry('rss'),next_url),mixed_stream,next_url=next_url);capture(trial,mixed_first)
    atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:invented</id><title>Invented</title><updated>2026-10-14T00:00:00Z</updated><entry><id>urn:item</id><title>Invented</title><link href="https://example.org/doc"/></entry></feed>'
    mixed_last=capture_context(atom,mixed_stream,revision=1,url=next_url,format='atom10');capture(trial,mixed_last)
    refuse(trial,'mixed_source_format_not_qualified',"begin;select tf_feed_windows.initialize("+_literal(str(uuid4()))+"::uuid,"+_literal(mixed_stream)+"::uuid);commit;")
    # Boundary state, not page count alone, governs the64-page edge. Both are
    # real native traversals; no owner edit fabricates a quota/predecessor proof.
    for terminal,label in [(False,'actual_page64_incomplete'),(True,'actual_page64_boundary')]:
        stream=seed(trial);prior=None
        for index in range(64):
            url='https://example.org/feed.xml' if index==0 else 'https://example.org/feed.xml?page='+str(index+1)
            next_url=None if terminal and index==63 else 'https://example.org/feed.xml?page='+str(index+2)
            prior=capture_context(rss(entry('page-'+str(index+1)),next_url),stream,revision=index,url=url,next_url=next_url)
            capture(trial,prior)
        scoped=initialize(trial,prior);actual,proof=current(trial,scoped,prior);candidate=capture_context(rss(entry('new-root')),str(uuid4()))
        if terminal:
            accepted=prepare_invented_window_advance(scoped,prior,proof,candidate,observed_at=datetime.now(timezone.utc))
            accepted_value,_=advance(trial,accepted);trial.check(label+'_new_window_allowed',accepted_value.window_revision==2)
        else:
            refuse(trial,label+'_cannot_reset_quota',direct(raw_successor(scoped,prior,actual,candidate)))
    # Finite collection quota is distinct from per-stream traversal limits.
    while head.window_revision<32:
        request=successor(trial,scope,latest);advance(trial,request);latest=request.first_capture;head,_=current(trial,scope,latest)
    trial.check('actual_collection_limit32_reached',head.window_revision==32)
    cap=capture_context(rss(entry('over-cap')),str(uuid4()))
    refuse(trial,'actual_collection_limit32_refuses33',direct(raw_successor(scope,latest,head,cap)))
    trial.check('all_earlier_pending_failed_rows_survive_many_polls',snapshot(trial,old_stream=previous.stream_id)==old_rows)
    # Old work can still be completed independently; no new occurrence adopts it.
    done=prepare_invented_pg_outcome(previous,initial_raw,observed_at=datetime.now(timezone.utc),item_id=old_item,
        operation_id=str(uuid4()),expected_revision=1,state='processed')
    out=trial.query(done.statement());parse_invented_pg_outcome(committed_pg_json(out.stdout,out.stderr,out.returncode),done,observed_at=datetime.now(timezone.utc))
    history=trial.query(invented_pg_item_history_statement(previous,old_item));history_raw=committed_pg_json(history.stdout,history.stderr,history.returncode)
    parsed=parse_invented_pg_item_history(history_raw,previous,item_id=old_item,observed_at=datetime.now(timezone.utc))
    trial.check('old_failed_then_processed_remains_independent',parsed.state=='processed' and [o.state for o in parsed.outcomes]==['failed','processed'])
    denied=trial.query('set session authorization pg_monitor;'+invented_window_receipt_statement(first),allowed=True)
    trial.check('nonowner_private_window_api_denied',denied.returncode!=0 and b'permission denied' in denied.stderr.lower())
    trial.stop();trial.start()
    _,restarted_raw=inspect_window(trial,first);final,_=current(trial,scope,latest)
    trial.check('actual_restart_historical_and_current_lineage',restarted_raw==first_raw and final.window_revision==32)
    trial.record('WINDOW_FINAL_HEAD',{'collectionId':scope.collection_id,'windowRevision':final.window_revision,'streamId':final.stream_id})
    return {'collectionId':scope.collection_id,'firstSuccessorOperationId':first.first_capture.operation_id,
        'currentWindowRevision':32,'newSourcePermissions':False,'newRuntimeGrants':False,'actualRecurrentCollectorAccepted':False}


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented collection trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_windows(trial);trial.create()
        trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode('utf8')+'commit;')
        result=cases(trial)
        trial.record('WINDOW_RESULT',{'state':'PASS_INVENTED_COLLECTION_WINDOWS','assertions':trial.assertions,'identities':result,
            'primaryChanged':False,'sourceRequests':0,'modelCalls':0,'schedulesCreated':False,'rolesOrGrantsChanged':False})
    except BaseException as failure:
        trial.record('WINDOW_FAILURE',{'state':'held','exceptionClass':type(failure).__name__,'evidenceRetained':True});raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_WINDOWS')
        if trial.identity is not None:trial.record('WINDOW_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_COLLECTION_WINDOWS','primaryChanged':False}))


if __name__=='__main__':main()
