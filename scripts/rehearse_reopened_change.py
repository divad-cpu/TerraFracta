"""Cold restricted two-vintage document comparison over three retained windows.

Fixed invented sources and independently chosen versions only. Reuse private
storage, typed stream reads, full-result binding, comparison and offline planner.
Existing invented metadata/raw scopes are assigned by the owner; shared writer
rights remain. No baseline discovery, actual source/provider, token measurement,
queue, new grant policy or operational grant.
"""
from __future__ import annotations
import ast
from dataclasses import replace
from datetime import datetime,timezone
from decimal import Decimal
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,rss,entry
from scripts.rehearse_stream_reader import (freeze_all,BASE_FIXTURES,install_stream_reader,reader_query,validate_profile,profile,denied)
from scripts.rehearse_feed_windows import initialize,successor,advance
from scripts.rehearse_invented_document_results import result_request,store,URL
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from scripts.rehearse_collection_reader import install_reader,snapshot,read
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_capture_reopen import prepare_capture_reopen,parse_reopened_capture,confirm_reopened_page
from workers.document_result_reopen import prepare_document_reopen,parse_reopened_document,confirm_reopened_document_result
from workers.feed_stream_reader import (stream_feed_original_statement,stream_document_original_statement,stream_page_statement,stream_result_statement,stream_history_statement)
from workers.reopened_document_change import prepare_reopened_document_change,ReopenedDocumentChangeError
from workers.document_passage_comparison import compare_document_passages
from workers.document_dispatch_plan import plan_document_dispatch
from workers.extraction_request_dispatch import plan_extraction_request_dispatch
from workers.change_work_router import CapturedWorkItem,RoutingLimits
from workers.model_cost_budget import ModelPrice,BudgetSnapshot
from workers.passage_model_plan import PassageSourceBinding
from workers.passage_extraction_request import compile_extraction_request,FullRequestTokenLimit,ExtractionRequestError
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]


