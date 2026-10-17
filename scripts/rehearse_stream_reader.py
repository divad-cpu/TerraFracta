"""Fresh invented restricted cold read composition, not login/operational proof.

Existing allowed_streams remains shared with the old writer. These new routes
only read. The owner-controlled SET SESSION AUTHORIZATION simulation does not
contain arbitrary SQL and never proves real authentication or tenant isolation.
"""
from __future__ import annotations
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,rss,entry
from scripts.rehearse_feed_windows import freeze_windows,successor,advance
from scripts.rehearse_feed_inventory import freeze_inventory
from scripts.rehearse_feed_reopen import freeze_reopen
from scripts.rehearse_invented_document_results import freeze_additional
from scripts.rehearse_document_reopen import (freeze_document_reopen,setup,resumed as owner_resumed,
 WINDOW_FIXTURE,INVENTORY_FIXTURE,REOPEN_FIXTURE,DOCUMENT_FIXTURE,FIXTURE as DOCUMENT_REOPEN_FIXTURE)
from scripts.rehearse_feed_runtime_roles import freeze_runtime,OwnedRuntimeRoles,api
from scripts.rehearse_collection_reader import freeze_reader,install_reader,snapshot,read
from scripts.rehearse_feed_role_restore import default_function_acl
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_capture_reopen import prepare_capture_reopen,parse_reopened_capture,confirm_reopened_page
from workers.document_result_reopen import prepare_document_reopen,parse_reopened_document,confirm_reopened_document_result
from workers.feed_postgres_processing import parse_invented_pg_item_history,invented_pg_item_history_statement
from workers.feed_stream_reader import (stream_feed_original_statement,stream_document_original_statement,
 stream_page_statement,stream_result_statement,stream_history_statement)
from workers.document_passage_comparison import DocumentPassageCapture
from workers.passage_extraction_request import compile_extraction_request
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_stream_reader.sql'
SCHEMAS=('tf_document_reopen','tf_feed_inventory','tf_feed_rehearsal','tf_feed_reopen','tf_feed_runtime','tf_feed_windows')
BASE_FIXTURES=(WINDOW_FIXTURE,INVENTORY_FIXTURE,REOPEN_FIXTURE,DOCUMENT_FIXTURE,DOCUMENT_REOPEN_FIXTURE)
READ_FUNCTIONS=('collection_inventory','feed_original','document_original','item_history','page_receipt','document_result_receipt')


def freeze_stream_reader(trial):
 names={FIXTURE,'scripts/rehearse_stream_reader.py','workers/feed_stream_reader.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Stream reader dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('STREAM_READER_SOURCE_BINDINGS',rows)
 trial.record('STREAM_READER_SCOPE',{'newRoutesReadOnly':True,'existingWriterStreamScopeAlsoEnablesWrites':True,
  'metadataScopeIndependent':True,'noLogin':True,'sessionAuthorizationSimulationOnly':True,'arbitrarySqlContainmentAccepted':False,
  'sourceRequests':0,'modelCalls':0,'publicationEnabled':False,'primaryChanged':False})


def freeze_all(trial):
 freeze_windows(trial);freeze_inventory(trial);freeze_reopen(trial);freeze_additional(trial)
 freeze_document_reopen(trial);freeze_runtime(trial);freeze_reader(trial);freeze_stream_reader(trial)


def install_stream_reader(trial,roles):
 if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:raise FeedPgTrialError('Stream reader custodian mismatch')
 roles.verify();trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode()+'commit;');roles.verify()


def profile(query):
 names=','.join(_literal(name) for name in SCHEMAS)
 sql="""begin isolation level repeatable read read only;select jsonb_build_object(
 'schemas',(select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),
  'writerUsage',has_schema_privilege('tf_feed_lab_writer',n.oid,'USAGE'),'observerUsage',has_schema_privilege('tf_feed_lab_observer',n.oid,'USAGE'),
  'acl',ACL_SCHEMA,
  'otherGrants',(select count(*) from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where a.grantee not in (n.nspowner,(select oid from pg_roles where rolname='tf_feed_lab_writer'),(select oid from pg_roles where rolname='tf_feed_lab_observer')))) order by n.nspname) from pg_namespace n where n.nspname in (NAMES)),
 'tables',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
  'acl',ACL_TABLE,
  'otherGrants',(select count(*) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (NAMES) and c.relkind='r'),
 'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,
  'writer',has_function_privilege('tf_feed_lab_writer',p.oid,'EXECUTE'),'observer',has_function_privilege('tf_feed_lab_observer',p.oid,'EXECUTE'),
  'acl',ACL_FUNCTION,
  'otherGrants',(select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in (p.proowner,(select oid from pg_roles where rolname='tf_feed_lab_writer'),(select oid from pg_roles where rolname='tf_feed_lab_observer')))) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (NAMES)));commit;""".replace('NAMES',names)
 for token,expression in [('ACL_SCHEMA',"coalesce(n.nspacl,acldefault('n',n.nspowner))"),('ACL_TABLE',"coalesce(c.relacl,acldefault('r',c.relowner))"),('ACL_FUNCTION',"coalesce(p.proacl,acldefault('f',p.proowner))")]:
  sql=sql.replace(token,"(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode("+expression+") a)")
 return json.loads(query(sql).stdout)


