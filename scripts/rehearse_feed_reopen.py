"""Fresh invented restart→inventory→original→history/CAS continuation.

No pre-known capture contexts used by the resumed read/processing path. No
network, operational activation, role, queue/lease, source or primary changes.
"""
from __future__ import annotations
import ast
import base64
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,seed,rss,entry,capture_context,capture
from scripts.rehearse_feed_windows import freeze_windows,initialize,successor,advance,snapshot,FIXTURE as WINDOW_FIXTURE
from scripts.rehearse_feed_inventory import freeze_inventory,inventory,outcome,history,FIXTURE as INVENTORY_FIXTURE
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_capture_reopen import prepare_capture_reopen,parse_reopened_capture,confirm_reopened_page
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json,invented_pg_read_statement
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_feed_reopen.sql'


def freeze_reopen(trial):
 names={FIXTURE,'scripts/rehearse_feed_reopen.py','workers/feed_capture_reopen.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Reopen dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('REOPEN_SOURCE_BINDINGS',rows)
 trial.record('REOPEN_SCOPE',{'ownerOnly':True,'readOnlyApi':True,'existingOutcomeCasOnly':True,'sourceRequests':0,
  'modelCalls':0,'rolesOrGrantsChanged':False,'primaryChanged':False,'preknownContextsUsedByResumedPath':False})


def direct(payload,*,isolation='repeatable read read only'):
 return HEAD+"set time zone 'UTC';begin isolation level "+isolation+';select tf_feed_reopen.original('+_literal(json.dumps(payload,separators=(',',':')))+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def reopen(trial,inventory_request,inventory_raw,item_id):
 request=prepare_capture_reopen(inventory_request,inventory_raw,observed_at=datetime.now(timezone.utc),item_id=item_id)
 output=trial.query(request.statement());raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
 reopened=parse_reopened_capture(raw,request,observed_at=datetime.now(timezone.utc))
 output=trial.query(invented_pg_read_statement(reopened.capture));page_raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
 page=confirm_reopened_page(page_raw,reopened,observed_at=datetime.now(timezone.utc))
 return reopened,page,page_raw,raw


def refuse(trial,label,statement):
 before=snapshot(trial);output=trial.query(statement,allowed=True)
 trial.check(label+'_refused',output.returncode!=0 and bool(output.stderr))
 trial.check(label+'_exact_rows_unchanged',snapshot(trial)==before)


def prepare_restart(trial):
 original=capture_context(rss(entry('old-failed')+entry('held','http://127.0.0.1/private')),seed(trial))
 page,raw=capture(trial,original);scope=initialize(trial,original)
 outcome(trial,original,raw,page.items[0].item_state_record_id,0,'failed')
 second=successor(trial,scope,original,raw=rss(entry('new-pending')));advance(trial,second)
 # These locals and the capture object are deliberately not returned.
 return scope


def cases(trial):
 scope=prepare_restart(trial);trial.stop();trial.start()
 request=prepare_inventory_request(scope);page,inventory_raw=inventory(trial,request)
 trial.check('restarted_with_scope_only_finds_old_failed_and_held',[row.processing_state for row in page.rows]==['failed','parse_held','pending'])
 before=snapshot(trial);opened=[]
 for item in page.rows:
  restored,stored,page_raw,response_raw=reopen(trial,request,inventory_raw,item.item_id)
  trial.check('reopened_actual_original_'+str(item.position.window_revision)+'_'+str(item.position.item_position),
   sha256(restored.capture.raw).hexdigest()==item.source_sha256 and stored.page.page_record_id==item.page_id)
  current=history(trial,restored.capture,item.item_id)
  trial.check('resolved_original_current_history_'+str(item.position.window_revision)+'_'+str(item.position.item_position),current.state==item.processing_state)
  opened.append((restored,page_raw,current))
 trial.check('all_original_reopen_reads_leave_journal_exact',snapshot(trial)==before)
 restored,page_raw,current=opened[0]
 processed=outcome(trial,restored.capture,page_raw,restored.item.item_id,current.revision,'processed')
 trial.check('rediscovered_old_failed_continues_existing_cas',processed.state=='processed' and processed.revision==2)
 # Reopening itself remains valid after state changes; old inventory isn't a CAS.
 old,_,_,_=reopen(trial,request,inventory_raw,restored.item.item_id)
 trial.check('historical_inventory_is_not_current_processing_state',old.item.processing_state=='failed' and history(trial,old.capture,old.item.item_id).state=='processed')
 from workers.feed_postgres_processing import prepare_invented_pg_outcome
 stale=prepare_invented_pg_outcome(old.capture,page_raw,observed_at=datetime.now(timezone.utc),item_id=old.item.item_id,
  operation_id=str(uuid4()),expected_revision=1,state='failed')
 refuse(trial,'stale_processing_cas',stale.statement())
 payload=json.loads(old.request.canonical_input)
 changes=[('extra',lambda x:x.update(extra=True)),('missing_item',lambda x:x.pop('item_id')),
  ('null_scope',lambda x:x.update(scope=None)),('foreign_collection',lambda x:x['scope'].update(collection_id=str(uuid4()))),
  ('wrong_source',lambda x:x['scope'].update(source_key='fictional-other')),('extra_scope',lambda x:x['scope'].update(extra=True)),
  ('foreign_stream',lambda x:x.update(stream_id=str(uuid4()))),('foreign_page',lambda x:x.update(page_id=str(uuid4()))),
  ('foreign_capture',lambda x:x.update(capture_operation_id=str(uuid4()))),('foreign_item',lambda x:x.update(item_id=str(uuid4()))),
  ('mismatched_existing_item',lambda x:x.update(item_id=page.rows[1].item_id)),('wrong_window',lambda x:x.update(window_revision=2)),
  ('bool_revision',lambda x:x.update(page_revision=True)),('over_window',lambda x:x.update(window_revision=33)),
  ('over_page',lambda x:x.update(page_revision=65)),('over_item',lambda x:x.update(item_position=51)),
  ('wrong_existing_position',lambda x:x.update(item_position=2)),('null_id',lambda x:x.update(item_id=None))]
 for label,change in changes:
  altered=json.loads(json.dumps(payload));change(altered);refuse(trial,label,direct(altered))
 refuse(trial,'read_committed',direct(payload,isolation='read committed read only'))
 refuse(trial,'writable',direct(payload,isolation='repeatable read'))
 before=snapshot(trial)
 output=trial.query('set session authorization pg_monitor;'+old.request.statement(),allowed=True)
 trial.check('private_original_nonowner_denied',output.returncode!=0 and b'permission denied' in output.stderr.lower())
 trial.check('private_denial_exact_rows_unchanged',snapshot(trial)==before)
 # Exact64KiB feed original, not a duplicate all-item metadata response.
 base=rss(entry('maximum'))
 maximum=base.replace(b'</channel>',b'<!--'+b'x'*(65536-len(base)-7)+b'--></channel>')
 trial.check('maximum_original_is_exact_64k',len(maximum)==65536)
 maximum_context=capture_context(maximum,seed(trial));capture(trial,maximum_context);maximum_scope=initialize(trial,maximum_context)
 maximum_request=prepare_inventory_request(maximum_scope);maximum_inventory,maximum_raw=inventory(trial,maximum_request)
 reopened,_,_,response_raw=reopen(trial,maximum_request,maximum_raw,maximum_inventory.rows[0].item_id)
 trial.check('maximum_original_reopened_exact_within_channel',reopened.capture.raw==maximum and len(response_raw)<131072)
 trial.record('REOPEN_MAX_OUTPUT',{'rawBytes':len(maximum),'jsonBytes':len(response_raw),'limitBytes':131072})
 final_request=prepare_inventory_request(scope);final,final_raw=inventory(trial,final_request);before=snapshot(trial)
 trial.stop();trial.start()
 reopened,_,_,_=reopen(trial,final_request,final_raw,final.rows[0].item_id)
 trial.check('second_restart_original_and_processed_history_survive',history(trial,reopened.capture,reopened.item.item_id).state=='processed')
 trial.check('final_reopen_reads_exact_unchanged',snapshot(trial)==before)
 return {'collectionId':scope.collection_id,'occurrencesReopened':3,'oldFailedProcessedRevision':2,
  'maximumOriginalBytes':65536,'preknownContextsUsedByResumedPath':False,'processingGrantIssued':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented reopen trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_windows(trial);freeze_inventory(trial);freeze_reopen(trial);trial.create()
  trial.query("begin;set local statement_timeout='10s';"+trial.frozen[WINDOW_FIXTURE].decode()+trial.frozen[INVENTORY_FIXTURE].decode()+trial.frozen[FIXTURE].decode()+'commit;')
  result=cases(trial)
  trial.record('REOPEN_RESULT',{'state':'PASS_INVENTED_ORIGINAL_REOPEN','assertions':len(trial.assertions),'identities':result,'primaryChanged':False})
 except BaseException as error:
  trial.record('TRIAL_FAILED',{'type':type(error).__name__,'message':'invented_reopen_trial_failed'})
  raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_REOPEN')
  if trial.identity is not None:trial.record('REOPEN_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_ORIGINAL_REOPEN','primaryChanged':False}))

if __name__=='__main__':main()
