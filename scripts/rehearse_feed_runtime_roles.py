"""Fresh-only restricted NOLOGIN role laboratory; never primary/login setup.

Reuses the unchanged owned-target custodian. SET SESSION AUTHORIZATION tests privileges, not
connection authentication. The originally superuser-authenticated harness can
reset session authorization; this is not arbitrary-SQL containment. Only the three fixed roles below can be selected;
all SQL is invented, frozen and retained. No password, login or role membership.
"""
from __future__ import annotations
import ast
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, FeedPgTrialError, seed, rss, entry, capture_context
from scripts.rehearse_invented_document_results import freeze_additional, result_request
from workers.document_result_contract import parse_stored_invented_document_result, invented_document_result_read_statement
from workers.feed_postgres_contract import committed_pg_json, parse_invented_pg_readback, invented_pg_read_statement
from workers.pair_native_sql import _literal

ROOT = Path(__file__).resolve().parents[1]
ROLES = ('tf_feed_lab_owner', 'tf_feed_lab_writer', 'tf_feed_lab_observer')
RUNTIME_FIXTURE = 'tests/fixtures/invented_feed_runtime_roles.sql'


def freeze_runtime(trial):
    names = {'scripts/rehearse_feed_runtime_roles.py', RUNTIME_FIXTURE}
    for name in sorted(names):
        raw = (ROOT/name).read_bytes()
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(raw)):
                if isinstance(node, ast.ImportFrom) and node.module:
                    child = node.module.replace('.', '/')+'.py'
                    if (ROOT/child).is_file() and child not in trial.frozen:
                        raise FeedPgTrialError('Runtime role dependency not frozen')
        destination = trial.proof/'inputs'/name
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with destination.open('xb') as stream: stream.write(raw)
        destination.chmod(0o600); trial.frozen[name] = raw
        row = {'path': name, 'bytes': len(raw), 'sha256': sha256(raw).hexdigest()}
        trial.source_bindings.append(row)
    trial.record('RUNTIME_SOURCE_BINDINGS', [row for row in trial.source_bindings if row['path'] in names])
    trial.record('RUNTIME_ROLE_INTENT', {'roles': ROLES, 'newOwnedClusterOnly': True,
        'noLogin': True, 'passwordsCreated': False, 'membershipsCreated': False,
        'authenticationAccepted': False, 'operationalPrivilegesChanged': False})


def role_snapshot(trial):
    # Password *presence* only; never return or log a credential/hash value.
    sql = """select jsonb_build_object('roles',(select jsonb_agg(jsonb_build_object(
      'oid',oid::bigint,'name',rolname,'login',rolcanlogin,'super',rolsuper,'createdb',rolcreatedb,
      'createrole',rolcreaterole,'inherit',rolinherit,'replication',rolreplication,'bypass',rolbypassrls,
      'noPassword',rolpassword is null) order by rolname) from pg_authid
      where rolname in ('tf_feed_lab_owner','tf_feed_lab_writer','tf_feed_lab_observer')),
      'memberships',(select count(*) from pg_auth_members where roleid in
       (select oid from pg_roles where rolname in ('tf_feed_lab_owner','tf_feed_lab_writer','tf_feed_lab_observer'))
       or member in (select oid from pg_roles where rolname in ('tf_feed_lab_owner','tf_feed_lab_writer','tf_feed_lab_observer'))));"""
    return json.loads(trial.query(sql).stdout)


