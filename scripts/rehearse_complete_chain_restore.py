"""Coherent five-schema invented recovery→originals→local request composition.

Same owned cluster/new OID-bound database only; no off-host/NAS/power-loss or
restricted-role recovery claim. No original raw contexts survive setup.
"""
from __future__ import annotations
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN
from scripts.rehearse_feed_windows import freeze_windows,successor,advance
from scripts.rehearse_feed_inventory import freeze_inventory
from scripts.rehearse_feed_reopen import freeze_reopen
from scripts.rehearse_invented_document_results import freeze_additional
from scripts.rehearse_document_reopen import (freeze_document_reopen,setup,resumed,full_snapshot,
 WINDOW_FIXTURE,INVENTORY_FIXTURE,REOPEN_FIXTURE,DOCUMENT_FIXTURE,FIXTURE as DOCUMENT_REOPEN_FIXTURE)
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
SCHEMAS=('tf_document_reopen','tf_feed_inventory','tf_feed_rehearsal','tf_feed_reopen','tf_feed_windows')
TABLES=tuple(sorted(['tf_feed_rehearsal.'+name for name in ['streams','pages','items','outcomes','document_results']]+['tf_feed_windows.collections','tf_feed_windows.windows']))
FUNCTIONS=tuple(sorted(['tf_document_reopen.original','tf_feed_inventory.page','tf_feed_reopen.original']+
 ['tf_feed_rehearsal.'+name for name in ['capture','page_receipt','record_outcome','complete_document_result','document_result_receipt']]+
 ['tf_feed_windows.'+name for name in ['advance','head','initialize','receipt']]))


