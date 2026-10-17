"""Fresh owner-only read-only inventory and exact structural-prefix trial.

No queue engine, claim/lease, runtime role/grant, source fetch/poll, model or
schedule. Supplied fixed invented writes only prepare fixtures; the new API is
read-only and cannot substitute original byte/history/CAS before processing.
"""
from __future__ import annotations
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,seed,rss,entry,capture_context,capture
from scripts.rehearse_feed_windows import freeze_windows,initialize,successor,advance,snapshot,FIXTURE as WINDOW_FIXTURE
from workers.feed_collection_inventory import prepare_inventory_request,parse_collection_inventory_page
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json,MAX_CAPTURE_OUTPUT
from workers.feed_postgres_processing import prepare_invented_pg_outcome,parse_invented_pg_outcome,invented_pg_item_history_statement,parse_invented_pg_item_history
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_feed_inventory.sql'


def freeze_inventory(trial):
    names={'scripts/rehearse_feed_inventory.py','workers/feed_collection_inventory.py',FIXTURE};queue=list(names)
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
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Inventory dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as f:f.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
    trial.record('INVENTORY_SOURCE_BINDINGS',rows)
    trial.record('INVENTORY_SCOPE',{'ownerOnly':True,'readOnlyApi':True,'maximumItemsPerPage':20,
        'fixedCapturedPrefixOnly':True,'stateCoherentPerPageOnly':True,'processingGrantIssued':False,
        'rolesOrGrantsChanged':False,'sourceRequests':0,'modelCalls':0,'schedulesCreated':False,'primaryChanged':False})


def inventory(trial,request):
    output=trial.query(request.statement());raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    return parse_collection_inventory_page(raw,request,observed_at=datetime.now(timezone.utc)),raw


def history(trial,context,item):
    out=trial.query(invented_pg_item_history_statement(context,item));raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
    return parse_invented_pg_item_history(raw,context,item_id=item,observed_at=datetime.now(timezone.utc))


def outcome(trial,context,page_raw,item,revision,state):
    request=prepare_invented_pg_outcome(context,page_raw,observed_at=datetime.now(timezone.utc),item_id=item,
        operation_id=str(uuid4()),expected_revision=revision,state=state)
    output=trial.query(request.statement())
    return parse_invented_pg_outcome(committed_pg_json(output.stdout,output.stderr,output.returncode),request,observed_at=datetime.now(timezone.utc))


def direct(payload,*,isolation='repeatable read read only'):
    return HEAD+"set time zone 'UTC';begin isolation level "+isolation+';select tf_feed_inventory.page('+_literal(json.dumps(payload,separators=(',',':')))+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def refuse(trial,label,statement):
    before=snapshot(trial);out=trial.query(statement,allowed=True)
    trial.check(label+'_refused',out.returncode!=0 and bool(out.stderr))
    trial.check(label+'_rows_unchanged',snapshot(trial)==before)
    return out


