"""Fresh historical reference discovery and exact overlay logical recovery.

No new catalogue/table/baseline algorithm. Historical metadata locates separately
supplied trusted records, never creates them. Existing invented stream assignment
also enables old writer operations. NOLOGIN admin-session simulation is not login
or arbitrary-SQL isolation. Same-cluster logical recovery only, not actual/NAS.
"""
from __future__ import annotations
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN
from scripts.rehearse_stream_reader import (freeze_all,prepare,profile,validate_profile,_same,_acl,reader_query,cold_chain,denied,SCHEMAS)
from scripts.rehearse_collection_reader import snapshot,read
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from scripts.rehearse_stream_reader_restore import whole_dump_scope,private_defaults
from scripts.rehearse_feed_role_restore import restored_role_port
from scripts.rehearse_complete_chain_restore import RestoredView
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_capture_reopen import prepare_capture_reopen
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER
from workers.stored_document_reference import stored_document_reference_statement,parse_stored_document_reference,HistoricalStoredDocumentReference
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_document_reference.sql'


def freeze_reference(trial):
 names={FIXTURE,'scripts/rehearse_document_reference.py','workers/stored_document_reference.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Document reference dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('DOCUMENT_REFERENCE_SOURCE_BINDINGS',rows)
 trial.record('DOCUMENT_REFERENCE_SCOPE',{'historicalCandidateOnly':True,'newTables':0,'automaticBaselineSelection':False,
  'independentTrustRequired':True,'existingStreamAlsoEnablesWriter':True,'sourceRequests':0,'modelCalls':0,'primaryChanged':False})


def install_reference(trial,roles):
 if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:raise FeedPgTrialError('Document reference custodian mismatch')
 roles.verify();trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode()+'commit;');roles.verify()


def reference_profile(query):
 value=profile(query)
 if type(value) is not dict or type(value.get('functions')) is not list:raise FeedPgTrialError('Document reference private profile unavailable')
 extra=[row for row in value['functions'] if row.get('name')=='tf_feed_runtime.document_reference']
 expected={'name':'tf_feed_runtime.document_reference','owner':'tf_feed_lab_owner','definer':True,'path':['search_path=pg_catalog, pg_temp'],
  'writer':True,'observer':True,'acl':_acl(['EXECUTE'],('tf_feed_lab_writer','tf_feed_lab_observer')),'otherGrants':0}
 if not _same(extra,[expected]):raise FeedPgTrialError('Document reference private profile unavailable')
 validate_profile({**value,'functions':[row for row in value['functions'] if row.get('name')!='tf_feed_runtime.document_reference']})
 return value


def reference(roles,request,role='tf_feed_lab_observer'):
 raw=reader_query(roles,stored_document_reference_statement(request),role)
 return parse_stored_document_reference(raw,request,observed_at=datetime.now(timezone.utc)),raw


def request_for(roles,scope,item_id):
 request=prepare_inventory_request(scope,item_limit=20);_,raw=read(roles,request)
 return prepare_capture_reopen(request,raw,observed_at=datetime.now(timezone.utc),item_id=item_id)