def freeze_complete_restore(trial):
 names={'scripts/rehearse_complete_chain_restore.py'};queue=list(names)
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
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Complete restore dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw
  row={'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()};rows.append(row);trial.source_bindings.append(row)
 trial.record('COMPLETE_RESTORE_SOURCE_BINDINGS',rows)


def access(query):
 names=','.join(_literal(name) for name in SCHEMAS)
 sql="""begin isolation level repeatable read read only;select jsonb_build_object(
 'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname in (NAMES)),
 'tables',(select jsonb_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (NAMES) and c.relkind='r'),
 'functions',(select jsonb_agg(n.nspname||'.'||p.proname order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (NAMES)),
 'ownerSchemas',(select count(*) from pg_namespace where nspname in (NAMES) and pg_get_userbyid(nspowner)='postgres'),
 'ownerTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (NAMES) and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres'),
 'ownerFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (NAMES) and pg_get_userbyid(p.proowner)='postgres'),
 'definers',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (NAMES) and p.prosecdef),
 'otherFunctionGrants',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname in (NAMES) and a.grantee<>p.proowner),
 'otherTableGrants',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname in (NAMES) and c.relkind='r' and a.grantee<>c.relowner),
 'otherSchemaGrants',(select count(*) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname in (NAMES) and a.grantee<>n.nspowner),
 'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (NAMES) and c.relkind='r' and c.relrowsecurity));commit;""".replace('NAMES',names)
 return json.loads(query(sql).stdout)


def validate_profile(value):
 expected={'schemas':list(SCHEMAS),'tables':list(TABLES),'functions':list(FUNCTIONS),'ownerSchemas':5,'ownerTables':7,'ownerFunctions':12,
  'definers':0,'otherFunctionGrants':0,'otherTableGrants':0,'otherSchemaGrants':0,'rlsTables':7}
 if type(value) is not dict or set(value)!=set(expected):raise FeedPgTrialError('Complete restore owner-only profile unavailable')
 for key,wanted in expected.items():
  if type(value[key]) is not type(wanted) or value[key]!=wanted:raise FeedPgTrialError('Complete restore owner-only profile unavailable')
 return value


class RestoredView:
 """Forward fixed experiment operations only through this same custodian."""
 def __init__(self,trial,target):
  if type(target) is not OwnedRestoreDatabase or target.trial is not trial or type(target.oid) is not int:
   raise FeedPgTrialError('Complete restore custodian mismatch')
  self.trial=trial;self.target=target
 @property
 def assertions(self):return self.trial.assertions
 def query(self,statement,**kwargs):
  if self.target.trial is not self.trial:raise FeedPgTrialError('Complete restore custodian mismatch')
  return self.target.query(statement,**kwargs)
 def check(self,label,value):return self.trial.check(label,value)
 def record(self,label,value):return self.trial.record(label,value)


def cases(trial):
 scope,binding,mapping,association=setup(trial);before=full_snapshot(trial);profile=validate_profile(access(trial.query))
 trial.check('closed_owner_only_five_schema_seven_table_twelve_invoker_profile',profile is not None)
 trial.inspect()
 args=['docker','exec',trial.identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--format=p','--no-owner']
 args.extend('--schema='+name for name in SCHEMAS)
 dump=trial.run(args,timeout=20)
 if dump.stderr or not 1<=len(dump.stdout)<=131072:raise FeedPgTrialError('Bounded complete-chain dump unavailable')
 trial.check('dump_keeps_acl_and_contains_no_role_database_creation',b'REVOKE ALL ON FUNCTION' in dump.stdout
  and not any(token in dump.stdout.upper() for token in [b'\nCREATE ROLE',b'\nALTER ROLE',b'\nCREATE DATABASE']))
 trial.record('COMPLETE_CHAIN_DUMP',{'bytes':len(dump.stdout),'sha256':sha256(dump.stdout).hexdigest(),'schemas':SCHEMAS,
  'ownerOnlyInvoker':True,'preservesACL':True,'sameMachineOnly':True})
 target=OwnedRestoreDatabase(trial);target.create()
 # One new composition-specific rollback: the fault follows all five schemas.
 failed=target.query(dump.stdout+b'\nselect 1/0;\n',single_transaction=True,allowed=True)
 trial.check('five_schema_restore_fault_refused',failed.returncode!=0 and b'division by zero' in failed.stderr)
 absent=target.query('select count(*) from pg_namespace where nspname in ('+','.join(_literal(name) for name in SCHEMAS)+');')
 trial.check('five_schema_fault_rolls_back_all_schemas',absent.stdout.strip()==b'0')
 target.query(dump.stdout,single_transaction=True);view=RestoredView(trial,target)
 trial.check('all_seven_restored_complete_row_arrays_exact',full_snapshot(view)==before)
 trial.check('all_restored_owners_invoker_acl_rls_exact',validate_profile(access(target.query))==profile)
 reopened,result,_,compiled=resumed(view,scope,binding,mapping,association)
 trial.check('restored_chain_reopens_actual_originals_and_complete_request',sha256(reopened.result_request.document_raw).hexdigest()==binding.content_sha256 and result.outcome_revision==1)
 trial.check('source_unchanged_after_complete_restored_read',full_snapshot(trial)==before)
 next_window=successor(view,scope,reopened.request.feed.capture);advanced,_=advance(view,next_window)
 trial.check('only_restored_collection_can_continue_window_two',advanced.window_revision==2)
 trial.check('source_all_rows_remain_exact_after_copy_continuation',full_snapshot(trial)==before)
 after=full_snapshot(view);trial.stop();trial.start()
 again,again_result,_,again_compiled=resumed(view,scope,binding,mapping,association)
 trial.check('restored_originals_request_and_artifact_survive_actual_restart',again.artifact_id==reopened.artifact_id
  and again.result_request.document_raw==reopened.result_request.document_raw and again_result==result and again_compiled==compiled)
 trial.check('continued_copy_all_rows_and_private_access_survive_restart',full_snapshot(view)==after and validate_profile(access(target.query))==profile)
 trial.check('original_source_still_exact_after_copy_restart',full_snapshot(trial)==before)
 return {'database':target.name,'oid':target.oid,'schemas':SCHEMAS,'tables':7,'functions':12,'restoredWindowRevision':2,
  'preknownOriginalRawUsedByRecovery':False,'offHostOrOperationalAcceptance':False}


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented complete restore trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_windows(trial);freeze_inventory(trial);freeze_reopen(trial);freeze_additional(trial);freeze_document_reopen(trial);freeze_complete_restore(trial);trial.create()
  trial.query("begin;set local statement_timeout='10s';"+''.join(trial.frozen[name].decode() for name in [WINDOW_FIXTURE,INVENTORY_FIXTURE,REOPEN_FIXTURE,DOCUMENT_FIXTURE,DOCUMENT_REOPEN_FIXTURE])+'commit;')
  identities=cases(trial);trial.record('COMPLETE_CHAIN_RESTORE_RESULT',{'state':'PASS_INVENTED_COMPLETE_CHAIN_RESTORE','assertions':trial.assertions,'assertionCount':len(trial.assertions),'identities':identities,'primaryChanged':False})
 except BaseException as error:
  trial.record('COMPLETE_RESTORE_FAILED',{'type':type(error).__name__,'message':'invented_complete_restore_failed'});raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_COMPLETE_RESTORE')
  if trial.identity is not None:trial.record('COMPLETE_RESTORE_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_COMPLETE_CHAIN_RESTORE','primaryChanged':False}))

if __name__=='__main__':main()