def freeze_change(trial):
 names={'scripts/rehearse_reopened_change.py','workers/reopened_document_change.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Reopened change dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('REOPENED_CHANGE_SOURCE_BINDINGS',rows)
 trial.record('REOPENED_CHANGE_SCOPE',{'priorVersionsChosenIndependently':True,'noFallbackToFirstObservation':True,
  'tokenLimitsCallerAssertionsOnly':True,'noProviderQualification':True,'sourceRequests':0,'modelCalls':0,'publicationEnabled':False,'primaryChanged':False})


def prepare(trial):
 trial.query("begin;set local statement_timeout='10s';"+''.join(trial.frozen[name].decode() for name in BASE_FIXTURES)+'commit;')
 old=result_request(trial,body='Invented old metadata\n  Exact Å source passage.\r\nOld unselected.'.encode());store(trial,old)
 scope=initialize(trial,old.feed_capture)
 metadata_window=successor(trial,scope,old.feed_capture,raw=rss(entry('metadata-version',URL)))
 _,page_raw=advance(trial,metadata_window)
 # advance returns a window receipt; get the actual page through the existing
 # full page receipt contract, rather than treating the window as that page.
 from workers.feed_postgres_contract import invented_pg_read_statement,committed_pg_json
 out=trial.query(invented_pg_read_statement(metadata_window.first_capture));page_raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
 metadata=result_request(trial,feed=metadata_window.first_capture,page_raw=page_raw,body='Longer changed invented metadata\n  Exact Å source passage.\r\nChanged unselected.'.encode());store(trial,metadata)
 changed_window=successor(trial,scope,metadata.feed_capture,raw=rss(entry('selected-version',URL)))
 advance(trial,changed_window)
 out=trial.query(invented_pg_read_statement(changed_window.first_capture));page_raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
 changed=result_request(trial,feed=changed_window.first_capture,page_raw=page_raw,body='Even longer invented changed metadata\n  Changed exact Å source passage.\r\nOther unselected.'.encode());store(trial,changed)
 expectations=tuple((value.binding,value.mapping,value.association) for value in [old,metadata,changed])
 # No raw/result/capture/request context survives this setup function.
 roles=OwnedRuntimeRoles(trial);roles.install();install_reader(trial,roles);install_stream_reader(trial,roles)
 trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
 return roles,scope,expectations


def reopen_version(roles,request,inventory_raw,expectation):
 binding,mapping,association=expectation
 selected=prepare_capture_reopen(request,inventory_raw,observed_at=datetime.now(timezone.utc),item_id=association.feed_item_id)
 raw=reader_query(roles,stream_feed_original_statement(selected));feed=parse_reopened_capture(raw,selected,observed_at=datetime.now(timezone.utc))
 page=reader_query(roles,stream_page_statement(feed.capture));confirm_reopened_page(page,feed,observed_at=datetime.now(timezone.utc))
 history=reader_query(roles,stream_history_statement(feed.capture,association.feed_item_id))
 document_request=prepare_document_reopen(feed,page,history,binding=binding,mapping=mapping,association=association,observed_at=datetime.now(timezone.utc))
 raw=reader_query(roles,stream_document_original_statement(document_request));document=parse_reopened_document(raw,document_request,observed_at=datetime.now(timezone.utc))
 receipt=reader_query(roles,stream_result_statement(document.result_request));confirm_reopened_document_result(receipt,document,observed_at=datetime.now(timezone.utc))
 return document,receipt


def work(change):
 return CapturedWorkItem(change.item_key,'approved',True,change.current.document.content_sha256,change.previous.document.content_sha256,'qualified_prose',True,900)


def plan(change,compiled=None,*,item=None,source=True):
 # Fictional fixed eligibility and token/cost assertions, NOT actual provider
 # inputs/usage, current rights, durable reservations or allowed dispatch.
 arguments=dict(source_bindings=(PassageSourceBinding(change.item_key,'fictional-document'),) if source else (),
  price=ModelPrice(Decimal('1'),Decimal('1')),budget=BudgetSnapshot(Decimal('0.001'),Decimal('0.01'),Decimal(0),Decimal(0)),observed_at=datetime.now(timezone.utc))
 if compiled is None:
  return plan_document_dispatch((item or work(change),),RoutingLimits(5,5,1000),documents=(change,),token_limits=(),output_token_limit_per_call=100,**arguments)
 return plan_extraction_request_dispatch((item or work(change),),RoutingLimits(5,5,1000),documents=(change,),requests=(compiled,),
  token_limits=(FullRequestTokenLimit(change.item_key,compiled.request_sha256,200),),maximum_output_tokens=100,**arguments)


def compare_pair(current,previous):
 return prepare_reopened_document_change(current[0],current[1],previous[0],previous[1],observed_at=datetime.now(timezone.utc))


def cases(trial):
 roles,scope,expectations=prepare(trial);access=validate_profile(profile(trial.query))
 request=prepare_inventory_request(scope,item_limit=20);items,inventory_raw=read(roles,request)
 trial.check('three_retained_windows_discovered_as_processed',len(items.rows)==3 and [row.position.window_revision for row in items.rows]==[1,2,3]
  and all(row.processing_state=='processed' for row in items.rows))
 for row in items.rows:trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(row.stream_id)+'::uuid);')
 before=snapshot(trial);trial.stop();trial.start();roles.verify()
 items,inventory_raw=read(roles,request)
 old,metadata,changed=tuple(reopen_version(roles,request,inventory_raw,expectation) for expectation in expectations)
 equal=compare_pair(metadata,old);compared=compare_document_passages(equal.current,equal.previous,observed_at=datetime.now(timezone.utc))
 trial.check('cold_two_versions_preserve_original_changed_bytes_and_exact_same_passage',compared.source_bytes_changed is True and compared.selection.state=='no_model_work'
  and equal.current.mapping.spans!=equal.previous.mapping.spans and equal.current.document.source_version_id!=equal.previous.document.source_version_id)
 no_model=plan(equal)
 trial.check('same_passage_reserves_zero_calls_tokens_and_money',no_model.passages.dispatch.reserved_calls==0
  and no_model.passages.dispatch.items[0].disposition=='no_model_work' and no_model.passages.dispatch.maximum_reserved_usd==0)
 try:compile_extraction_request(equal.current,equal.previous,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
 except ExtractionRequestError:pass
 else:raise FeedPgTrialError('Unchanged retained passage unexpectedly compiled')
 trial.check('unchanged_selected_passage_has_no_complete_request',True)
 change=compare_pair(changed,metadata);compiled=compile_extraction_request(change.current,change.previous,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
 selected=json.loads(compiled.body)['selected_payload'];planned=plan(change,compiled)
 trial.check('changed_passage_only_complete_request_and_both_vintages_retained',selected['passages'][0]['text']=='  Changed exact Å source passage.'
  and 'metadata' not in json.dumps(selected) and 'unselected' not in json.dumps(selected) and change.previous.binding==expectations[1][0])
 trial.check('existing_offline_full_request_plan_reserves_one_exact_candidate',planned.requests==(compiled,)
  and planned.documents.passages.dispatch.reserved_calls==1 and planned.documents.passages.dispatch.maximum_reserved_usd==Decimal('0.0003'))
 for label,item,source in [('source_denied',replace(work(change),source_status='candidate'),True),('rights_denied',replace(work(change),model_processing_allowed=False),True),('binding_absent',work(change),False)]:
  withheld=plan(change,compiled,item=item,source=source)
  trial.check('existing_'+label+'_withholds_retained_request',withheld.requests==() and withheld.documents.passages.dispatch.reserved_calls==0)
 trial.check('all_three_cold_reads_and_offline_plans_preserve_nine_tables',snapshot(trial)==before)
 trial.record('REOPENED_CHANGE_OBSERVATIONS',{'metadataPair':{'currentVersion':equal.current.document.source_version_id,'previousVersion':equal.previous.document.source_version_id,
  'currentHash':equal.current.document.content_sha256,'previousHash':equal.previous.document.content_sha256,'selection':compared.selection.state,'reservedCalls':0,'requests':0},
  'selectedPair':{'currentVersion':change.current.document.source_version_id,'previousVersion':change.previous.document.source_version_id,
  'requestSHA256':compiled.request_sha256,'reservedCalls':1,'tokenProofIsCallerAssertion':True}})
 prior_stream=metadata[0].request.feed.capture.stream_id
 trial.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(prior_stream)+'::uuid;')
 denied(trial,roles,'previous_original_raw_scope_revoked',stream_feed_original_statement(metadata[0].request.feed.request))
 # A current version is still readable, but cannot erase the expected prior.
 current_after_revoke=reopen_version(roles,request,inventory_raw,expectations[2])
 try:prepare_reopened_document_change(current_after_revoke[0],current_after_revoke[1],None,None,observed_at=datetime.now(timezone.utc))
 except ReopenedDocumentChangeError:pass
 else:raise FeedPgTrialError('Unavailable retained prior fell back to first observation')
 trial.check('current_access_without_expected_prior_cannot_fall_back',True)
 trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(prior_stream)+'::uuid);')
 final_before=snapshot(trial);trial.stop();trial.start();roles.verify();items,inventory_raw=read(roles,request)
 again_metadata=reopen_version(roles,request,inventory_raw,expectations[1]);again_changed=reopen_version(roles,request,inventory_raw,expectations[2])
 again=compare_pair(again_changed,again_metadata);again_compiled=compile_extraction_request(again.current,again.previous,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
 trial.check('paired_current_previous_request_exact_after_second_restart',again_compiled==compiled and again.current==change.current and again.previous==change.previous)
 trial.check('all_rows_and_access_exact_after_paired_restart',snapshot(trial)==final_before==before and validate_profile(profile(trial.query))==access)
 return {'collectionId':scope.collection_id,'windows':3,'fullOriginalVersionsReopened':3,'metadataOnlyReservedCalls':0,
  'changedSelectedOfflineReservedCalls':1,'modelCalls':0,'sourceRequests':0,'baselineAutomaticallyChosen':False,'priorMissingFallback':False,'actualProviderAccepted':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented reopened-change trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_all(trial);freeze_change(trial);trial.create();identities=cases(trial)
  trial.record('REOPENED_CHANGE_RESULT',{'state':'PASS_INVENTED_REOPENED_CHANGE','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':identities,'primaryChanged':False})
 except BaseException as error:
  trial.record('REOPENED_CHANGE_FAILED',{'type':type(error).__name__,'message':'invented_reopened_change_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_REOPENED_CHANGE')
  if trial.identity is not None:trial.record('REOPENED_CHANGE_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_REOPENED_CHANGE','primaryChanged':False}))

if __name__=='__main__':main()
