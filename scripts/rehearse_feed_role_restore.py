"""Restore the invented restricted-role profile without promoting its owner.

Fresh cluster/database only; same cluster roles, NOLOGIN/no passwords. Unlike
an owner-only data trial, retain native owners, grants and default privileges.
The original administrator session is explicit; this is not login/SQL isolation,
actual host backup, off-host/NAS recovery or an operational migration.
"""
from __future__ import annotations
import ast
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys

from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, FeedPgTrialError, BIN, seed, rss, entry, capture_context
from scripts.rehearse_invented_document_results import freeze_additional, result_request
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase, freeze_recovery
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles, freeze_runtime, api, access_snapshot, RUNTIME_FIXTURE
from workers.document_result_contract import invented_document_result_read_statement, parse_stored_invented_document_result
from workers.feed_postgres_contract import committed_pg_json
from workers.pair_native_sql import _literal

ROOT = Path(__file__).resolve().parents[1]


def freeze_role_restore(trial):
    name = 'scripts/rehearse_feed_role_restore.py'; raw = (ROOT/name).read_bytes()
    for node in ast.walk(ast.parse(raw)):
        if isinstance(node, ast.ImportFrom) and node.module:
            child = node.module.replace('.', '/')+'.py'
            if (ROOT/child).is_file() and child not in trial.frozen:
                raise FeedPgTrialError('Role recovery dependency not frozen')
    destination = trial.proof/'inputs'/name
    with destination.open('xb') as stream: stream.write(raw)
    destination.chmod(0o600); trial.frozen[name] = raw
    row = {'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()}
    trial.source_bindings.append(row); trial.record('ROLE_RECOVERY_SOURCE_BINDINGS',[row])


def restored_role_port(source_profile, target):
    """Do not treat a role name or arbitrary target as a restored identity."""
    if (type(source_profile) is not OwnedRuntimeRoles or type(target) is not OwnedRestoreDatabase
            or target.trial is not source_profile.trial
            or type(target.oid) is not int or target.oid <= 0 or source_profile.bound is None):
        raise FeedPgTrialError('Owned role recovery scope unavailable')
    source_profile.verify()
    if target.current() is None: raise FeedPgTrialError('Owned role recovery database unavailable')
    restored = OwnedRuntimeRoles(target); restored.bound = deepcopy(source_profile.bound)
    restored.verify()
    return restored


def original(trial):
    stream = seed(trial); profile = OwnedRuntimeRoles(trial); profile.install()
    trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(stream)+'::uuid);')
    context = capture_context(rss(entry('restored-document','https://example.org/invented-document.txt')),stream)
    output = profile.query('tf_feed_lab_writer',api(context.statement()))
    page = committed_pg_json(output.stdout,output.stderr,output.returncode)
    request = result_request(trial,feed=context,page_raw=page)
    output = profile.query('tf_feed_lab_writer',api(request.statement()))
    raw = committed_pg_json(output.stdout,output.stderr,output.returncode)
    stored = parse_stored_invented_document_result(raw,request,observed_at=datetime.now(timezone.utc))
    return profile,request,stored,raw


def read_result(profile,request):
    output = profile.query('tf_feed_lab_observer',api(invented_document_result_read_statement(request)))
    raw = committed_pg_json(output.stdout,output.stderr,output.returncode)
    return parse_stored_invented_document_result(raw,request,observed_at=datetime.now(timezone.utc)),raw



def default_function_acl(query):
    # A missing explicit row means PostgreSQL's PUBLIC EXECUTE default, not an
    # empty ACL. Coalesce with acldefault instead of counting only stored rows.
    raw = query("""select jsonb_build_object(
      'explicitEntries',(select count(*) from pg_default_acl where defaclrole=
       (select oid from pg_roles where rolname='tf_feed_lab_owner') and defaclnamespace=0 and defaclobjtype='f'),
      'publicExecute',(select count(*) from aclexplode(coalesce(
       (select defaclacl from pg_default_acl where defaclrole=(select oid from pg_roles where rolname='tf_feed_lab_owner')
        and defaclnamespace=0 and defaclobjtype='f'),
       acldefault('f',(select oid from pg_roles where rolname='tf_feed_lab_owner')))) a
       where a.grantee=0 and a.privilege_type='EXECUTE'));""").stdout
    value = json.loads(raw)
    if (type(value) is not dict or set(value)!={'explicitEntries','publicExecute'}
            or any(type(v) is not int for v in value.values())
            or value!={'explicitEntries':1,'publicExecute':0}):
        raise FeedPgTrialError('Private future-function default ACL unavailable')
    return value


