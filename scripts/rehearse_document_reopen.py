"""Fresh invented document raw recovery with independently retained bindings.

No known original feed/document byte contexts survive the setup function. Only
scope and independently supplied source/mapping/association expectations remain.
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
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from scripts.rehearse_feed_windows import freeze_windows,initialize,snapshot,FIXTURE as WINDOW_FIXTURE
from scripts.rehearse_feed_inventory import freeze_inventory,inventory,FIXTURE as INVENTORY_FIXTURE
from scripts.rehearse_feed_reopen import freeze_reopen,reopen,FIXTURE as REOPEN_FIXTURE
from scripts.rehearse_invented_document_results import freeze_additional,result_request,store
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_postgres_processing import invented_pg_item_history_statement
from workers.document_result_reopen import prepare_document_reopen,parse_reopened_document,confirm_reopened_document_result
from workers.document_result_contract import invented_document_result_read_statement
from workers.document_passage_comparison import DocumentPassageCapture
from workers.passage_extraction_request import compile_extraction_request
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_document_reopen.sql'
DOCUMENT_FIXTURE='tests/fixtures/invented_document_results.sql'


def freeze_document_reopen(trial):
 names={FIXTURE,'scripts/rehearse_document_reopen.py','workers/document_result_reopen.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Document reopen dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('DOCUMENT_REOPEN_SOURCE_BINDINGS',rows)
 trial.record('DOCUMENT_REOPEN_SCOPE',{'ownerOnly':True,'readOnlyApi':True,'independentExpectedBindings':True,
  'sourceRequests':0,'modelCalls':0,'rolesOrGrantsChanged':False,'primaryChanged':False})


def full_snapshot(trial):
 # All seven complete-row arrays are observed in one native read-only snapshot.
 tables=[('streams','tf_feed_rehearsal.streams','id'),('pages','tf_feed_rehearsal.pages','operation_id'),
  ('items','tf_feed_rehearsal.items','item_id'),('outcomes','tf_feed_rehearsal.outcomes','operation_id'),
  ('collections','tf_feed_windows.collections','id'),('windows','tf_feed_windows.windows','operation_id'),
  ('documents','tf_feed_rehearsal.document_results','operation_id')]
 fields=[]
 for key,table,order in tables:
  fields += [_literal(key),"(select jsonb_build_object('rows',jsonb_array_length(body),'bytes',octet_length(body::text),'sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from (select coalesce(jsonb_agg(to_jsonb(t) order by "+order+"),'[]'::jsonb) body from "+table+' t) scope)']
 return json.loads(trial.query('begin isolation level repeatable read read only;select jsonb_build_object('+','.join(fields)+');commit;').stdout)


def direct(payload,*,isolation='repeatable read read only'):
 return HEAD+"set time zone 'UTC';begin isolation level "+isolation+';select tf_document_reopen.original('+_literal(json.dumps(payload,separators=(',',':')))+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def refuse(trial,label,sql):
 before=full_snapshot(trial);output=trial.query(sql,allowed=True)
 trial.check(label+'_refused',output.returncode!=0 and bool(output.stderr))
 trial.check(label+'_exact_rows_unchanged',full_snapshot(trial)==before)


def setup(trial,*,maximum=False):
 body=None
 if maximum:
  prefix='Invented original\n  Exact Å source passage.\r\n'.encode()
  body=prefix+b'x'*(65536-len(prefix))
 expected=result_request(trial,body=body);initialize_scope=initialize(trial,expected.feed_capture)
 result,_=store(trial,expected)
 trial.check('maximum_stored_document' if maximum else 'initial_document_stored',len(expected.document_raw)==65536 if maximum else result.outcome_revision==1)
 # Independent invented expectations, not values read back out of storage.
 return initialize_scope,expected.binding,expected.mapping,expected.association


def resumed(trial,scope,binding,mapping,association):
 request=prepare_inventory_request(scope);items,inventory_raw=inventory(trial,request)
 selected=next(row for row in items.rows if row.item_id==association.feed_item_id)
 feed,_,page_raw,_=reopen(trial,request,inventory_raw,selected.item_id)
 out=trial.query(invented_pg_item_history_statement(feed.capture,selected.item_id))
 history_raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
 document_request=prepare_document_reopen(feed,page_raw,history_raw,binding=binding,mapping=mapping,association=association,observed_at=datetime.now(timezone.utc))
 out=trial.query(document_request.statement());raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
 reopened=parse_reopened_document(raw,document_request,observed_at=datetime.now(timezone.utc))
 out=trial.query(invented_document_result_read_statement(reopened.result_request));receipt=committed_pg_json(out.stdout,out.stderr,out.returncode)
 stored=confirm_reopened_document_result(receipt,reopened,observed_at=datetime.now(timezone.utc))
 # This is a new end-to-end composition: only fully confirmed retained bytes
 # enter the existing deterministic local request compiler. No token/provider
 # qualification, dispatch reservation or model call is inferred.
 current=DocumentPassageCapture(reopened.result_request.document_raw,reopened.result_request.document,binding,mapping)
 compiled=compile_extraction_request(current,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
 payload=json.loads(compiled.body)['selected_payload']
 trial.check('confirmed_cold_bytes_compile_complete_local_request_'+str(len(trial.assertions)),
  payload['source_version_id']==binding.source_version_id and payload['content_sha256']==binding.content_sha256
  and compiled.request_sha256==sha256(compiled.body).hexdigest())
 return reopened,stored,raw,compiled


def cases(trial):
 scope,binding,mapping,association=setup(trial);before=full_snapshot(trial)
 trial.stop();trial.start()
 reopened,stored,raw,compiled=resumed(trial,scope,binding,mapping,association)
 trial.check('cold_original_document_and_exact_passages_reopened',sha256(reopened.result_request.document_raw).hexdigest()==binding.content_sha256
  and stored.result.snapshot.passages[0].text=='  Exact Å source passage.' and stored.outcome_revision==1)
 trial.check('cold_recovery_changes_no_complete_rows',full_snapshot(trial)==before)
 payload=json.loads(reopened.request.canonical_input)
 changes=[('extra',lambda p:p.update(extra=True)),('missing_binding',lambda p:p.pop('binding')),('null_binding',lambda p:p.update(binding=None)),
  ('foreign_collection',lambda p:p['feed']['scope'].update(collection_id=str(uuid4()))),
  ('foreign_item',lambda p:p['feed'].update(item_id=str(uuid4()))),('foreign_result',lambda p:p.update(outcome_operation_id=str(uuid4()))),
  ('wrong_revision',lambda p:p.update(outcome_revision=2)),('bool_revision',lambda p:p.update(outcome_revision=True)),
  ('foreign_association',lambda p:p['association'].update(feed_item_id=str(uuid4()))),
  ('extra_association',lambda p:p['association'].update(extra=True)),('extra_binding',lambda p:p['binding'].update(extra=True))]
 for key in ['source_key','item_key','source_version_id','source_url','content_sha256','mapping_sha256','language_code','retrieved_at']:
  changes.append(('binding_'+key,lambda p,key=key:p['binding'].update({key:'fictional-changed'})))
 for label,change in changes:
  altered=json.loads(json.dumps(payload));change(altered);refuse(trial,label,direct(altered))
 refuse(trial,'read_committed',direct(payload,isolation='read committed read only'))
 refuse(trial,'writable',direct(payload,isolation='repeatable read'))
 before=full_snapshot(trial);out=trial.query('set session authorization pg_monitor;'+reopened.request.statement(),allowed=True)
 trial.check('private_document_original_nonowner_denied',out.returncode!=0 and b'permission denied' in out.stderr.lower())
 trial.check('private_denial_exact_rows_unchanged',full_snapshot(trial)==before)
 maximum_scope,maximum_binding,maximum_mapping,maximum_association=setup(trial,maximum=True)
 maximum,maximum_stored,maximum_raw,maximum_compiled=resumed(trial,maximum_scope,maximum_binding,maximum_mapping,maximum_association)
 trial.check('maximum64k_original_and_complete_receipt_fit_separate_channel',len(maximum.result_request.document_raw)==65536 and len(maximum_raw)<131072
  and maximum_stored.result.snapshot.passages[0].text=='  Exact Å source passage.')
 trial.record('DOCUMENT_REOPEN_MAX_OUTPUT',{'originalBytes':65536,'jsonBytes':len(maximum_raw),'limitBytes':131072})
 before=full_snapshot(trial);trial.stop();trial.start()
 again,again_stored,_,again_compiled=resumed(trial,scope,binding,mapping,association)
 trial.check('second_restart_exact_artifact_bytes_and_passages',again.artifact_id==reopened.artifact_id
  and again.result_request.document_raw==reopened.result_request.document_raw and again_stored.result==stored.result and again_compiled==compiled)
 trial.check('final_reopen_reads_leave_all_rows_exact',full_snapshot(trial)==before)
 return {'collectionId':scope.collection_id,'originalDocumentBytes':len(reopened.result_request.document_raw),'maximumDocumentBytes':65536,
  'independentExpectedBindings':True,'preknownRawContextsUsedByResumedPath':False,'writesByNewApi':0}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented document reopen trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_windows(trial);freeze_inventory(trial);freeze_reopen(trial);freeze_additional(trial);freeze_document_reopen(trial);trial.create()
  trial.query("begin;set local statement_timeout='10s';"+''.join(trial.frozen[name].decode() for name in [WINDOW_FIXTURE,INVENTORY_FIXTURE,REOPEN_FIXTURE,DOCUMENT_FIXTURE,FIXTURE])+'commit;')
  result=cases(trial);trial.record('DOCUMENT_REOPEN_RESULT',{'state':'PASS_INVENTED_DOCUMENT_REOPEN','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':result,'primaryChanged':False})
 except BaseException as error:
  trial.record('DOCUMENT_REOPEN_FAILED',{'type':type(error).__name__,'message':'invented_document_reopen_trial_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_DOCUMENT_REOPEN')
  if trial.identity is not None:trial.record('DOCUMENT_REOPEN_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_DOCUMENT_REOPEN','primaryChanged':False}))

if __name__=='__main__':main()
