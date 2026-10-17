"""Fresh existing-NOLOGIN-role collection metadata discovery only.

SET SESSION AUTHORIZATION is an owner-controlled ACL simulation, not login
proof or arbitrary-SQL containment. Raw/history/processing scopes stay separate.
"""
from __future__ import annotations
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,seed,rss,entry,capture_context,capture
from scripts.rehearse_feed_windows import freeze_windows,initialize,successor,advance,FIXTURE as WINDOW_FIXTURE
from scripts.rehearse_feed_inventory import freeze_inventory,outcome,FIXTURE as INVENTORY_FIXTURE
from scripts.rehearse_invented_document_results import freeze_additional
from scripts.rehearse_feed_runtime_roles import freeze_runtime,OwnedRuntimeRoles
from workers.feed_collection_inventory import prepare_inventory_request,parse_collection_inventory_page
from workers.feed_collection_reader import restricted_inventory_statement
from workers.feed_postgres_contract import committed_pg_json,HEAD,COMMIT_MARKER
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_collection_reader.sql'


def freeze_reader(trial):
 names={FIXTURE,'scripts/rehearse_collection_reader.py','workers/feed_collection_reader.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Collection reader dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('COLLECTION_READER_SOURCE_BINDINGS',rows)
 trial.record('COLLECTION_READER_SCOPE',{'newPrincipalTypes':False,'metadataOnly':True,'ownerAssignedCollections':True,
  'rawStreamScopeUnchanged':True,'sessionAuthorizationSimulationOnly':True,'primaryChanged':False,'sourceRequests':0,'modelCalls':0})


def install_reader(trial,roles):
 if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:raise FeedPgTrialError('Collection reader custodian mismatch')
 roles.verify();trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode()+'commit;');roles.verify()


def snapshot(trial):
 tables=[('streams','tf_feed_rehearsal.streams','id'),('pages','tf_feed_rehearsal.pages','operation_id'),
  ('items','tf_feed_rehearsal.items','item_id'),('outcomes','tf_feed_rehearsal.outcomes','operation_id'),
  ('documents','tf_feed_rehearsal.document_results','operation_id'),('collections','tf_feed_windows.collections','id'),
  ('windows','tf_feed_windows.windows','operation_id'),('streamScope','tf_feed_runtime.allowed_streams','stream_id'),
  ('collectionScope','tf_feed_runtime.allowed_collections','collection_id')]
 fields=[]
 for key,table,order in tables:
  fields += [_literal(key),"(select jsonb_build_object('rows',jsonb_array_length(body),'bytes',octet_length(body::text),'sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from (select coalesce(jsonb_agg(to_jsonb(t) order by "+order+"),'[]'::jsonb) body from "+table+' t) scope)']
 return json.loads(trial.query('begin isolation level repeatable read read only;select jsonb_build_object('+','.join(fields)+');commit;').stdout)


def access(trial):
 out=trial.query("""begin isolation level repeatable read read only;select jsonb_build_object(
 'wrapper',(select jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
 'publicGrants',(select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0),
 'writerExecute',has_function_privilege('tf_feed_lab_writer',p.oid,'EXECUTE'),'observerExecute',has_function_privilege('tf_feed_lab_observer',p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tf_feed_runtime' and p.proname='collection_inventory'),
 'helperDefiners',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('tf_feed_windows','tf_feed_inventory') and p.prosecdef),
 'ownedHelpers',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('tf_feed_windows','tf_feed_inventory') and pg_get_userbyid(p.proowner)='tf_feed_lab_owner'),
 'privateSchemaLeaks',(select count(*) from pg_namespace n where n.nspname in ('tf_feed_windows','tf_feed_inventory') and (has_schema_privilege('tf_feed_lab_writer',n.oid,'USAGE') or has_schema_privilege('tf_feed_lab_observer',n.oid,'USAGE'))),
 'ownerTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('tf_feed_rehearsal','tf_feed_windows','tf_feed_runtime') and c.relkind='r' and pg_get_userbyid(c.relowner)='tf_feed_lab_owner'),
 'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('tf_feed_rehearsal','tf_feed_windows','tf_feed_runtime') and c.relkind='r' and c.relrowsecurity),
 'scopeTableLeaks',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tf_feed_runtime' and c.relname in ('allowed_streams','allowed_collections') and (has_table_privilege('tf_feed_lab_writer',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('tf_feed_lab_observer',c.oid,'SELECT,INSERT,UPDATE,DELETE'))));commit;""")
 return json.loads(out.stdout)


