"""Exact invented six-schema read-profile recovery in one new owned database.

Whole fresh database only; retain owner/ACL/defaults and existing bound NOLOGIN
roles. Same-machine logical backup, not actual host/off-host/NAS recovery. The
original admin-controlled role simulation is never a login/SQL-isolation proof.
"""
from __future__ import annotations
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN
from scripts.rehearse_stream_reader import (freeze_all,prepare,profile,validate_profile,SCHEMAS,cold_chain,reader_query,denied,_same,_acl)
from scripts.rehearse_collection_reader import snapshot,read
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_complete_chain_restore import RestoredView
from scripts.rehearse_feed_role_restore import restored_role_port,default_function_acl
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_stream_reader import stream_feed_original_statement,stream_history_statement
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]


def freeze_stream_restore(trial):
 names={'scripts/rehearse_stream_reader_restore.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Stream restore dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('STREAM_RESTORE_SOURCE_BINDINGS',rows)


def whole_dump_scope(query):
 value=json.loads(query("""begin isolation level repeatable read read only;select jsonb_build_object(
 'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema'),
 'publicRelations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'publicFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'extensions',(select jsonb_agg(extname order by extname) from pg_extension),
 'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind='r'));commit;""").stdout)
 expected={'schemas':['public',*SCHEMAS],'publicRelations':0,'publicFunctions':0,'extensions':['plpgsql'],'tables':9}
 if type(value) is not dict or set(value)!=set(expected) or any(type(value[k]) is not type(v) or value[k]!=v for k,v in expected.items()):
  raise FeedPgTrialError('Whole invented stream restore scope unavailable')
 return value


def private_defaults(query):
 summary=default_function_acl(query)
 # Retain the complete owner default-ACL entries as well as the existing
 # missing-row/PUBLIC-default guard. An unexpected writer grant must not pass.
 out=query("""select coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),
 'schema',coalesce(n.nspname,'<global>'),'type',d.defaclobjtype,
 'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
  'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
  from aclexplode(d.defaclacl) a)) order by d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclrole=(select oid from pg_roles where rolname='tf_feed_lab_owner');""")
 entries=json.loads(out.stdout)
 expected=[{'owner':'tf_feed_lab_owner','schema':'<global>','type':'f','acl':_acl(['EXECUTE'])}]
 if not _same(entries,expected):raise FeedPgTrialError('Exact private owner default ACL unavailable')
 return {'summary':summary,'entries':entries}


def cases(trial):
 source,independent,_,_,_=prepare(trial);scope,binding,mapping,association=independent
 trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
 inventory,_=read(source,prepare_inventory_request(scope,item_limit=20));selected=next(row for row in inventory.rows if row.item_id==association.feed_item_id)
 trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(selected.stream_id)+'::uuid);')
 before=snapshot(trial);access=validate_profile(profile(trial.query));defaults=private_defaults(trial.query)
 trial.record('STREAM_RESTORE_SOURCE_PROFILE',access);trial.record('STREAM_RESTORE_SOURCE_DEFAULTS',defaults)
 trial.record('STREAM_RESTORE_WHOLE_DUMP_SCOPE',whole_dump_scope(trial.query));trial.inspect()
 dump=trial.run(['docker','exec',trial.identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--format=p'],timeout=20)
 if dump.stderr or not 1<=len(dump.stdout)<=131072:raise FeedPgTrialError('Bounded stream role-preserving dump unavailable')
 trial.check('dump_retains_owner_acl_and_global_private_default',all(token in dump.stdout for token in
  [b'OWNER TO tf_feed_lab_owner',b'ALTER DEFAULT PRIVILEGES FOR ROLE tf_feed_lab_owner',b'REVOKE ALL ON FUNCTIONS',b'FROM PUBLIC']))
 trial.check('dump_creates_no_roles_logins_or_databases',not any(token in dump.stdout.upper() for token in
  [b'\nCREATE ROLE',b'\nALTER ROLE',b'\nCREATE DATABASE',b'PASSWORD ']))
 trial.record('STREAM_ROLE_PRESERVING_DUMP',{'bytes':len(dump.stdout),'sha256':sha256(dump.stdout).hexdigest(),
  'preservesOwners':True,'preservesACL':True,'preservesGlobalDefaultPrivileges':True,'schemas':SCHEMAS,'sameClusterBoundRoles':True})
 target=OwnedRestoreDatabase(trial);target.create()
 failed=target.query(dump.stdout+b'\nselect 1/0;\n',single_transaction=True,allowed=True)
 trial.check('expanded_profile_restore_fault_refused',failed.returncode!=0 and b'division by zero' in failed.stderr)
 absent=target.query('select count(*) from pg_namespace where nspname in ('+','.join(_literal(n) for n in SCHEMAS)+');')
 trial.check('failed_full_restore_leaves_all_six_schemas_absent',absent.stdout.strip()==b'0')
 target.query(dump.stdout,single_transaction=True);view=RestoredView(trial,target);roles=restored_role_port(source,target)
 trial.check('restored_all_nine_complete_row_arrays_exact',snapshot(view)==before)
 restored_access=validate_profile(profile(target.query));restored_defaults=private_defaults(target.query)
 trial.record('STREAM_RESTORE_TARGET_PROFILE',restored_access);trial.record('STREAM_RESTORE_TARGET_DEFAULTS',restored_defaults)
 trial.check('restored_exact_owners_grants_paths_rls_and_private_future_default',restored_access==access and restored_defaults==defaults)
 recovered=cold_chain(view,roles,*independent)
 trial.check('restored_observer_recovers_full_original_chain_to_local_request',sha256(recovered['document'].result_request.document_raw).hexdigest()==binding.content_sha256
  and recovered['stored'].outcome_revision==1 and snapshot(view)==before)
 denied(view,roles,'restored_observer_cannot_write',"select tf_feed_runtime.complete_document_result('{}'::jsonb,''::bytea);")
 denied(view,roles,'restored_private_helper_denied',recovered['feedRequest'].statement())
 denied(view,roles,'restored_scope_table_denied','delete from tf_feed_runtime.allowed_streams;')
 trial.check('original_exact_after_copy_observer_reads',snapshot(trial)==before)
 # Owner changes only the copied raw scope; source permissions and data remain
 # independently exact. A cached original request cannot override revocation.
 target.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(selected.stream_id)+'::uuid;')
 denied(view,roles,'copy_only_raw_scope_revoked',stream_feed_original_statement(recovered['feedRequest']))
 denied(view,roles,'copy_only_history_scope_revoked',stream_history_statement(recovered['feed'].capture,selected.item_id))
 trial.check('source_scope_and_all_rows_exact_after_copy_revoke',snapshot(trial)==before)
 original=cold_chain(trial,source,*independent)
 trial.check('original_observer_still_compiles_identical_request',original['compiled']==recovered['compiled'] and original['stored']==recovered['stored'])
 target.query('insert into tf_feed_runtime.allowed_streams values('+_literal(selected.stream_id)+'::uuid);')
 trial.check('copy_raw_scope_explicitly_restored_exact',snapshot(view)==before)
 trial.stop();trial.start();source.verify();roles.verify()
 again=cold_chain(view,roles,*independent)
 trial.check('recovered_observer_chain_after_actual_restart',again['document'].artifact_id==recovered['document'].artifact_id
  and again['document'].result_request.document_raw==recovered['document'].result_request.document_raw
  and again['stored']==recovered['stored'] and again['compiled']==recovered['compiled'])
 trial.check('copy_and_original_all_rows_still_exact_after_restart',snapshot(view)==before and snapshot(trial)==before)
 trial.check('restored_exact_access_defaults_after_restart',validate_profile(profile(target.query))==access and private_defaults(target.query)==defaults)
 trial.record('STREAM_RESTORE_FINAL_DATABASE',target.current())
 return {'database':target.name,'oid':target.oid,'schemas':6,'tables':9,'functions':21,'boundRolesReused':True,
  'fullColdObserverChain':True,'copyOnlyScopeRevokeProved':True,'actualLoginAccepted':False,'offHostOrOperationalAccepted':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented stream reader restore takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_all(trial);freeze_stream_restore(trial);trial.create();identities=cases(trial)
  trial.record('STREAM_RESTORE_RESULT',{'state':'PASS_INVENTED_STREAM_READER_RESTORE','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':identities,'primaryChanged':False})
 except BaseException as error:
  trial.record('STREAM_RESTORE_FAILED',{'type':type(error).__name__,'message':'invented_stream_restore_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_STREAM_RESTORE')
  if trial.identity is not None:trial.record('STREAM_RESTORE_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_STREAM_READER_RESTORE','primaryChanged':False}))

if __name__=='__main__':main()
