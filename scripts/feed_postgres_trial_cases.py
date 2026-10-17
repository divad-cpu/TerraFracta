"""Invented negative/concurrency cases for the fresh owned PostgreSQL trial.

No connection selection: the reviewed custodian supplies its exact owned ID,
controlled local daemon command and bounded native process channel.
"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
import json
import subprocess
import time
from uuid import uuid4

from workers.bounded_worker_process import communicate_bounded
from workers.feed_postgres_contract import (
    COMMIT_MARKER,HEAD,FeedPostgresContractError,committed_pg_json,parse_invented_pg_readback,
)
from workers.feed_postgres_processing import (
    prepare_invented_pg_outcome,parse_invented_pg_outcome,
    invented_pg_item_history_statement,parse_invented_pg_item_history,
)
from workers.pair_native_sql import _literal


def snapshot(trial,stream):
    sql="""begin isolation level repeatable read read only;
    select jsonb_build_object('revision',s.revision,'state',s.state,'next_url',s.next_url,
     'pages',(select count(*) from tf_feed_rehearsal.pages where stream_id=s.id),
     'items',(select count(*) from tf_feed_rehearsal.items where stream_id=s.id),
     'outcomes',(select count(*) from tf_feed_rehearsal.outcomes o join tf_feed_rehearsal.items i using(item_id) where i.stream_id=s.id))
    from tf_feed_rehearsal.streams s where id="""+_literal(stream)+"::uuid;commit;"
    return json.loads(trial.query(sql).stdout)


def refused(trial,label,statement,stream,before):
    output=trial.query(statement,allowed=True)
    trial.check(label+'_exit',type(output.returncode) is int and output.returncode!=0 and bool(output.stderr))
    trial.check(label+'_unchanged',snapshot(trial,stream)==before)
    return output


def payload_statement(payload,*,after=''):
    return HEAD+'begin;select tf_feed_rehearsal.capture('+_literal(json.dumps(payload,separators=(',',':')))+"::jsonb);"+after+'commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'


def parallel(trial,statements):
    """Launch each fixed local psql before collecting bounded complete streams."""
    trial.inspect();processes=[]
    args=trial.command(['docker','exec','-i',trial.identity,
        '/nix/var/nix/profiles/default/bin/psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'])
    with ThreadPoolExecutor(max_workers=len(statements)) as pool:
        futures=[]
        try:
            for statement in statements:
                process=subprocess.Popen(args,env=trial.environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                processes.append(process)
                futures.append(pool.submit(communicate_bounded,process,statement.encode(),timeout=12,
                    max_input=294912,max_stdout=131072,max_stderr=4096))
            results=[future.result() for future in futures]
        finally:
            for process in processes:
                if process.poll() is None:process.kill()
                process.wait(timeout=5)
    for statement,result in zip(statements,results,strict=True):
        trial.counter+=1
        trial.record(f'{trial.counter:03d}_PARALLEL',{'argv':args,'returncode':result.returncode,'inputSQL':statement,
            'stdout':result.stdout.decode('utf8'),'stderr':result.stderr.decode('utf8')})
    return results


def outcome(trial,item,revision,state,operation=None,allowed=False):
    operation=operation or str(uuid4())
    statement=HEAD+'begin;select tf_feed_rehearsal.record_outcome('+_literal(operation)+'::uuid,'+_literal(item)+f'::uuid,{revision},'+_literal(state)+');commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    result=trial.query(statement,allowed=allowed)
    return operation,statement,result


def adversarial(trial,*,seed,rss,entry,context,capture,readback):
    # Real partial write and post-SELECT abort: every page/item/cursor rolls back.
    stream=seed(trial);c=context(rss(entry('first')+entry('second')),stream);before=snapshot(trial,stream)
    malformed=json.loads(c.canonical_input);malformed['items'][1]['locator']='feed-entry:9'
    refused(trial,'partial_item_insert_rollback',payload_statement(malformed),stream,before)
    aborted=refused(trial,'post_select_precommit_abort',payload_statement(json.loads(c.canonical_input),after='select 1/0;'),stream,before)
    trial.check('precommit_select_was_emitted',b'invented_feed_pg_page' in aborted.stdout)
    try:committed_pg_json(aborted.stdout,aborted.stderr,aborted.returncode)
    except FeedPostgresContractError:trial.check('precommit_select_withheld',True)
    else:trial.check('precommit_select_withheld',False)
    # Closed direct SQL structure; trusted Python parser binding is separate.
    mutations=[('extra_root',lambda p:p.update(extra=True)),('bad_hash',lambda p:p['source'].update(content_sha256='0'*64)),
        ('boolean_revision',lambda p:p.update(expected_revision=True)),('foreign_source',lambda p:p['source'].update(source_key='fictional-other')),
        ('extra_source',lambda p:p['source'].update(extra='held')),('out_of_order',lambda p:p['items'][0].update(position=2)),
        ('unapproved_next',lambda p:p.update(allowed_next_url='https://example.org/feed.xml?page=9')),
        ('duplicate_pending',lambda p:p['items'][1].update(entry_id=p['items'][0]['entry_id']))]
    for label,mutate in mutations:
        payload=json.loads(c.canonical_input);mutate(payload)
        refused(trial,label,payload_statement(payload),stream,before)
    value,record=capture(trial,c);after=snapshot(trial,stream)
    # Same key with changed input refuses; source version cannot be duplicated.
    changed=context(rss(entry('changed')),stream,operation=c.operation_id)
    refused(trial,'conflicting_operation',changed.statement(),stream,after)
    # A deliberately lost local acknowledgement is uncertain, then inspected.
    try:committed_pg_json(b'',b'',0)
    except FeedPostgresContractError:trial.check('lost_commit_output_is_uncertain',True)
    else:trial.check('lost_commit_output_is_uncertain',False)
    recovered,recovered_record=readback(trial,c)
    trial.check('inspect_after_lost_output',recovered==value and recovered_record==record and snapshot(trial,stream)==after)
    # Actual native bytes/metadata tamper cannot pass the trusted readback port.
    expected_raw=c.raw
    result=trial.query("begin;select tf_feed_rehearsal.page_receipt("+_literal(c.operation_id)+"::uuid,decode('00','hex'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n')
    wrong=committed_pg_json(result.stdout,result.stderr,result.returncode)
    try:parse_invented_pg_readback(wrong,c,observed_at=datetime.now(timezone.utc))
    except FeedPostgresContractError:trial.check('native_raw_comparison_refuses_wrong_input',True)
    else:trial.check('native_raw_comparison_refuses_wrong_input',False)
    trial.check('original_raw_unchanged',c.raw==expected_raw)
    # Real committed database call with its acknowledgement marker absent.
    # Failure of the closed channel cannot be interpreted as remote rollback.
    stream=seed(trial);c=context(rss(entry('lost-native-ack')),stream)
    lost=trial.query(c.statement().replace('\\echo '+COMMIT_MARKER.decode(),'-- deliberately withheld marker'))
    try:committed_pg_json(lost.stdout,lost.stderr,lost.returncode)
    except FeedPostgresContractError:trial.check('actual_missing_native_marker_is_uncertain',True)
    else:trial.check('actual_missing_native_marker_is_uncertain',False)
    recovered,recovered_raw=readback(trial,c)
    trial.check('actual_commit_found_by_inspection',recovered.cursor.revision==1 and snapshot(trial,stream)['pages']==1)
    _,retry_raw=capture(trial,c)
    trial.check('actual_lost_ack_retry_one_effect',retry_raw==recovered_raw and snapshot(trial,stream)['items']==1)
    # Disconnect this exact owned query backend after writes but before COMMIT.
    stream=seed(trial);c=context(rss(entry('disconnect')),stream);before=snapshot(trial,stream)
    disconnect=c.statement().replace('commit;','select pg_terminate_backend(pg_backend_pid());commit;')
    terminated=refused(trial,'self_backend_disconnect_rollback',disconnect,stream,before)
    try:committed_pg_json(terminated.stdout,terminated.stderr,terminated.returncode)
    except FeedPostgresContractError:trial.check('disconnect_partial_select_withheld',True)
    else:trial.check('disconnect_partial_select_withheld',False)
    # A separately owned row lock causes a bounded refusal, never cursor drift.
    stream=seed(trial);c=context(rss(entry('locked')),stream);before=snapshot(trial,stream)
    trial.inspect()
    args=trial.command(['docker','exec','-i',trial.identity,'/nix/var/nix/profiles/default/bin/psql',
        '-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'])
    holding="set application_name='tf_feed_owned_lock';begin;select id from tf_feed_rehearsal.streams where id="+_literal(stream)+"::uuid for update;select pg_sleep(2);rollback;"
    process=subprocess.Popen(args,env=trial.environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(communicate_bounded,process,holding.encode(),timeout=8,max_input=294912,max_stdout=131072,max_stderr=4096)
        try:
            ready=False
            for _ in range(30):
                observed=trial.query("select count(*) from pg_stat_activity where application_name='tf_feed_owned_lock' and wait_event='PgSleep';")
                if observed.stdout.strip()==b'1':ready=True;break
                time.sleep(.02)
            trial.check('owned_lock_observed',ready)
            statement=c.statement().replace("set lock_timeout='1s'","set lock_timeout='100ms'")
            refused(trial,'owned_lock_timeout_no_advance',statement,stream,before)
            holder=future.result();trial.check('owned_lock_holder_clean_exit',holder.returncode==0 and not holder.stderr)
            trial.record('OWNED_LOCK_HOLDER',{'argv':args,'inputSQL':holding,'returncode':holder.returncode,'stdout':holder.stdout.decode(),'stderr':holder.stderr.decode()})
        finally:
            if process.poll() is None:process.kill()
            process.wait(timeout=5)
    # Missing next permission stores the page but never allows traversal.
    stream=seed(trial);nxt='https://example.org/feed.xml?page=2'
    unresolved=context(rss(entry('held-next'),nxt),stream)
    result,_=capture(trial,unresolved);before=snapshot(trial,stream)
    trial.check('missing_next_permission_is_unresolved',result.cursor.state=='next_permission_unresolved' and result.cursor.next_url is None)
    successor=context(rss(entry('not-allowed')),stream,revision=1,url=nxt)
    refused(trial,'unresolved_cursor_no_successor',successor.statement(),stream,before)
    # Empty valid page is retained, not confused with collection failure.
    stream=seed(trial);empty=context(rss(),stream);result,_=capture(trial,empty)
    trial.check('empty_page_native',not result.items and snapshot(trial,stream)['pages']==1 and result.cursor.state=='window_boundary')
    # Competing distinct operations at the same predecessor: one effect only.
    stream=seed(trial);left=context(rss(entry('left')),stream);right=context(rss(entry('right')),stream)
    results=parallel(trial,[x.statement().replace('commit;','select pg_sleep(0.1);commit;') for x in (left,right)])
    # pg_sleep emits an extra row, so direct capture framing would intentionally
    # refuse this contention probe. Read winning committed page independently.
    trial.check('concurrent_predecessor_single_winner',sorted(r.returncode for r in results)==[0,3])
    current=snapshot(trial,stream)
    trial.check('concurrent_predecessor_single_effect',(current['revision'],current['pages'],current['items'])==(1,1,1))
    winner=(left,right)[next(i for i,r in enumerate(results) if r.returncode==0)]
    winning,_=readback(trial,winner);trial.check('concurrent_winner_readback',winning.cursor.revision==1)
    # Concurrent exact retry is idempotent; no second native item/page.
    stream=seed(trial);c=context(rss(entry('same')),stream)
    results=parallel(trial,[c.statement(),c.statement()])
    rows=[committed_pg_json(r.stdout,r.stderr,r.returncode) for r in results]
    trial.check('concurrent_exact_retry_identical',rows[0]==rows[1])
    trial.check('concurrent_exact_retry_one_effect',snapshot(trial,stream)['pages']==1 and snapshot(trial,stream)['items']==1)
    # Processing history is separate from immutable capture receipt.
    stream=seed(trial);c=context(rss(entry('process')+entry('bad','http://127.0.0.1/')),stream)
    value,original=capture(trial,c);item=value.items[0].item_state_record_id;held=value.items[1].item_state_record_id
    op,failed_stmt,failed=outcome(trial,item,0,'failed')
    first=committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    _,_,done=outcome(trial,item,1,'processed');committed_pg_json(done.stdout,done.stderr,done.returncode)
    replay=trial.query(failed_stmt)
    trial.check('old_failure_replay_is_historical',committed_pg_json(replay.stdout,replay.stderr,replay.returncode)==first)
    before=snapshot(trial,stream)
    _,_,terminal=outcome(trial,item,2,'failed',allowed=True)
    trial.check('terminal_not_reopened',terminal.returncode!=0 and snapshot(trial,stream)==before)
    _,_,parse_held=outcome(trial,held,0,'processed',allowed=True)
    trial.check('parse_held_not_processed',parse_held.returncode!=0 and snapshot(trial,stream)==before)
    _,again=readback(trial,c);trial.check('processing_does_not_rewrite_capture',again==original)
    trial.check('failed_history_retained',before['outcomes']==2)
    # Per-item bounded retries, with no ninth event.
    stream=seed(trial);c=context(rss(entry('bounded')),stream);value,_=capture(trial,c);item=value.items[0].item_state_record_id
    for revision in range(8):
        _,_,event=outcome(trial,item,revision,'failed');committed_pg_json(event.stdout,event.stderr,event.returncode)
    before=snapshot(trial,stream);_,_,exhausted=outcome(trial,item,8,'processed',allowed=True)
    trial.check('retry_bound_native',before['outcomes']==8 and exhausted.returncode!=0 and snapshot(trial,stream)==before)
    # Actual source-version uniqueness at an otherwise eligible successor.
    stream=seed(trial);nxt='https://example.org/feed.xml?page=2'
    c=context(rss(entry('version'),nxt),stream,next_url=nxt);_,_=capture(trial,c);before=snapshot(trial,stream)
    successor=context(rss(entry('version-two')),stream,revision=1,url=nxt)
    p=json.loads(successor.canonical_input);p['source']['source_version_id']=c.source.source_version_id
    refused(trial,'same_version_no_second_page',payload_statement(p),stream,before)
    stale=context(rss(entry('stale')),stream,revision=0,url=nxt)
    refused(trial,'stale_predecessor_no_advance',stale.statement(),stream,before)
    p=json.loads(successor.canonical_input);p['source']['retrieved_at']='2026-10-13T00:00:00.000000Z'
    refused(trial,'older_retrieval_no_advance',payload_statement(p),stream,before)
    # Atom and exact maximum source bytes cross the real storage/readback path.
    atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><title>Invented</title><id>urn:fictional:feed</id><updated>2026-10-14T00:00:00Z</updated><entry><id>urn:fictional:atom</id><title>Invented Atom</title><link href="https://example.org/atom"/></entry></feed>'
    stream=seed(trial);c=context(atom,stream,format='atom10');value,_=capture(trial,c)
    trial.check('atom_native_capture_and_readback',len(value.items)==1 and value.items[0].processing_state=='pending')
    stream=seed(trial);raw=rss(entry('large'));padding=b'<!--'+b'x'*(65536-len(raw)-7)+b'-->'
    c=context(raw+padding,stream);value,_=capture(trial,c)
    trial.check('maximum_raw_bytes_native',len(c.raw)==65536 and value.page.source.content_sha256==c.source.content_sha256)
    # Finite traversal cap is tested at actual revision64 with 64 committed pages.
    stream=seed(trial);url='https://example.org/feed.xml';c=context(rss(entry('bounded-pages'),url),stream,next_url=url)
    p=json.loads(c.canonical_input)
    sql="begin;set local statement_timeout='10s';do $trial$ declare p jsonb:="+_literal(json.dumps(p))+"::jsonb;q jsonb;r integer;begin for r in 0..63 loop q:=p||jsonb_build_object('operation_id',gen_random_uuid(),'expected_revision',r,'source',(p->'source')||jsonb_build_object('source_version_id',gen_random_uuid()));perform tf_feed_rehearsal.capture(q);end loop;end $trial$;commit;"
    trial.query(sql);before=snapshot(trial,stream)
    overflow=json.loads(context(rss(entry('overflow')),stream,revision=63).canonical_input);overflow['expected_revision']=64
    refused(trial,'page_quota_no_65th',payload_statement(overflow),stream,before)
    trial.check('page_quota_native',(before['revision'],before['pages'],before['items'])==(64,64,64))
    # The closed processing protocol is exercised on real committed rows.
    stream=seed(trial);c=context(rss(entry('typed-event')),stream);page,page_raw=capture(trial,c)
    item=page.items[0].item_state_record_id;at=datetime.now(timezone.utc)
    request=prepare_invented_pg_outcome(c,page_raw,observed_at=at,item_id=item,operation_id=str(uuid4()),expected_revision=0,state='failed')
    event=trial.query(request.statement());event_raw=committed_pg_json(event.stdout,event.stderr,event.returncode)
    parsed=parse_invented_pg_outcome(event_raw,request,observed_at=datetime.now(timezone.utc))
    trial.check('closed_outcome_native_readback',parsed.operation_id==request.operation_id and parsed.state=='failed' and parsed.revision==1)
    request2=prepare_invented_pg_outcome(c,page_raw,observed_at=at,item_id=item,operation_id=str(uuid4()),expected_revision=1,state='processed')
    event=trial.query(request2.statement());committed_pg_json(event.stdout,event.stderr,event.returncode)
    history=trial.query(invented_pg_item_history_statement(c,item));history_raw=committed_pg_json(history.stdout,history.stderr,history.returncode)
    current=parse_invented_pg_item_history(history_raw,c,item_id=item,observed_at=datetime.now(timezone.utc))
    trial.check('closed_history_native_readback',current.state=='processed' and current.revision==2 and [e.state for e in current.outcomes]==['failed','processed'])
    trial.stop();trial.start()
    restored=trial.query(invented_pg_item_history_statement(c,item));restored_raw=committed_pg_json(restored.stdout,restored.stderr,restored.returncode)
    trial.check('processing_history_survives_actual_restart',restored_raw==history_raw and parse_invented_pg_item_history(restored_raw,c,item_id=item,observed_at=datetime.now(timezone.utc))==current)
    # PUBLIC has no schema/table/function rights; RLS is enabled, without
    # claiming the owner-driven fixture is a restricted application role.
    acl=trial.query("""select jsonb_build_object(
      'publicSchema',(select count(*) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='tf_feed_rehearsal' and a.grantee=0),
      'publicTable',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='tf_feed_rehearsal' and c.relkind='r' and a.grantee=0),
      'publicFunction',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='tf_feed_rehearsal' and a.grantee=0),
      'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tf_feed_rehearsal' and c.relkind='r' and c.relrowsecurity));""")
    trial.check('private_owner_only_schema',json.loads(acl.stdout)=={'publicSchema':0,'publicTable':0,'publicFunction':0,'rlsTables':4})
    return {'negativeAndConcurrencyCases':True,'ownerOnly':True,'applicationAccessAccepted':False}