class OwnedRuntimeRoles:
    def __init__(self, trial):
        self.trial = trial; self.bound = None

    def install(self):
        if self.bound is not None: raise FeedPgTrialError('Runtime roles already bound')
        before = role_snapshot(self.trial)
        if before != {'roles': None, 'memberships': 0}:
            raise FeedPgTrialError('New runtime role absence unconfirmed')
        fixture = self.trial.frozen[RUNTIME_FIXTURE].decode('utf8')
        self.trial.query("begin;set local statement_timeout='10s';"+fixture+'commit;')
        observed = role_snapshot(self.trial)
        self._validate(observed); self.bound = observed
        self.trial.record('RUNTIME_ROLES_BOUND', observed)

    def _validate(self, observed):
        if type(observed) is not dict or set(observed) != {'roles', 'memberships'} or type(observed['memberships']) is not int or observed['memberships'] != 0:
            raise FeedPgTrialError('Runtime role identity invalid')
        rows = observed['roles']
        if type(rows) is not list or len(rows) != 3 or any(type(r) is not dict for r in rows) or [r.get('name') for r in rows] != sorted(ROLES):
            raise FeedPgTrialError('Runtime role identity invalid')
        for row in rows:
            if (set(row) != {'oid', 'name', 'login', 'super', 'createdb', 'createrole', 'inherit', 'replication', 'bypass', 'noPassword'}
                    or type(row['oid']) is not int or row['oid'] <= 0 or row['noPassword'] is not True
                    or any(row[key] is not False for key in ('login', 'super', 'createdb', 'createrole', 'inherit', 'replication', 'bypass'))):
                raise FeedPgTrialError('Runtime role identity invalid')
        if len({row['oid'] for row in rows}) != 3:
            raise FeedPgTrialError('Runtime role identity invalid')
        if self.bound is not None and observed != self.bound:
            raise FeedPgTrialError('Runtime role identity changed')

    def verify(self):
        if self.bound is None: raise FeedPgTrialError('Runtime role identity not bound')
        self._validate(role_snapshot(self.trial))

    def query(self, role, statement, *, allowed=False):
        if type(role) is not str or role not in ('tf_feed_lab_writer', 'tf_feed_lab_observer'):
            raise FeedPgTrialError('Only fixed restricted invented runtime roles allowed')
        if type(statement) is not str or not statement:
            raise FeedPgTrialError('Runtime statement unavailable')
        self.verify()
        # A new psql process always starts as the verified owned administrator;
        # the simulated session identity constrains ordinary role/ACL checks.
        # RESET SESSION AUTHORIZATION can return to the original superuser, so
        # this never proves authentication or arbitrary-SQL containment.
        output = self.trial.query('set session authorization '+role+';'+statement, allowed=allowed)
        self.verify()
        return output


def api(statement):
    # Rewrite only the first generated SELECT function identifier, before its
    # literal arguments. Source text inside JSON/SQL literals stays exact.
    if type(statement) is not str:
        raise FeedPgTrialError('Typed generated API statement unavailable')
    before, separator, after = statement.partition('select tf_feed_rehearsal.')
    if separator and any(after.startswith(name+'(') for name in
            ('capture', 'complete_document_result', 'page_receipt', 'document_result_receipt')):
        return before+'select tf_feed_runtime.'+after
    raise FeedPgTrialError('Typed generated API statement unavailable')


def access_snapshot(trial):
    return json.loads(trial.query("""select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
       'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
       'writer',has_function_privilege('tf_feed_lab_writer',p.oid,'EXECUTE'),
       'observer',has_function_privilege('tf_feed_lab_observer',p.oid,'EXECUTE'),
       'public',(select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0))
       order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('tf_feed_rehearsal','tf_feed_runtime')),
      'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
       'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
       'writer',has_table_privilege('tf_feed_lab_writer',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
       'observer',has_table_privilege('tf_feed_lab_observer',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
       'public',(select count(*) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0))
       order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('tf_feed_rehearsal','tf_feed_runtime') and c.relkind='r'),
      'defaultFunctionsPublic',(select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
       where d.defaclrole=(select oid from pg_roles where rolname='tf_feed_lab_owner')
        and d.defaclnamespace=0 and d.defaclobjtype='f' and a.grantee=0));""").stdout)


