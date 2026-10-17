"""Fresh owner-only recovery/continuation of actual invented collection lineage.

No restricted-role profile is installed here. Owners are postgres and every
function is INVOKER; this cannot replace the separate role-preserving proof.
Only a newly owned same-cluster restore database is selected by the unchanged
verified guard. No primary, source/network, role/grant or schedule changes.
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
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN,seed,rss,entry,capture_context,capture
from scripts.rehearse_feed_windows import freeze_windows,initialize,current,successor,advance,inspect_window,snapshot,FIXTURE
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from workers.feed_postgres_contract import committed_pg_json
from workers.feed_postgres_processing import prepare_invented_pg_outcome,parse_invented_pg_outcome,invented_pg_item_history_statement,parse_invented_pg_item_history
ROOT=Path(__file__).resolve().parents[1]


def freeze_recovery(trial):
    names={'scripts/rehearse_feed_window_restore.py'};queue=list(names)
    while queue:
        name=queue.pop()
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    rows=[]
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Window recovery dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as f:f.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
    trial.record('WINDOW_RECOVERY_SOURCE_BINDINGS',rows)


def access(query):
    return json.loads(query("""select jsonb_build_object(
     'ownerFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('tf_feed_rehearsal','tf_feed_windows') and pg_get_userbyid(p.proowner)='postgres'),
     'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('tf_feed_rehearsal','tf_feed_windows')),
     'definers',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('tf_feed_rehearsal','tf_feed_windows') and p.prosecdef),
     'publicFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname in ('tf_feed_rehearsal','tf_feed_windows') and a.grantee=0),
     'publicTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where n.nspname in ('tf_feed_rehearsal','tf_feed_windows') and c.relkind='r' and a.grantee=0),
     'publicSchemas',(select count(*) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      where n.nspname in ('tf_feed_rehearsal','tf_feed_windows') and a.grantee=0),
     'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('tf_feed_rehearsal','tf_feed_windows') and c.relkind='r' and c.relrowsecurity));""").stdout)


def history(target,previous,old_item):
    out=target.query(invented_pg_item_history_statement(previous,old_item));raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
    return parse_invented_pg_item_history(raw,previous,item_id=old_item,observed_at=datetime.now(timezone.utc)),raw


def outcome(target,previous,page_raw,item,revision,state):
    request=prepare_invented_pg_outcome(previous,page_raw,observed_at=datetime.now(timezone.utc),item_id=item,
        operation_id=str(uuid4()),expected_revision=revision,state=state)
    out=target.query(request.statement())
    return parse_invented_pg_outcome(committed_pg_json(out.stdout,out.stderr,out.returncode),request,observed_at=datetime.now(timezone.utc))