def cases(trial):
    original=capture_context(rss(entry('repeated')+entry('held','http://127.0.0.1/private')+entry('processed')+entry('pending')),seed(trial))
    page,page_raw=capture(trial,original);scope=initialize(trial,original)
    failed=page.items[0].item_state_record_id;done=page.items[2].item_state_record_id
    outcome(trial,original,page_raw,failed,0,'failed');outcome(trial,original,page_raw,done,0,'processed')
    next_url='https://example.org/feed.xml?page=2'
    first=capture_context(rss(entry('repeated',title='Changed')+entry('new'),next_url),str(uuid4()),next_url=next_url)
    transition=successor(trial,scope,original,capture_context_override=first);advance(trial,transition)
    request=prepare_inventory_request(scope,item_limit=2);before=snapshot(trial)
    first_page,first_raw=inventory(trial,request)
    trial.check('inventory_read_preserves_all_native_rows',snapshot(trial)==before)
    trial.check('old_failed_and_parser_held_rediscovered',[row.processing_state for row in first_page.rows]==['failed','parse_held'])
    trial.check('inventory_returns_stable_original_references',first_page.rows[0].item_id==failed
        and first_page.rows[0].source_version_id==original.source.source_version_id and first_page.rows[0].capture_operation_id==original.operation_id)
    # Explicit original raw-bound history and live CAS, never inventory alone.
    recovered=history(trial,original,first_page.rows[0].item_id)
    trial.check('discovered_item_resolves_original_bytes_and_history',recovered.revision==1 and recovered.state=='failed')
    outcome(trial,original,page_raw,first_page.rows[0].item_id,recovered.revision,'processed')
    # Append both a later page in this window and a whole later window. Neither
    # belongs to the retained first observation's structural prefix.
    later_page=capture_context(rss(entry('later-page')),first.stream_id,revision=1,url=next_url);capture(trial,later_page)
    third=successor(trial,scope,later_page,raw=rss(entry('later-window')));advance(trial,third)
    rows=list(first_page.rows);cursor=first_page.next_cursor;cuts=[]
    while cursor is not None:
        request=prepare_inventory_request(scope,item_limit=2,cut=first_page.cut,after=cursor)
        observed,_=inventory(trial,request);rows.extend(observed.rows);cuts.append(observed.cut);cursor=observed.next_cursor
    trial.check('retained_cut_excludes_later_page_and_window',len(rows)==6 and all(cut==first_page.cut for cut in cuts)
        and max(row.position.window_revision for row in rows)==2
        and all(row.position.page_revision==1 for row in rows))
    trial.check('stable_keyset_no_duplicate_or_missing_occurrence',len({row.item_id for row in rows})==6
        and [row.position for row in rows]==sorted(row.position for row in rows))
    trial.check('earlier_page_keeps_its_observed_failed_state',rows[0].processing_state=='failed')
    fresh_request=prepare_inventory_request(scope,item_limit=20);fresh,fresh_raw=inventory(trial,fresh_request)
    trial.check('fresh_scan_includes_new_rows_and_new_state',len(fresh.rows)==8 and fresh.cut.window_revision==3
        and next(row for row in fresh.rows if row.item_id==failed).processing_state=='processed')
    trial.check('repeated_identity_is_separate_pending_work',sum(row.entry_id=='repeated' for row in fresh.rows)==2
        and next(row for row in fresh.rows if row.capture_operation_id==first.operation_id and row.entry_id=='repeated').processing_state=='pending')
    contexts={value.operation_id:value for value in (original,first,later_page,third.first_capture)}
    resolved=[]
    for row in fresh.rows:
        parsed=history(trial,contexts[row.capture_operation_id],row.item_id)
        resolved.append(parsed.state==row.processing_state and parsed.revision==row.outcome_revision)
    trial.check('all_inventory_refs_resolve_actual_original_history',all(resolved))
    base=json.loads(prepare_inventory_request(scope,item_limit=2,cut=first_page.cut,after=first_page.next_cursor).canonical_input)
    mutations=[('missing_limit',lambda p:p.pop('item_limit')),('extra_root',lambda p:p.update(extra=True)),
        ('null_scope',lambda p:p.update(scope=None)),('extra_scope',lambda p:p['scope'].update(extra=True)),
        ('foreign_collection',lambda p:p['scope'].update(collection_id=str(uuid4()))),
        ('wrong_source',lambda p:p['scope'].update(source_key='fictional-foreign')),
        ('bool_limit',lambda p:p.update(item_limit=True)),('over_limit',lambda p:p.update(item_limit=21)),
        ('missing_cut_field',lambda p:p['cut'].pop('page_id')),('null_cut_time',lambda p:p['cut'].update(page_stored_at=None)),
        ('bool_cut_revision',lambda p:p['cut'].update(window_revision=True)),
        ('foreign_cut_stream',lambda p:p['cut'].update(stream_id=str(uuid4()))),
        ('foreign_cut_page',lambda p:p['cut'].update(page_id=str(uuid4()))),
        ('changed_cut_time',lambda p:p['cut'].update(page_stored_at='2026-10-14T00:00:00.000000Z')),
        ('unknown_cursor_position',lambda p:p['after'].update(item_position=50)),
        ('cursor_outside_cut',lambda p:p['after'].update(window_revision=3)),
        ('cursor_without_cut',lambda p:p.update(cut=None)),
        ('extra_cursor',lambda p:p['after'].update(extra=True))]
    for label,change in mutations:
        altered=json.loads(json.dumps(base));change(altered);refuse(trial,label,direct(altered))
    refuse(trial,'read_committed_context',direct(json.loads(fresh_request.canonical_input),isolation='read committed read only'))
    refuse(trial,'writable_context',direct(json.loads(fresh_request.canonical_input),isolation='repeatable read'))
    # No item rows in a captured source is a finite empty-prefix inventory,
    # never complete history or absence of a real country's problems.
    empty=capture_context(rss(),seed(trial));capture(trial,empty);empty_scope=initialize(trial,empty)
    empty_page,_=inventory(trial,prepare_inventory_request(empty_scope))
    trial.check('actual_empty_captured_prefix',empty_page.rows==() and empty_page.next_cursor is None)
    # Exercise the newly introduced20item×8event bound through real native JSON.
    maximal=capture_context(rss(''.join(entry('😀'*297+str(i)) for i in range(20))),seed(trial))
    max_page,max_raw=capture(trial,maximal);max_scope=initialize(trial,maximal)
    statements=[]
    for item in max_page.items:
        for revision in range(8):
            statements.append('perform tf_feed_rehearsal.record_outcome('+_literal(str(uuid4()))+'::uuid,'+
                _literal(item.item_state_record_id)+f"::uuid,{revision},'failed');")
    trial.query("set time zone 'UTC';set statement_timeout='10s';begin;do $$begin "+''.join(statements)+'end$$;commit;')
    maximal_inventory,maximal_raw=inventory(trial,prepare_inventory_request(max_scope,item_limit=20))
    trial.check('actual_twenty_by_eight_bounded_output',len(maximal_inventory.rows)==20 and len(maximal_raw)<=MAX_CAPTURE_OUTPUT
        and all(row.outcome_revision==8 and row.processing_state=='failed' for row in maximal_inventory.rows))
    trial.record('INVENTORY_MAX_OUTPUT',{'rows':20,'eventsPerItem':8,'actualBytes':len(maximal_raw),'limitBytes':MAX_CAPTURE_OUTPUT})
    before=snapshot(trial)
    denied=trial.query('set session authorization pg_monitor;'+fresh_request.statement(),allowed=True)
    trial.check('private_inventory_nonowner_denied',denied.returncode!=0 and b'permission denied' in denied.stderr.lower())
    trial.check('nonowner_read_denial_changes_no_rows',snapshot(trial)==before)
    trial.stop();trial.start()
    restarted,_=inventory(trial,fresh_request)
    trial.check('actual_restart_rediscovers_rows_and_state',restarted.rows==fresh.rows and restarted.cut==fresh.cut)
    trial.check('all_final_inventory_reads_leave_journal_exact',snapshot(trial)==before)
    return {'collectionId':scope.collection_id,'retainedCutWindow':first_page.cut.window_revision,'freshCutWindow':fresh.cut.window_revision,
        'firstObservedRows':6,'freshObservedRows':8,'currentStatesPerPageOnly':True,
        'processingGrantIssued':False,'actualWorkerOrSourceAccepted':False}


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented inventory trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_windows(trial);freeze_inventory(trial);trial.create()
        trial.query("begin;set local statement_timeout='10s';"+trial.frozen[WINDOW_FIXTURE].decode()+trial.frozen[FIXTURE].decode()+'commit;')
        result=cases(trial)
        trial.record('INVENTORY_RESULT',{'state':'PASS_INVENTED_COLLECTION_INVENTORY','assertions':trial.assertions,
            'identities':result,'primaryChanged':False,'sourceRequests':0,'modelCalls':0,'rolesOrGrantsChanged':False})
    except BaseException as failure:
        trial.record('INVENTORY_FAILURE',{'state':'held','exceptionClass':type(failure).__name__,'evidenceRetained':True});raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_INVENTORY')
        if trial.identity is not None:trial.record('INVENTORY_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_COLLECTION_INVENTORY','primaryChanged':False}))


if __name__=='__main__':main()