def _acl(privileges,readers=()):
 rows=[{'grantor':'tf_feed_lab_owner','grantee':'tf_feed_lab_owner','privilege':p,'grantable':False} for p in privileges]
 # The installer creates owner, writer, observer in that order. Native role OIDs
 # are bound independently; expected ACL order follows that same fixed order.
 for reader in readers:
  rows.append({'grantor':'tf_feed_lab_owner','grantee':reader,'privilege':'USAGE' if privileges==['CREATE','USAGE'] else 'EXECUTE','grantable':False})
 return rows


def _same(actual,expected):
 if type(actual) is not type(expected):return False
 if type(expected) is dict:return set(actual)==set(expected) and all(_same(actual[k],v) for k,v in expected.items())
 if type(expected) is list:return len(actual)==len(expected) and all(_same(a,b) for a,b in zip(actual,expected))
 return actual==expected


def validate_profile(value):
 from scripts.rehearse_complete_chain_restore import TABLES as BASE_TABLES,FUNCTIONS as BASE_FUNCTIONS
 tables=sorted([*BASE_TABLES,'tf_feed_runtime.allowed_streams','tf_feed_runtime.allowed_collections'])
 functions=sorted([*BASE_FUNCTIONS,*['tf_feed_runtime.'+name for name in [*READ_FUNCTIONS,'require_stream','capture','complete_document_result']]])
 if type(value) is not dict or set(value)!={'schemas','tables','functions'}:raise FeedPgTrialError('Stream reader private profile unavailable')
 for key in value:
  if type(value[key]) is not list or any(type(row) is not dict for row in value[key]):raise FeedPgTrialError('Stream reader private profile unavailable')
 if [row.get('name') for row in value['schemas']]!=list(SCHEMAS) or [row.get('name') for row in value['tables']]!=tables or [row.get('name') for row in value['functions']]!=functions:
  raise FeedPgTrialError('Stream reader private profile unavailable')
 for row in value['schemas']:
  expected={'name':row['name'],'owner':'tf_feed_lab_owner','writerUsage':row['name']=='tf_feed_runtime','observerUsage':row['name']=='tf_feed_runtime','acl':_acl(['CREATE','USAGE'],('tf_feed_lab_writer','tf_feed_lab_observer') if row['name']=='tf_feed_runtime' else ()),'otherGrants':0}
  if not _same(row,expected):raise FeedPgTrialError('Stream reader private profile unavailable')
 for row in value['tables']:
  if not _same(row,{'name':row['name'],'owner':'tf_feed_lab_owner','rls':True,'acl':_acl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']),'otherGrants':0}):raise FeedPgTrialError('Stream reader private profile unavailable')
 for row in value['functions']:
  name=row['name'].removeprefix('tf_feed_runtime.');runtime=row['name'].startswith('tf_feed_runtime.')
  expected={'name':row['name'],'owner':'tf_feed_lab_owner','definer':runtime and name!='require_stream','path':['search_path=pg_catalog, pg_temp'],
   'writer':runtime and name!='require_stream','observer':runtime and name in READ_FUNCTIONS,'acl':_acl(['EXECUTE'],(('tf_feed_lab_writer','tf_feed_lab_observer') if name in READ_FUNCTIONS else ('tf_feed_lab_writer',)) if runtime and name!='require_stream' else ()),'otherGrants':0}
  if not _same(row,expected):raise FeedPgTrialError('Stream reader private profile unavailable')
 return value


def reader_query(roles,statement,role='tf_feed_lab_observer'):
 out=roles.query(role,statement);return committed_pg_json(out.stdout,out.stderr,out.returncode)


def cold_chain(trial,roles,scope,binding,mapping,association):
 request=prepare_inventory_request(scope,item_limit=20);items,inventory_raw=read(roles,request)
 selected=next(row for row in items.rows if row.item_id==association.feed_item_id)
 feed_request=prepare_capture_reopen(request,inventory_raw,observed_at=datetime.now(timezone.utc),item_id=selected.item_id)
 raw=reader_query(roles,stream_feed_original_statement(feed_request))
 feed=parse_reopened_capture(raw,feed_request,observed_at=datetime.now(timezone.utc))
 page_raw=reader_query(roles,stream_page_statement(feed.capture));confirm_reopened_page(page_raw,feed,observed_at=datetime.now(timezone.utc))
 history_raw=reader_query(roles,stream_history_statement(feed.capture,selected.item_id))
 history=parse_invented_pg_item_history(history_raw,feed.capture,item_id=selected.item_id,observed_at=datetime.now(timezone.utc))
 document_request=prepare_document_reopen(feed,page_raw,history_raw,binding=binding,mapping=mapping,association=association,observed_at=datetime.now(timezone.utc))
 raw=reader_query(roles,stream_document_original_statement(document_request))
 reopened=parse_reopened_document(raw,document_request,observed_at=datetime.now(timezone.utc))
 receipt=reader_query(roles,stream_result_statement(reopened.result_request))
 stored=confirm_reopened_document_result(receipt,reopened,observed_at=datetime.now(timezone.utc))
 current=DocumentPassageCapture(reopened.result_request.document_raw,reopened.result_request.document,binding,mapping)
 compiled=compile_extraction_request(current,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
 trial.check('restricted_cold_complete_local_request_'+str(len(trial.assertions)),history.state=='processed' and stored.outcome_revision==1
  and json.loads(compiled.body)['selected_payload']['content_sha256']==binding.content_sha256 and compiled.request_sha256==sha256(compiled.body).hexdigest())
 return {'inventoryRequest':request,'inventoryRaw':inventory_raw,'inventory':items,'feedRequest':feed_request,'feed':feed,'pageRaw':page_raw,
  'historyRaw':history_raw,'documentRequest':document_request,'document':reopened,'stored':stored,'resultRaw':receipt,'compiled':compiled}


def denied(trial,roles,label,sql,*,role='tf_feed_lab_observer',needle=None):
 before=snapshot(trial);out=roles.query(role,sql,allowed=True)
 needles=[needle] if needle else [b'permission denied',b'invented_runtime_scope_denied',b'invented_collection_inventory_scope_denied',
  b'invented_stream_reader_requires_read_only',b'invented_stream_reader_item_mismatch',b'invented_reopen_unavailable']
 trial.check(label+'_denied',out.returncode!=0 and bool(out.stderr) and any(n in out.stderr.lower() for n in needles))
 trial.check(label+'_all_nine_tables_exact',snapshot(trial)==before)


def fixed_json(function,payload,*,isolation='repeatable read read only'):
 if function not in ('feed_original','document_original'):raise FeedPgTrialError('Fixed stream read function unavailable')
 return HEAD+"set time zone 'UTC';begin isolation level "+isolation+';select tf_feed_runtime.'+function+'('+_literal(json.dumps(payload,separators=(',',':')))+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def history_sql_wrong_raw(result):
 sql=stream_history_statement(result['feed'].capture,result['feedRequest'].item_id)
 import base64
 original=base64.b64encode(result['feed'].capture.raw).decode()
 return sql.replace(_literal(original),_literal(base64.b64encode(b'invented wrong original').decode()),1)


def changed_document_payload(result,field):
 payload=json.loads(result['documentRequest'].canonical_input)
 payload[field]['source_key' if field=='binding' else 'document_source_key']='fictional-changed-independent'
 return payload


def prepare(trial):
 trial.query("begin;set local statement_timeout='10s';"+''.join(trial.frozen[name].decode() for name in BASE_FIXTURES)+'commit;')
 scope,binding,mapping,association=setup(trial)
 # Owner-only contexts below seed adversarial fixtures; they never supply the
 # resumed observer's original A bytes, page, history or document request.
 owner,_,_,_=owner_resumed(trial,scope,binding,mapping,association)
 later=successor(trial,scope,owner.request.feed.capture,raw=rss(entry('later-window')));advance(trial,later)
 foreign_scope,foreign_binding,foreign_mapping,foreign_association=setup(trial)
 foreign,_,_,_=owner_resumed(trial,foreign_scope,foreign_binding,foreign_mapping,foreign_association)
 roles=OwnedRuntimeRoles(trial);roles.install();install_reader(trial,roles);install_stream_reader(trial,roles)
 return roles,(scope,binding,mapping,association),foreign_scope,foreign,later


def cases(trial):
 roles,independent,foreign_scope,foreign,later=prepare(trial);scope,binding,mapping,association=independent
 observed=validate_profile(profile(trial.query));trial.record('STREAM_READER_ACCESS',observed)
 trial.record('STREAM_READER_DEFAULTS',default_function_acl(trial.query))
 request=prepare_inventory_request(scope,item_limit=20)
 denied(trial,roles,'unassigned_metadata',request.statement().replace('tf_feed_inventory.page','tf_feed_runtime.collection_inventory',1))
 trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
 items,inventory_raw=read(roles,request);selected=next(row for row in items.rows if row.item_id==association.feed_item_id)
 pending=next(row for row in items.rows if row.item_id!=association.feed_item_id)
 trial.check('metadata_only_has_processed_and_later_pending_without_raw_scope',len(items.rows)==2 and {r.processing_state for r in items.rows}=={'processed','pending'} and snapshot(trial)['streamScope']['rows']==0)
 feed_request=prepare_capture_reopen(request,inventory_raw,observed_at=datetime.now(timezone.utc),item_id=selected.item_id)
 denied(trial,roles,'metadata_does_not_grant_original',stream_feed_original_statement(feed_request))
 denied(trial,roles,'metadata_does_not_grant_foreign_document',stream_document_original_statement(foreign.request))
 trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(selected.stream_id)+'::uuid);')
 before=snapshot(trial);trial.stop();trial.start();roles.verify()
 result=cold_chain(trial,roles,*independent)
 trial.check('new_observer_cold_chain_after_actual_restart_read_only',snapshot(trial)==before and result['stored'].result.snapshot.passages[0].text=='  Exact Å source passage.')
 owner_out=trial.query(invented_pg_item_history_statement(result['feed'].capture,selected.item_id))
 trial.check('new_scoped_history_exact_existing_owner_projection',committed_pg_json(owner_out.stdout,owner_out.stderr,owner_out.returncode)==result['historyRaw'])
 # New DEFINER composition-specific input and resolution controls.
 for label,sql,needle in [
  ('assigned_page_wrong_raw',history_sql_wrong_raw(result),b'invented_stream_reader_item_mismatch'),
  ('changed_independent_binding',fixed_json('document_original',changed_document_payload(result,'binding')),b'invented_document_reopen_binding_mismatch'),
  ('changed_independent_association',fixed_json('document_original',changed_document_payload(result,'association')),b'invented_document_reopen_binding_mismatch')]:
  denied(trial,roles,label,sql,needle=needle)
 shadow="create temp table pages(operation_id uuid,raw bytea);create temp table outcomes(item_id uuid,revision integer);set search_path=pg_temp,public;"
 shadow_raw=reader_query(roles,shadow+stream_history_statement(result['feed'].capture,selected.item_id))
 trial.check('new_history_definer_ignores_temp_table_shadow',shadow_raw==result['historyRaw'])
 ungranted_before=snapshot(trial)
 out=trial.query('set session authorization pg_monitor;'+stream_feed_original_statement(result['feedRequest']),allowed=True)
 trial.check('ungranted_nonowner_has_no_new_original_api',out.returncode!=0 and b'permission denied' in out.stderr.lower())
 trial.check('ungranted_nonowner_all_nine_tables_exact',snapshot(trial)==ungranted_before)
 for statement in [stream_feed_original_statement(result['feedRequest']),stream_document_original_statement(result['documentRequest']),
  stream_page_statement(result['feed'].capture),stream_history_statement(result['feed'].capture,selected.item_id),stream_result_statement(result['document'].result_request)]:
  observed_writer=reader_query(roles,statement,'tf_feed_lab_writer')
  trial.check('writer_same_new_read_route_'+str(len(trial.assertions)),bool(observed_writer))
 for label,sql in [('foreign_feed_original',stream_feed_original_statement(foreign.request.feed.request)),
  ('foreign_document_original',stream_document_original_statement(foreign.request)),
  ('foreign_page',stream_page_statement(foreign.request.feed.capture)),
  ('foreign_history',stream_history_statement(foreign.request.feed.capture,foreign_scope.collection_id)),
  ('foreign_result',stream_result_statement(foreign.result_request))]:denied(trial,roles,label,sql)
 # A supplied assigned stream cannot override the operation's actual foreign stream.
 payload=json.loads(foreign.request.feed.request.canonical_input);payload['stream_id']=selected.stream_id
 denied(trial,roles,'foreign_operation_claiming_assigned_stream',fixed_json('feed_original',payload))
 payload=json.loads(foreign.request.canonical_input);payload['feed']['stream_id']=selected.stream_id
 denied(trial,roles,'foreign_result_claiming_assigned_stream',fixed_json('document_original',payload))
 denied(trial,roles,'assigned_page_foreign_item_no_history_leak',stream_history_statement(result['feed'].capture,foreign.request.association.feed_item_id))
 later_request=prepare_capture_reopen(request,inventory_raw,observed_at=datetime.now(timezone.utc),item_id=pending.item_id)
 denied(trial,roles,'later_metadata_window_not_raw_assigned',stream_feed_original_statement(later_request))
 for label,function,payload in [('feed','feed_original',json.loads(result['feedRequest'].canonical_input)),('document','document_original',json.loads(result['documentRequest'].canonical_input))]:
  for isolation in ['repeatable read','read committed read only']:denied(trial,roles,label+'_context_'+isolation.replace(' ','_'),fixed_json(function,payload,isolation=isolation))
 history_sql=stream_history_statement(result['feed'].capture,selected.item_id)
 for isolation in ['repeatable read','read committed read only']:
  denied(trial,roles,'history_context_'+isolation.replace(' ','_'),history_sql.replace('repeatable read read only',isolation,1))
 for table in ['tf_feed_rehearsal.pages','tf_feed_rehearsal.outcomes','tf_feed_rehearsal.document_results','tf_feed_runtime.allowed_streams','tf_feed_runtime.allowed_collections']:
  denied(trial,roles,'direct_select_'+table.replace('.','_'),'select * from '+table+';')
 for table in ['allowed_streams','allowed_collections']:denied(trial,roles,'scope_edit_'+table,'delete from tf_feed_runtime.'+table+';')
 denied(trial,roles,'private_feed_original',result['feedRequest'].statement())
 denied(trial,roles,'private_document_original',result['documentRequest'].statement())
 denied(trial,roles,'observer_capture_still_denied',api(result['feed'].capture.statement()))
 denied(trial,roles,'observer_complete_still_denied',api(result['document'].result_request.statement()))
 # A writer exact retry confirms old scope behavior rather than claiming the
 # shared assignment became a new isolated read-only permission.
 out=roles.query('tf_feed_lab_writer',api(result['document'].result_request.statement()))
 trial.check('existing_writer_completion_scope_unchanged_exact_retry',committed_pg_json(out.stdout,out.stderr,out.returncode)==result['resultRaw'])
 trial.check('all_new_reads_and_old_exact_retry_preserve_complete_rows',snapshot(trial)==before)
 # Revoking metadata does not revoke separately assigned raw access. Cached,
 # already checked inventory can still support the exact original request.
 trial.query('delete from tf_feed_runtime.allowed_collections where collection_id='+_literal(scope.collection_id)+'::uuid;')
 denied(trial,roles,'metadata_revoked',result['inventoryRequest'].statement().replace('tf_feed_inventory.page','tf_feed_runtime.collection_inventory',1))
 before=snapshot(trial)
 original=reader_query(roles,stream_feed_original_statement(result['feedRequest']))
 parse_reopened_capture(original,result['feedRequest'],observed_at=datetime.now(timezone.utc))
 trial.check('cached_checked_metadata_and_independent_raw_scope_still_valid',snapshot(trial)==before)
 trial.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(selected.stream_id)+'::uuid;')
 for label,sql in [('feed',stream_feed_original_statement(result['feedRequest'])),('document',stream_document_original_statement(result['documentRequest'])),
  ('page',stream_page_statement(result['feed'].capture)),('history',history_sql),('result',stream_result_statement(result['document'].result_request))]:denied(trial,roles,'raw_revoked_'+label,sql)
 trial.check('final_owners_paths_acl_rls_defaults_unchanged',validate_profile(profile(trial.query))==observed and default_function_acl(trial.query)=={'explicitEntries':1,'publicExecute':0})
 return {'collectionId':scope.collection_id,'readRoutes':5,'newDefinerFunctions':3,'tables':9,'functions':21,'actualColdObserverChain':True,
  'originalAContextsUsedByResumedChain':False,'scopeAlsoEnablesExistingWriterWrites':True,'loginAuthenticationAccepted':False,'primaryChanged':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented stream reader trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_all(trial);trial.create();identities=cases(trial)
  trial.record('STREAM_READER_RESULT',{'state':'PASS_INVENTED_STREAM_READER','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':identities,'primaryChanged':False})
 except BaseException as error:
  trial.record('STREAM_READER_FAILED',{'type':type(error).__name__,'message':'invented_stream_reader_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_STREAM_READER')
  if trial.identity is not None:trial.record('STREAM_READER_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_STREAM_READER','primaryChanged':False}))

if __name__=='__main__':main()