def cases(trial):
    previous=capture_context(rss(entry('repeated')+entry('old-only')),seed(trial));page,page_raw=capture(trial,previous)
    scope=initialize(trial,previous);item=page.items[0].item_state_record_id
    outcome(trial,previous,page_raw,item,0,'failed')
    request=successor(trial,scope,previous,raw=rss(entry('repeated',title='Revised')+entry('new-only')))
    stored,stored_raw=advance(trial,request);before=snapshot(trial);before_access=access(trial.query)
    original_history,original_history_raw=history(trial,previous,item)
    # --no-owner is valid only for this explicit postgres-owned INVOKER profile;
    # never borrow this mode for the separate restricted DEFINER fixture.
    expected_access={'ownerFunctions':7,'functions':7,'definers':0,'publicFunctions':0,'publicTables':0,'publicSchemas':0,'rlsTables':6}
    trial.check('owner_only_invoker_private_dump_profile',before_access==expected_access)
    dump=trial.run(['docker','exec',trial.identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres',
        '--format=p','--schema=tf_feed_rehearsal','--schema=tf_feed_windows','--no-owner'],timeout=20)
    if dump.stderr or not 1<=len(dump.stdout)<=131072:raise FeedPgTrialError('Bounded window dump unavailable')
    trial.record('WINDOW_LOGICAL_DUMP',{'bytes':len(dump.stdout),'sha256':sha256(dump.stdout).hexdigest(),
        'schemas':['tf_feed_rehearsal','tf_feed_windows'],'ownerOnlyInvoker':True,'preservesACL':True,
        'sameMachineOnly':True,'rolesOrGrantsChanged':False})
    target=OwnedRestoreDatabase(trial);target.create()
    failed=target.query(dump.stdout+b'\nselect 1/0;\n',single_transaction=True,allowed=True)
    trial.check('window_restore_fault_refused',failed.returncode!=0 and b'division by zero' in failed.stderr)
    absent=target.query("select count(*) from pg_namespace where nspname in ('tf_feed_rehearsal','tf_feed_windows');")
    trial.check('window_restore_fault_both_schemas_absent',absent.stdout.strip()==b'0')
    target.query(dump.stdout,single_transaction=True)
    trial.check('restored_all_window_queue_rows_exact',snapshot(target)==before)
    trial.check('restored_private_invoker_acl_rls',access(target.query)==before_access)
    copied,copied_raw=inspect_window(target,request);head,head_raw=current(target,scope,request.first_capture)
    copied_history,copied_history_raw=history(target,previous,item)
    trial.check('restored_historical_receipt_and_queue_exact',copied==stored and copied_raw==stored_raw
        and copied_history==original_history and copied_history_raw==original_history_raw and head.window_revision==2)
    # Continue ONLY the restored copy. An old operation stays historical while
    # a new first-page/items/head transaction advances that specific database.
    next_request=successor(target,scope,request.first_capture);next_value,next_raw=advance(target,next_request)
    trial.check('restored_copy_can_continue_new_window',next_value.window_revision==3)
    _,historical_raw=inspect_window(target,request)
    trial.check('restored_earlier_receipt_remains_exact',historical_raw==stored_raw)
    outcome(target,previous,page_raw,item,1,'processed')
    changed_history,_=history(target,previous,item)
    trial.check('restored_old_failed_queue_still_independent',changed_history.state=='processed'
        and [row.state for row in changed_history.outcomes]==['failed','processed'])
    source_head,_=current(trial,scope,request.first_capture)
    _,source_history_raw=history(trial,previous,item)
    trial.check('source_collection_and_failed_queue_unmodified',source_head.window_revision==2
        and source_history_raw==original_history_raw and snapshot(trial)==before)
    trial.stop();trial.start()
    recovered,recovered_raw=inspect_window(target,next_request);final,_=current(target,scope,next_request.first_capture)
    final_history,_=history(target,previous,item)
    trial.check('actual_restart_restored_new_and_historical_state',recovered==next_value and recovered_raw==next_raw
        and final.window_revision==3 and final_history.state=='processed')
    trial.check('actual_restart_private_acl_unchanged',access(target.query)==before_access)
    source_head,_=current(trial,scope,request.first_capture)
    trial.check('restart_source_still_original_window',source_head.window_revision==2 and snapshot(trial)==before)
    trial.record('WINDOW_RECOVERY_FINAL_DATABASE',target.current())
    return {'restoreDatabaseName':target.name,'restoreDatabaseOID':target.oid,'sourceWindowRevision':2,'restoredWindowRevision':3,
        'sameMachineOnly':True,'offHostNasPowerLossAccepted':False,'actualCollectorAccepted':False,'rolesOrGrantsChanged':False}


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented window restore takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_windows(trial);freeze_recovery(trial);trial.create()
        trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode()+'commit;')
        result=cases(trial)
        trial.record('WINDOW_RECOVERY_RESULT',{'state':'PASS_INVENTED_WINDOW_RECOVERY','assertions':trial.assertions,
            'identities':result,'primaryChanged':False,'sourceRequests':0,'modelCalls':0,'schedulesCreated':False})
    except BaseException as failure:
        trial.record('WINDOW_RECOVERY_FAILURE',{'state':'held','exceptionClass':type(failure).__name__,'evidenceRetained':True});raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_WINDOW_RECOVERY')
        if trial.identity is not None:trial.record('WINDOW_RECOVERY_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_WINDOW_RECOVERY','primaryChanged':False}))


if __name__=='__main__':main()