def check_access(trial, observed):
    functions = observed['functions']; tables = observed['tables']
    trial.check('all_six_tables_private_nonruntime_owner_and_rls', len(tables)==6 and all(
        row['owner']=='tf_feed_lab_owner' and row['rls'] is True and row['writer'] is False
        and row['observer'] is False and row['public']==0 for row in tables))
    trial.check('all_functions_fixed_search_path_owner_no_public', len(functions)==10 and all(
        row['owner']=='tf_feed_lab_owner' and row['config']==['search_path=pg_catalog, pg_temp']
        and row['public']==0 for row in functions))
    expected={'capture':(True,False),'complete_document_result':(True,False),
        'page_receipt':(True,True),'document_result_receipt':(True,True),'require_stream':(False,False)}
    trial.check('only_four_outer_functions_definer_and_intended_execute_grants', all(
        (row['definer'],row['writer'],row['observer']) ==
        ((row['name']!='require_stream',*expected[row['name']]) if row['schema']=='tf_feed_runtime' else (False,False,False))
        for row in functions))
    trial.check('new_owner_future_function_default_not_public',observed['defaultFunctionsPublic']==0)


def snapshot_data(trial):
    return json.loads(trial.query("""begin isolation level repeatable read read only;select jsonb_build_object(
      'streams',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from tf_feed_rehearsal.streams t),
      'pages',(select coalesce(jsonb_agg(to_jsonb(t) order by operation_id),'[]'::jsonb) from tf_feed_rehearsal.pages t),
      'items',(select coalesce(jsonb_agg(to_jsonb(t) order by item_id),'[]'::jsonb) from tf_feed_rehearsal.items t),
      'outcomes',(select coalesce(jsonb_agg(to_jsonb(t) order by operation_id),'[]'::jsonb) from tf_feed_rehearsal.outcomes t),
      'results',(select coalesce(jsonb_agg(to_jsonb(t) order by operation_id),'[]'::jsonb) from tf_feed_rehearsal.document_results t),
      'scope',(select coalesce(jsonb_agg(to_jsonb(t) order by stream_id),'[]'::jsonb) from tf_feed_runtime.allowed_streams t));commit;""").stdout)


def denied(trial, roles, label, statement, role='tf_feed_lab_writer'):
    before = snapshot_data(trial)
    result = roles.query(role, statement, allowed=True)
    trial.check(label+'_permission_denied', result.returncode != 0 and any(message in result.stderr.lower()
        for message in (b'permission denied', b'must be owner')))
    trial.check(label+'_data_unchanged', snapshot_data(trial) == before)