def denied(trial,roles,label,sql,role='tf_feed_lab_observer'):
 before=snapshot(trial);out=roles.query(role,sql,allowed=True)
 trial.check(label+'_denied',out.returncode!=0 and (b'permission denied' in out.stderr.lower() or b'invented_collection_inventory_scope_denied' in out.stderr or b'invented_runtime_scope_denied' in out.stderr or b'invented_inventory_requires_coherent_read_only' in out.stderr))
 trial.check(label+'_all_nine_tables_exact',snapshot(trial)==before)


def read(roles,request,role='tf_feed_lab_observer'):
 out=roles.query(role,restricted_inventory_statement(request));raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
 return parse_collection_inventory_page(raw,request,observed_at=datetime.now(timezone.utc)),raw


def cases(trial):
 original=capture_context(rss(entry('old-failed')+entry('held','http://127.0.0.1/private')),seed(trial))
 page,page_raw=capture(trial,original);scope=initialize(trial,original);outcome(trial,original,page_raw,page.items[0].item_state_record_id,0,'failed')
 second=successor(trial,scope,original,raw=rss(entry('new-pending')));advance(trial,second)
 foreign=capture_context(rss(entry('foreign')),seed(trial));capture(trial,foreign);foreign_scope=initialize(trial,foreign)
 roles=OwnedRuntimeRoles(trial);roles.install();install_reader(trial,roles)
 observed=access(trial)
 expected={'wrapper':{'owner':'tf_feed_lab_owner','definer':True,'config':['search_path=pg_catalog, pg_temp'],'publicGrants':0,'writerExecute':True,'observerExecute':True},
  'helperDefiners':0,'ownedHelpers':5,'privateSchemaLeaks':0,'ownerTables':9,'rlsTables':9,'scopeTableLeaks':0}
 trial.check('actual_new_wrapper_owner_fixedpath_grants_private_helpers_rls',observed==expected)
 trial.record('COLLECTION_READER_ACCESS',observed)
 request=prepare_inventory_request(scope,item_limit=20)
 for role in ['tf_feed_lab_observer','tf_feed_lab_writer']:denied(trial,roles,'unassigned_'+role,restricted_inventory_statement(request),role)
 trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
 before=snapshot(trial)
 one,raw=read(roles,request);two,_=read(roles,request,'tf_feed_lab_writer')
 trial.check('assigned_metadata_rediscovers_old_failed_held_new_pending',[row.processing_state for row in one.rows]==['failed','parse_held','pending'] and one.rows==two.rows)
 trial.check('metadata_contains_no_raw_body_or_title_fields',all(key not in raw for key in [b'"raw_base64"',b'"metadata"',b'"title"',b'"raw"']))
 trial.check('both_metadata_reads_preserve_nine_tables_and_stream_scope',snapshot(trial)==before and before['streamScope']['rows']==0 and before['collectionScope']['rows']==1)
 denied(trial,roles,'foreign_existing_collection',restricted_inventory_statement(prepare_inventory_request(foreign_scope)))
 denied(trial,roles,'direct_inventory_helper',request.statement())
 for schema,table in [('tf_feed_rehearsal',n) for n in ['streams','pages','items','outcomes','document_results']]+[('tf_feed_windows','collections'),('tf_feed_windows','windows'),('tf_feed_runtime','allowed_streams'),('tf_feed_runtime','allowed_collections')]:
  denied(trial,roles,'direct_select_'+table,'select * from '+schema+'.'+table+';')
 for table in ['allowed_streams','allowed_collections']:
  denied(trial,roles,'scope_edit_'+table,'delete from tf_feed_runtime.'+table+';')
 denied(trial,roles,'private_collection_advance',"select tf_feed_windows.advance('{}'::jsonb);")
 denied(trial,roles,'observer_capture_write',"select tf_feed_runtime.capture('{}'::jsonb);")
 denied(trial,roles,'writer_collection_does_not_grant_stream_capture',"select tf_feed_runtime.capture("+_literal(original.canonical_input.decode())+'::jsonb);','tf_feed_lab_writer')
 denied(trial,roles,'raw_page_still_needs_separate_stream_scope',"select tf_feed_runtime.page_receipt("+_literal(original.operation_id)+"::uuid,''::bytea);")
 # Core read-only/coherent context must remain active through DEFINER wrapper.
 body=_literal(request.canonical_input.decode())+'::jsonb'
 denied(trial,roles,'wrapper_requires_readonly',HEAD+'begin isolation level repeatable read;select tf_feed_runtime.collection_inventory('+body+');commit;')
 denied(trial,roles,'wrapper_requires_repeatable',HEAD+'begin isolation level read committed read only;select tf_feed_runtime.collection_inventory('+body+');commit;')
 public=trial.query('set session authorization pg_monitor;'+restricted_inventory_statement(request),allowed=True)
 trial.check('ungranted_nonowner_has_no_collection_api',public.returncode!=0 and b'permission denied' in public.stderr.lower())
 # Metadata scope intentionally includes later captured windows of this same
 # immutable collection; it still grants no old/new raw stream scope.
 third=successor(trial,scope,second.first_capture,raw=rss(entry('later-window')));advance(trial,third)
 latest,_=read(roles,request)
 trial.check('same_assigned_collection_includes_later_window_metadata',len(latest.rows)==4 and latest.cut.window_revision==3)
 before=snapshot(trial);trial.stop();trial.start();roles.verify();restarted,_=read(roles,request)
 trial.check('restricted_metadata_survives_actual_restart',restarted.rows==latest.rows and restarted.cut==latest.cut)
 trial.check('new_wrapper_access_profile_survives_actual_restart',access(trial)==observed)
 trial.check('restart_read_preserves_data_and_exact_independent_allowlists',snapshot(trial)==before and before['streamScope']['rows']==0)
 trial.query('delete from tf_feed_runtime.allowed_collections where collection_id='+_literal(scope.collection_id)+'::uuid;')
 denied(trial,roles,'owner_revoked_collection_metadata',restricted_inventory_statement(request))
 return {'collectionId':scope.collection_id,'metadataWindows':3,'metadataOccurrences':4,'existingRolesOnly':True,
  'newRawOrWriteGrants':False,'fullNonownerProcessingChainAccepted':False,'loginAuthenticationTested':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented collection reader trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_windows(trial);freeze_inventory(trial);freeze_additional(trial);freeze_runtime(trial);freeze_reader(trial);trial.create()
  trial.query("begin;set local statement_timeout='10s';"+trial.frozen[WINDOW_FIXTURE].decode()+trial.frozen[INVENTORY_FIXTURE].decode()+trial.frozen['tests/fixtures/invented_document_results.sql'].decode()+'commit;')
  identities=cases(trial);trial.record('COLLECTION_READER_RESULT',{'state':'PASS_INVENTED_COLLECTION_READER','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':identities,'primaryChanged':False})
 except BaseException as error:
  trial.record('COLLECTION_READER_FAILED',{'type':type(error).__name__,'message':'invented_collection_reader_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_COLLECTION_READER')
  if trial.identity is not None:trial.record('COLLECTION_READER_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_COLLECTION_READER','primaryChanged':False}))

if __name__=='__main__':main()