def direct(payload,*,isolation='repeatable read read only'):
 return HEAD+"set time zone 'UTC';begin isolation level "+isolation+';select tf_feed_runtime.document_reference('+_literal(json.dumps(payload,separators=(',',':')))+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def recover(trial,source,request,expected,before,access):
 defaults=private_defaults(trial.query);whole_dump_scope(trial.query);trial.inspect()
 dump=trial.run(['docker','exec',trial.identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--format=p'],timeout=20)
 if dump.stderr or not 1<=len(dump.stdout)<=131072:raise FeedPgTrialError('Bounded document reference overlay dump unavailable')
 if not all(token in dump.stdout for token in [b'OWNER TO tf_feed_lab_owner',b'ALTER DEFAULT PRIVILEGES FOR ROLE tf_feed_lab_owner',b'FROM PUBLIC']):raise FeedPgTrialError('Document reference private dump unavailable')
 if any(token in dump.stdout.upper() for token in [b'\nCREATE ROLE',b'\nALTER ROLE',b'\nCREATE DATABASE',b'PASSWORD ']):raise FeedPgTrialError('Unexpected dump principal operation')
 trial.record('DOCUMENT_REFERENCE_DUMP',{'bytes':len(dump.stdout),'sha256':sha256(dump.stdout).hexdigest(),'preservesOwnerACLDefaults':True,'functions':22,'sameClusterOnly':True})
 target=OwnedRestoreDatabase(trial);target.create()
 failed=target.query(dump.stdout+b'\nselect 1/0;\n',single_transaction=True,allowed=True)
 trial.check('new_reference_overlay_restore_fault_refuses',failed.returncode!=0 and b'division by zero' in failed.stderr)
 absent=target.query('select count(*) from pg_namespace where nspname in ('+','.join(_literal(n) for n in SCHEMAS)+');')
 trial.check('new_reference_failed_restore_all_six_schemas_absent',absent.stdout.strip()==b'0')
 target.query(dump.stdout,single_transaction=True);view=RestoredView(trial,target);roles=restored_role_port(source,target)
 copied_access=reference_profile(target.query);trial.record('DOCUMENT_REFERENCE_RESTORED_ACCESS',copied_access)
 copied_defaults=private_defaults(target.query);trial.record('DOCUMENT_REFERENCE_RESTORED_DEFAULTS',copied_defaults)
 trial.check('new_reference_owners_full_acl_default_rls_and_nine_tables_restored_exact',copied_access==access and copied_defaults==defaults and snapshot(view)==before)
 recovered,_=reference(roles,request)
 trial.check('restored_restricted_reference_exact_historical_identity',recovered.reference==expected.reference)
 target.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(expected.reference.feed_stream_id)+'::uuid;')
 denied(view,roles,'copy_only_new_reference_scope_revoked',stored_document_reference_statement(request))
 trial.check('original_all_rows_and_scopes_unmodified_after_copy_revoke',snapshot(trial)==before)
 original,_=reference(source,request);trial.check('original_reference_still_accessible',original.reference==expected.reference)
 target.query('insert into tf_feed_runtime.allowed_streams values('+_literal(expected.reference.feed_stream_id)+'::uuid);')
 trial.stop();trial.start();roles.verify();source.verify()
 restarted,_=reference(roles,request)
 trial.check('restored_new_reference_survives_actual_restart',restarted.reference==expected.reference and reference_profile(target.query)==access and private_defaults(target.query)==defaults)
 trial.check('restored_and_original_nine_complete_row_hashes_exact',snapshot(view)==before and snapshot(trial)==before)
 trial.record('DOCUMENT_REFERENCE_FINAL_DATABASE',target.current())
 return target.name,target.oid


def cases(trial):
 roles,independent,foreign_scope,foreign,later=prepare(trial);install_reference(trial,roles)
 scope,binding,mapping,association=independent;access=reference_profile(trial.query)
 trial.record('DOCUMENT_REFERENCE_SOURCE_ACCESS',access);trial.record('DOCUMENT_REFERENCE_SOURCE_DEFAULTS',private_defaults(trial.query))
 trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
 request=request_for(roles,scope,association.feed_item_id)
 denied(trial,roles,'metadata_only_does_not_grant_document_reference',stored_document_reference_statement(request))
 selected_stream=json.loads(request.canonical_input)['stream_id']
 trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(selected_stream)+'::uuid);')
 before=snapshot(trial);trial.stop();trial.start();roles.verify()
 request=request_for(roles,scope,association.feed_item_id);observed,raw=reference(roles,request);other,_=reference(roles,request,'tf_feed_lab_writer')
 candidate=observed.reference
 trial.check('actual_stored_reference_same_for_existing_observer_and_writer',type(candidate) is HistoricalStoredDocumentReference and other.reference==candidate
  and candidate.source_version_id==binding.source_version_id and candidate.content_sha256==binding.content_sha256 and candidate.feed_item_id==association.feed_item_id)
 trial.check('reference_output_has_no_original_title_passage_snapshot_or_spans',all(term not in raw for term in [b'"raw"',b'"raw_base64"',b'"snapshot"',b'"spans"',b'"title"',b'Exact',b'Ignored']))
 # An independently supplied trusted-record index is separate from candidate
 # data. The candidate only locates it; no constructor adopts stored metadata.
 key=lambda b:(b.source_key,b.item_key,b.source_version_id,b.content_sha256,b.mapping_sha256,b.language_code)
 trusted={key(binding):(binding,mapping,association)}
 located=trusted.get((candidate.source_key,candidate.item_key,candidate.source_version_id,candidate.content_sha256,candidate.mapping_sha256,candidate.language_code))
 trial.check('historical_candidate_locates_only_separately_supplied_trusted_record',located is not None and candidate.source_url==binding.source_url
  and candidate.retrieved_at==binding.retrieved_at and candidate.feed_capture_operation_id==association.feed_operation_id)
 full=cold_chain(trial,roles,scope,*located)
 trial.check('independent_located_binding_reopens_actual_document_and_full_receipt',full['document'].artifact_id==candidate.artifact_id and full['document'].result_request.operation_id==candidate.operation_id
  and full['stored'].outcome_revision==candidate.outcome_revision and snapshot(trial)==before)
 # The newer occurrence has no result, while the older result above exists.
 # Absence for one item cannot mean no prior document/source history.
 inventory,inventory_raw=read(roles,prepare_inventory_request(scope,item_limit=20))
 pending_row=next(row for row in inventory.rows if row.item_id!=association.feed_item_id)
 pending=prepare_capture_reopen(prepare_inventory_request(scope,item_limit=20),inventory_raw,observed_at=datetime.now(timezone.utc),item_id=pending_row.item_id)
 denied(trial,roles,'later_window_reference_scope_not_inherited',stored_document_reference_statement(pending))
 trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(pending_row.stream_id)+'::uuid);')
 before=snapshot(trial);missing,_=reference(roles,pending)
 trial.check('assigned_pending_occurrence_explicit_absence_not_global_no_history',missing.reference is None and observed.reference is not None and snapshot(trial)==before)
 denied(trial,roles,'foreign_existing_document_reference',stored_document_reference_statement(foreign.request.feed.request))
 forged=json.loads(foreign.request.feed.request.canonical_input);forged['stream_id']=selected_stream
 denied(trial,roles,'foreign_capture_claims_assigned_stream',direct(forged))
 forged=json.loads(request.canonical_input);forged['item_id']=foreign.request.association.feed_item_id
 denied(trial,roles,'assigned_page_foreign_document_item',direct(forged))
 for isolation in ['repeatable read','read committed read only']:
  denied(trial,roles,'reference_context_'+isolation.replace(' ','_'),direct(json.loads(request.canonical_input),isolation=isolation),needle=b'invented_document_reference_requires_read_only')
 shadow=reader_query(roles,'create temp table document_results(feed_item_id uuid);set search_path=pg_temp,public;'+stored_document_reference_statement(request))
 trial.check('new_reference_fixedpath_ignores_temp_shadow',parse_stored_document_reference(shadow,request,observed_at=datetime.now(timezone.utc)).reference==candidate)
 ungranted_before=snapshot(trial);out=trial.query('set session authorization pg_monitor;'+stored_document_reference_statement(request),allowed=True)
 trial.check('public_nonowner_new_reference_denied_with_all_rows_exact',out.returncode!=0 and b'permission denied' in out.stderr.lower() and snapshot(trial)==ungranted_before)
 denied(trial,roles,'reference_does_not_grant_direct_result_table','select * from tf_feed_rehearsal.document_results;')
 denied(trial,roles,'reference_does_not_grant_allowlist_edit','delete from tf_feed_runtime.allowed_streams;')
 trial.check('all_reference_reads_refusals_and_independent_reopen_preserve_rows',snapshot(trial)==before)
 name,oid=recover(trial,roles,request,observed,before,access)
 return {'collectionId':scope.collection_id,'referenceOperationId':candidate.operation_id,'zeroOrOnePerOccurrence':True,'newTables':0,'functions':22,
  'historicalCandidateOnly':True,'trustedBindingAdoptedFromCandidate':False,'automaticBaselineSelected':False,'restoreDatabase':name,'restoreOID':oid,'operationalAcceptance':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented document reference trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_all(trial);freeze_reference(trial);trial.create();identities=cases(trial)
  trial.record('DOCUMENT_REFERENCE_RESULT',{'state':'PASS_INVENTED_DOCUMENT_REFERENCE','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':identities,'primaryChanged':False})
 except BaseException as error:
  trial.record('DOCUMENT_REFERENCE_FAILED',{'type':type(error).__name__,'message':'invented_document_reference_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_DOCUMENT_REFERENCE')
  if trial.identity is not None:trial.record('DOCUMENT_REFERENCE_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_DOCUMENT_REFERENCE','primaryChanged':False}))

if __name__=='__main__':main()