def cases(trial):
    allowed_stream = seed(trial); denied_stream = seed(trial)
    foreign = capture_context(rss(entry('foreign-document', 'https://example.org/invented-document.txt')), denied_stream)
    foreign_out = trial.query(foreign.statement())
    foreign_page = committed_pg_json(foreign_out.stdout, foreign_out.stderr, foreign_out.returncode)
    foreign_request = result_request(trial, feed=foreign, page_raw=foreign_page)
    foreign_stored = trial.query(foreign_request.statement())
    committed_pg_json(foreign_stored.stdout, foreign_stored.stderr, foreign_stored.returncode)
    roles = OwnedRuntimeRoles(trial); roles.install()
    access = access_snapshot(trial); trial.record('RUNTIME_ACCESS_BEFORE',access); check_access(trial,access)
    trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(allowed_stream)+'::uuid);')
    actual = roles.query('tf_feed_lab_writer', "select jsonb_build_object('current',current_user,'session',session_user);")
    trial.check('simulated_session_is_restricted_nonowner', json.loads(actual.stdout) == {'current':'tf_feed_lab_writer','session':'tf_feed_lab_writer'})
    # First real capture goes through the restricted writer, not an owner call.
    context = capture_context(rss(entry('document-lead', 'https://example.org/invented-document.txt')+entry('rollback-lead', 'https://example.org/invented-document.txt')), allowed_stream)
    out = roles.query('tf_feed_lab_writer', api(context.statement()))
    page_raw = committed_pg_json(out.stdout, out.stderr, out.returncode)
    page = parse_invented_pg_readback(page_raw, context, observed_at=datetime.now(timezone.utc))
    trial.check('restricted_capture_committed', len(page.items) == 2 and page.cursor.revision == 1)
    repeated = roles.query('tf_feed_lab_writer', api(context.statement()))
    trial.check('restricted_capture_exact_retry', committed_pg_json(repeated.stdout,repeated.stderr,repeated.returncode) == page_raw)
    request = result_request(trial, feed=context, page_raw=page_raw)
    out = roles.query('tf_feed_lab_writer', api(request.statement()))
    result_raw = committed_pg_json(out.stdout,out.stderr,out.returncode)
    stored = parse_stored_invented_document_result(result_raw,request,observed_at=datetime.now(timezone.utc))
    trial.check('restricted_atomic_document_result', stored.outcome_revision == 1)
    observed = roles.query('tf_feed_lab_observer', api(invented_document_result_read_statement(request)))
    trial.check('observer_exact_original_result_read', committed_pg_json(observed.stdout,observed.stderr,observed.returncode) == result_raw)
    observed = roles.query('tf_feed_lab_observer', api(invented_pg_read_statement(context)))
    trial.check('observer_exact_page_read', committed_pg_json(observed.stdout,observed.stderr,observed.returncode) == page_raw)
    pending = result_request(trial, feed=context, page_raw=page_raw, item_index=1)
    before = snapshot_data(trial)
    trial.query('alter table tf_feed_rehearsal.document_results add constraint trial_role_result_denied check(false) not valid;')
    failed = roles.query('tf_feed_lab_writer',api(pending.statement()),allowed=True)
    trial.check('restricted_result_failure_refuses',failed.returncode != 0 and b'trial_role_result_denied' in failed.stderr)
    trial.check('restricted_result_failure_atomic',snapshot_data(trial) == before)
    trial.query('alter table tf_feed_rehearsal.document_results drop constraint trial_role_result_denied;')
    retried = roles.query('tf_feed_lab_writer',api(pending.statement()))
    retry_raw = committed_pg_json(retried.stdout,retried.stderr,retried.returncode)
    retried_value = parse_stored_invented_document_result(retry_raw,pending,observed_at=datetime.now(timezone.utc))
    trial.check('restricted_result_retry_committed_once',retried_value.outcome_revision == 1)
    # Every write denial compares complete relevant rows, not only counts.
    for table in ('streams','pages','items','outcomes','document_results'):
        denied(trial,roles,'no_direct_select_'+table,'select * from tf_feed_rehearsal.'+table+';')
        denied(trial,roles,'no_direct_delete_'+table,'delete from tf_feed_rehearsal.'+table+';')
        denied(trial,roles,'no_direct_update_'+table,'update tf_feed_rehearsal.'+table+' set '+('revision=revision' if table in ('streams','pages','outcomes') else 'item_id=item_id' if table=='items' else 'raw=raw')+';')
    denied(trial,roles,'no_scope_edit','delete from tf_feed_runtime.allowed_streams;')
    denied(trial,roles,'no_helper_call',"select tf_feed_rehearsal.record_outcome(gen_random_uuid(),"+_literal(request.association.feed_item_id)+"::uuid,1,'processed');")
    denied(trial,roles,'no_owner_escalation','set role tf_feed_lab_owner;')
    denied(trial,roles,'no_role_creation','create role tf_unexpected_role nologin;')
    denied(trial,roles,'no_schema_create','create table tf_feed_runtime.attacker(id integer);')
    denied(trial,roles,'no_function_replacement',"create or replace function tf_feed_runtime.capture(p jsonb) returns jsonb language sql as 'select null::jsonb';")
    denied(trial,roles,'observer_no_capture',api(context.statement()),'tf_feed_lab_observer')
    denied(trial,roles,'observer_no_result',api(request.statement()),'tf_feed_lab_observer')
    # This stream exists, but was never assigned to the internal writer scope.
    before = snapshot_data(trial)
    refused = roles.query('tf_feed_lab_writer', api(foreign.statement()), allowed=True)
    trial.check('unassigned_stream_refused', refused.returncode != 0 and b'invented_runtime_scope_denied' in refused.stderr)
    trial.check('unassigned_stream_unchanged', snapshot_data(trial) == before)
    for label,sql,role in [
        ('foreign_page_read',invented_pg_read_statement(foreign),'tf_feed_lab_observer'),
        ('foreign_result_read',invented_document_result_read_statement(foreign_request),'tf_feed_lab_observer'),
        ('foreign_result_replay',foreign_request.statement(),'tf_feed_lab_writer')]:
        refused = roles.query(role,api(sql),allowed=True)
        trial.check(label+'_scope_denied',refused.returncode != 0 and b'invented_runtime_scope_denied' in refused.stderr)
        trial.check(label+'_unchanged',snapshot_data(trial) == before)
    # A hostile session search path and temp relation cannot replace any private
    # relation used by the fixed-path DEFINER API and qualified INVOKER helpers.
    sql = "create temp table pages(operation_id uuid,raw bytea);set search_path=pg_temp,public;"+api(invented_pg_read_statement(context))
    out = roles.query('tf_feed_lab_observer', sql)
    trial.check('temporary_shadow_cannot_replace_receipt',committed_pg_json(out.stdout,out.stderr,out.returncode) == page_raw)
    trial.stop(); trial.start(); roles.verify()
    out = roles.query('tf_feed_lab_observer',api(invented_document_result_read_statement(request)))
    trial.check('restricted_read_and_roles_survive_restart',committed_pg_json(out.stdout,out.stderr,out.returncode) == result_raw)
    trial.record('RUNTIME_ROLES_FINAL',role_snapshot(trial))
    final_access = access_snapshot(trial); trial.record('RUNTIME_ACCESS_FINAL',final_access)
    trial.check('all_grants_owners_rls_paths_unchanged_after_restart',final_access==access)
    return {'allowedStreamId':allowed_stream,'deniedStreamId':denied_stream,'operationId':request.operation_id,
        'artifactId':stored.artifact_id,'loginAuthenticationAccepted':False,'originalSessionAuthenticatedAsSuperuser':True,'arbitrarySqlContainmentAccepted':False,'ownerRlsBypassIntentional':True,
        'sourceOrRightsIssued':False,'publicOrTenantAccessAccepted':False,'restrictedLabPrivilegesOnly':True}


def main():
    if sys.argv[1:]: raise FeedPgTrialError('Fixed invented role trial takes no arguments')
    os.umask(0o077); trial = FreshFeedPostgres()
    try:
        freeze_additional(trial); freeze_runtime(trial); trial.create()
        trial.query("begin;set local statement_timeout='10s';"+trial.frozen['tests/fixtures/invented_document_results.sql'].decode('utf8')+'commit;')
        result = cases(trial)
        trial.record('RUNTIME_ROLE_RESULT', {'state':'PASS_INVENTED_RUNTIME_PRIVILEGES','assertions':trial.assertions,
            'identities':result,'primaryChanged':False,'passwordsCreated':False,'sourceRequests':0,'modelCalls':0,'publicationEnabled':False})
    except BaseException as failure:
        trial.record('RUNTIME_ROLE_FAILURE', {'state':'held','exceptionClass':type(failure).__name__,'evidenceRetained':True})
        raise
    finally:
        try: trial.stop()
        finally:
            try: trial.stop_initializer()
            finally: trial.verify_sources('FINAL_RUNTIME')
        if trial.identity is not None: trial.record('RUNTIME_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_INVENTED_RUNTIME_PRIVILEGES','primaryChanged':False}))


if __name__ == '__main__': main()