def cases(trial):
    source,request,stored,raw = original(trial)
    before_defaults = default_function_acl(trial.query); trial.record('ROLE_RECOVERY_DEFAULTS_SOURCE',before_defaults)
    before_access = access_snapshot(trial); trial.record('ROLE_RECOVERY_ACCESS_SOURCE',before_access)
    # Whole-database dump is permitted only after this new isolated database is
    # confirmed to contain exactly the two invented schemas and empty public.
    # A schema-filtered dump may omit the owner's global default ACL. --no-owner
    # would silently promote restored DEFINER ownership to the restore admin.
    scopes = json.loads(trial.query("""select jsonb_build_object(
      'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema'),
      'publicObjects',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
      'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('tf_feed_rehearsal','tf_feed_runtime') and c.relkind='r'));
    """).stdout)
    trial.check('whole_dump_scope_only_new_invented_data',scopes=={'schemas':['public','tf_feed_rehearsal','tf_feed_runtime'],'publicObjects':0,'tables':6})
    dump = trial.run(['docker','exec',trial.identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--format=p'],timeout=20)
    if dump.stderr or not 1<=len(dump.stdout)<=131072: raise FeedPgTrialError('Bounded role-preserving dump unavailable')
    trial.check('dump_retains_owners_acl_and_default_function_privileges',all(text in dump.stdout for text in
        (b'OWNER TO tf_feed_lab_owner',b'ALTER DEFAULT PRIVILEGES FOR ROLE tf_feed_lab_owner',b'REVOKE ALL ON FUNCTIONS',b'FROM PUBLIC')))
    trial.check('dump_creates_no_database_roles_or_login',not any(text in dump.stdout.upper() for text in
        (b'\nCREATE ROLE',b'\nCREATE DATABASE',b'\nALTER ROLE',b'PASSWORD ')))
    trial.record('ROLE_PRESERVING_DUMP',{'bytes':len(dump.stdout),'sha256':sha256(dump.stdout).hexdigest(),
        'preservesOwners':True,'preservesPrivileges':True,'preservesDefaultPrivileges':True,
        'wholeNewInventedDatabaseOnly':True,'sameClusterRolesOnly':True})
    target = OwnedRestoreDatabase(trial); target.create()
    failed = target.query(dump.stdout+b'\nselect 1/0;\n',single_transaction=True,allowed=True)
    trial.check('role_preserving_restore_failure_refuses',failed.returncode!=0 and b'division by zero' in failed.stderr)
    absent = target.query("select count(*) from pg_namespace where nspname in ('tf_feed_rehearsal','tf_feed_runtime');")
    trial.check('both_schemas_absent_after_failed_restore',absent.stdout.strip()==b'0')
    target.query(dump.stdout,single_transaction=True)
    restored = restored_role_port(source,target)
    restored_defaults = default_function_acl(target.query); trial.record('ROLE_RECOVERY_DEFAULTS_RESTORED',restored_defaults)
    trial.check('explicit_private_future_function_default_restored',restored_defaults==before_defaults)
    recovered,recovered_raw = read_result(restored,request)
    trial.check('restored_restricted_receipt_exact',recovered==stored and recovered_raw==raw)
    restored_access = access_snapshot(target); trial.record('ROLE_RECOVERY_ACCESS_RESTORED',restored_access)
    trial.check('restored_owners_acl_rls_paths_and_defaults_exact',restored_access==before_access)
    # Exact retry still passes through the restored restricted writer function.
    retried = restored.query('tf_feed_lab_writer',api(request.statement()))
    trial.check('restored_restricted_retry_one_identical_effect',committed_pg_json(retried.stdout,retried.stderr,retried.returncode)==raw)
    for role,sql in [('tf_feed_lab_writer','delete from tf_feed_rehearsal.document_results;'),
                     ('tf_feed_lab_observer',api(request.statement()))]:
        output = restored.query(role,sql,allowed=True)
        trial.check('restored_'+role+'_mutation_denied',output.returncode!=0 and b'permission denied' in output.stderr.lower())
        _,after_raw = read_result(restored,request)
        trial.check('restored_'+role+'_receipt_unmodified',after_raw==raw)
    # Source and target are distinct owned DBs with shared unchanged cluster
    # role identities. The copy cannot mutate the source's stored result.
    _,source_raw = read_result(source,request)
    trial.check('original_database_receipt_unmodified',source_raw==raw)
    trial.stop(); trial.start()
    restored.verify(); source.verify()
    final,final_raw = read_result(restored,request)
    trial.check('restored_restricted_result_after_real_restart',final==stored and final_raw==raw)
    trial.check('restored_access_defaults_after_real_restart',access_snapshot(target)==before_access and default_function_acl(target.query)==before_defaults)
    trial.record('ROLE_RECOVERY_FINAL_DATABASE',target.current())
    return {'restoreDatabaseName':target.name,'restoreDatabaseOID':target.oid,'operationId':request.operation_id,
        'sameClusterRoleOIDs':True,'loginAuthenticationAccepted':False,'arbitrarySqlContainmentAccepted':False,
        'offHostNasOrPowerLossAccepted':False,'operationalRolesChanged':False,'newInventedRolesOnly':True}


def main():
    if sys.argv[1:]: raise FeedPgTrialError('Fixed role-preserving restore takes no arguments')
    os.umask(0o077); trial = FreshFeedPostgres()
    try:
        freeze_additional(trial); freeze_recovery(trial); freeze_runtime(trial); freeze_role_restore(trial); trial.create()
        trial.query("begin;set local statement_timeout='10s';"+trial.frozen['tests/fixtures/invented_document_results.sql'].decode('utf8')+'commit;')
        result = cases(trial)
        trial.record('ROLE_RECOVERY_RESULT',{'state':'PASS_INVENTED_ROLE_PRESERVING_RESTORE','assertions':trial.assertions,
            'identities':result,'primaryChanged':False,'passwordsCreated':False,'sourceRequests':0,'modelCalls':0,'publicationEnabled':False})
    except BaseException as failure:
        trial.record('ROLE_RECOVERY_FAILURE',{'state':'held','exceptionClass':type(failure).__name__,'evidenceRetained':True})
        raise
    finally:
        try: trial.stop()
        finally:
            try: trial.stop_initializer()
            finally: trial.verify_sources('FINAL_ROLE_RECOVERY')
        if trial.identity is not None: trial.record('ROLE_RECOVERY_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_ROLE_PRESERVING_RESTORE','primaryChanged':False}))


if __name__=='__main__':main()
