"""Fresh owner-only exact extraction artifact custody; zero provider execution.

A separate private invented namespace links two existing immutable document
results. It does not write the held issue-proposal table, item outcomes, budgets,
source rights or public data. NOLOGIN admin simulation is not authentication.
"""
from __future__ import annotations
import ast
from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, FeedPgTrialError
from scripts.rehearse_stream_reader import freeze_all, _acl, _same
from scripts.rehearse_reopened_change import freeze_change, prepare
from scripts.rehearse_document_reference import freeze_reference, install_reference, reference_profile
from scripts.rehearse_stream_reader_restore import private_defaults
from scripts.rehearse_collection_reader import snapshot, read
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from scripts.rehearse_retained_document_reader import RestrictedPort
from workers.feed_collection_inventory import prepare_inventory_request
from workers.retained_document_reader import read_retained_document
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request
from workers.private_extraction_result import prepare_private_extraction_result
from workers.private_extraction_postgres import (prepare_private_extraction_store,
    private_extraction_read_statement, parse_stored_private_extraction_result)
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER, committed_pg_json
from workers.pair_native_sql import _literal
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = 'tests/fixtures/invented_private_extraction.sql'


def freeze_private(trial):
    names = {FIXTURE, 'scripts/rehearse_private_extraction.py', 'workers/private_extraction_result.py',
        'workers/private_extraction_postgres.py'}; queue = list(names)
    while queue:
        name = queue.pop()
        if not name.endswith('.py'): continue
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node, ast.ImportFrom) and node.module:
                child = node.module.replace('.', '/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():
                    names.add(child); queue.append(child)
    rows = []
    for name in sorted(names):
        raw = (ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name] != raw: raise FeedPgTrialError('Private extraction dependency changed')
            continue
        path = trial.proof/'inputs'/name; path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('xb') as stream: stream.write(raw)
        path.chmod(0o600); trial.frozen[name] = raw
        row = dict(path=name, bytes=len(raw), sha256=sha256(raw).hexdigest())
        rows.append(row); trial.source_bindings.append(row)
    trial.record('PRIVATE_EXTRACTION_SOURCE_BINDINGS', rows)
    trial.record('PRIVATE_EXTRACTION_SCOPE', dict(newPrivateNamespaceOnly=True, ownerOnly=True,
        mandatoryConfirmedPair=True, suppliedInventedOutput=True, providerExecutionObserved=False,
        actualUsageObserved=False, actualCostObserved=False, newRuntimeGrants=0, modelCalls=0,
        sourceRequests=0, publication=False, primaryChanged=False, laboratoryRowMaximum=50))


def install_private(trial, roles):
    if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:
        raise FeedPgTrialError('Private extraction custodian mismatch')
    roles.verify()
    trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode('utf8')+'commit;')
    roles.verify()


def owner_query(trial, roles, sql, *, allowed=False):
    if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:
        raise FeedPgTrialError('Private extraction custodian mismatch')
    roles.verify()
    result = trial.query('set session authorization tf_feed_lab_owner;'+sql, allowed=allowed)
    roles.verify()
    return result


def private_snapshot(query):
    return json.loads(query("begin isolation level repeatable read read only;select jsonb_build_object('rows',jsonb_array_length(body),'bytes',octet_length(body::text),'sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from (select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]'::jsonb) body from tf_private_extraction.results r) scope;commit;").stdout)


def private_profile(query):
    value = json.loads(query("""begin isolation level repeatable read read only;select jsonb_build_object(
 'schema',(select jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',
  (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) from pg_namespace n where n.nspname='tf_private_extraction'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',
  (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tf_private_extraction' and c.relkind='r'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'acl',
  (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tf_private_extraction'),
 'constraints',(select jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) order by c.conname) from pg_constraint c where c.conrelid='tf_private_extraction.results'::regclass),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,'function',n.nspname||'.'||p.proname) order by t.tgname) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='tf_private_extraction.results'::regclass and not t.tgisinternal));commit;""").stdout)
    if not _same(value['schema'], dict(owner='tf_feed_lab_owner', acl=_acl(['CREATE', 'USAGE']))):
        raise FeedPgTrialError('Private extraction schema profile unavailable')
    if not _same(value['tables'], [dict(name='results', owner='tf_feed_lab_owner', rls=True,
            acl=_acl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']))]):
        raise FeedPgTrialError('Private extraction table profile unavailable')
    if [row['name'] for row in value['functions']] != ['refuse_mutation', 'result_receipt', 'store_result']:
        raise FeedPgTrialError('Private extraction function scope unavailable')
    for row in value['functions']:
        if not _same({key: val for key, val in row.items() if key not in ('name','definitionSha256')},
                dict(owner='tf_feed_lab_owner', definer=False, path=['search_path=pg_catalog'], acl=_acl(['EXECUTE']))):
            raise FeedPgTrialError('Private extraction function profile unavailable')
    if not _same(value['triggers'], [dict(name='private_extraction_append_only', enabled='O', type=27, function='tf_private_extraction.refuse_mutation')]):
        raise FeedPgTrialError('Private extraction append-only profile unavailable')
    fks = [row for row in value['constraints'] if row['type']=='f']
    if (len(fks) != 2 or not all(row['validated'] for row in value['constraints'])
            or not all('REFERENCES tf_feed_rehearsal.document_results(operation_id)' in row['definition'] for row in fks)):
        raise FeedPgTrialError('Private extraction document foreign keys unavailable')
    return value


def read_stored(trial, roles, request):
    output = owner_query(trial, roles, private_extraction_read_statement(request))
    raw = committed_pg_json(output.stdout, output.stderr, output.returncode)
    return parse_stored_private_extraction_result(raw, request, observed_at=datetime.now(timezone.utc)), raw


def refused(trial, roles, label, sql, *, needle, role=None):
    base = snapshot(trial); private = private_snapshot(trial.query)
    output = owner_query(trial, roles, sql, allowed=True) if role is None else roles.query(role, sql, allowed=True)
    trial.check(label+'_refused', output.returncode != 0 and needle in output.stderr.lower())
    trial.check(label+'_all_original_rows_unchanged', snapshot(trial) == base)
    trial.check(label+'_private_rows_unchanged', private_snapshot(trial.query) == private)


def raw_store(request, *, metadata=None, output=None, operation=None):
    p = json.loads(request.canonical_metadata) if metadata is None else metadata
    if operation is not None: p = {**p, 'operation_id': operation}
    raw = request.result.output_raw if output is None else output
    import base64
    return HEAD+"set time zone 'UTC';begin;select tf_private_extraction.store_result("+_literal(json.dumps(p,separators=(',',':'),ensure_ascii=False))+"::jsonb,decode("+_literal(base64.b64encode(request.result.request.body).decode())+",'base64'),decode("+_literal(base64.b64encode(raw).decode())+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def prepare_pair(trial):
    roles, scope, expectations = prepare(trial); install_reference(trial, roles)
    inventory = prepare_inventory_request(scope, item_limit=20); page, _ = read(roles, inventory)
    for stream in sorted({row.stream_id for row in page.rows}):
        trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(stream)+'::uuid);')
    trial.stop(); trial.start(); roles.verify()
    results = []
    for label, expectation in zip(('previous', 'current'), expectations[1:]):
        binding, mapping, association = expectation
        port = RestrictedPort(trial, roles, 'PRIVATE_EXTRACTION_'+label)
        result = read_retained_document(inventory, binding=binding, mapping=mapping,
            association=association, query=port, utc_now=lambda: datetime.now(timezone.utc))
        if result.query_count != 7 or result.reopened is None: raise FeedPgTrialError('Private extraction pair unavailable')
        results.append(result)
    previous, current = results
    return roles, current, previous


def cases(trial):
    roles, current, previous = prepare_pair(trial)
    base_access = reference_profile(trial.query); defaults = private_defaults(trial.query)
    install_private(trial, roles)
    access = private_profile(trial.query)
    trial.record('PRIVATE_EXTRACTION_INITIAL_ACCESS', access)
    trial.record('PRIVATE_EXTRACTION_INITIAL_BASE_ACCESS', base_access)
    trial.record('PRIVATE_EXTRACTION_INITIAL_DEFAULTS', defaults)
    before = snapshot(trial)
    trial.check('private_owner_has_no_database_create_privilege', json.loads(trial.query("select to_jsonb(has_database_privilege('tf_feed_lab_owner',current_database(),'CREATE'));").stdout) is False)
    pair = prepare_reopened_document_change(current.reopened, current.full_receipt,
        previous.reopened, previous.full_receipt, observed_at=datetime.now(timezone.utc))
    request = compile_extraction_request(pair.current, pair.previous,
        observed_at=datetime.now(timezone.utc), maximum_output_tokens=100)
    b = current.reopened.request.binding
    output = json.dumps(dict(schema_version=1, source_version_id=b.source_version_id, source_sha256=b.content_sha256,
        language_code=b.language_code, locator='section:one', proposed_claim_type='condition',
        proposed_assertion='Changed exact Å source passage.', source_date_text=None), ensure_ascii=False, separators=(',', ':')).encode('utf8')
    preparation = datetime.now(timezone.utc)
    args = dict(request=request, output_raw=output, operation_id=str(uuid4()), prepared_at=preparation, observed_at=preparation, maximum_output_tokens=100)
    def result_for(**changes):
        return prepare_private_extraction_result(current.reopened, current.full_receipt,
            previous.reopened, previous.full_receipt, **{**args, **changes})
    result = result_for(); expected = prepare_private_extraction_store(result)
    trial.record('PRIVATE_EXTRACTION_INTENT', dict(operationId=result.operation_id,
        requestBytes=len(request.body), requestSHA256=request.request_sha256,
        outputBytes=len(output), outputSHA256=sha256(output).hexdigest(),
        currentArtifact=current.stored.artifact_id, previousArtifact=previous.stored.artifact_id,
        reviewState=result.proposal.review_state, providerExecutionObserved=False,
        actualUsageObserved=False, actualCostObserved=False))
    # Retain the actual committed stdout in the custodian packet but deliberately
    # do not deliver/parse it as an application acknowledgement. Recovery reads
    # the existing operation; there is no provider request to resend.
    written = owner_query(trial, roles, expected.statement())
    trial.record('PRIVATE_EXTRACTION_ACK_WITHHELD_SIMULATION', dict(operationId=result.operation_id,
        stdoutBytes=len(written.stdout), stdoutSHA256=sha256(written.stdout).hexdigest(),
        applicationAcknowledgementDelivered=False, realNetworkLoss=False))
    stored, raw = read_stored(trial, roles, expected)
    trial.check('private_exact_request_output_recovered_without_acknowledgement', stored.operation_id == result.operation_id
        and result.proposal.review_state == 'unverified' and private_snapshot(trial.query)['rows'] == 1 and snapshot(trial) == before)
    first = private_snapshot(trial.query)
    repeated = owner_query(trial, roles, expected.statement())
    repeated_raw = committed_pg_json(repeated.stdout, repeated.stderr, repeated.returncode)
    repeated_stored = parse_stored_private_extraction_result(repeated_raw, expected, observed_at=datetime.now(timezone.utc))
    trial.check('private_exact_replay_same_artifact_time_bytes_no_duplicate', repeated_stored == stored and repeated_raw == raw
        and private_snapshot(trial.query) == first and snapshot(trial) == before)
    changed_output = json.loads(output); changed_output['proposed_assertion'] = 'Another unverified invented assertion.'
    conflict = prepare_private_extraction_store(result_for(output_raw=json.dumps(changed_output, separators=(',', ':')).encode('utf8')))
    refused(trial, roles, 'private_same_operation_different_valid_output', conflict.statement(), needle=b'invented_private_extraction_operation_conflict')
    metadata = json.loads(expected.canonical_metadata); metadata['current_document']['artifact_id'] = str(uuid4())
    refused(trial, roles, 'private_actual_current_document_artifact_mismatch', raw_store(expected, metadata=metadata, operation=str(uuid4())), needle=b'invented_private_extraction_document_mismatch')
    metadata = json.loads(expected.canonical_metadata); metadata['previous_document']['content_sha256'] = 'f'*64
    refused(trial, roles, 'private_actual_previous_document_hash_mismatch', raw_store(expected, metadata=metadata, operation=str(uuid4())), needle=b'invented_private_extraction_document_mismatch')
    metadata = json.loads(expected.canonical_metadata); metadata['request_sha256'] = 'f'*64
    refused(trial, roles, 'private_request_bytes_not_asserted_hash', raw_store(expected, metadata=metadata, operation=str(uuid4())), needle=b'invented_private_extraction_bytes_invalid')
    metadata = json.loads(expected.canonical_metadata); metadata['proposal']['review_state'] = 'approved'
    refused(trial, roles, 'private_output_cannot_become_approved', raw_store(expected, metadata=metadata, operation=str(uuid4())), needle=b'invented_private_extraction_request_output_invalid')
    for role in ('tf_feed_lab_writer', 'tf_feed_lab_observer'):
        refused(trial, roles, 'private_ungranted_'+role, private_extraction_read_statement(expected), role=role, needle=b'permission denied')
    refused(trial, roles, 'private_rows_append_only_update', 'update tf_private_extraction.results set stored_at=stored_at;', needle=b'invented_private_extraction_append_only')
    refused(trial, roles, 'private_rows_append_only_delete', 'delete from tf_private_extraction.results;', needle=b'invented_private_extraction_append_only')
    pending = prepare_private_extraction_store(result_for(operation_id=str(uuid4())))
    suffix='commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    statement=pending.statement()
    if not statement.endswith(suffix): raise FeedPgTrialError('Private transaction suffix unavailable')
    fault=statement[:-len(suffix)]+'select 1/0;'+suffix
    refused(trial, roles, 'private_insert_then_failure_atomic_rollback', fault, needle=b'division by zero')
    refused(trial, roles, 'private_rolled_back_artifact_absent', private_extraction_read_statement(pending), needle=b'invented_private_extraction_unavailable')
    trial.stop(); trial.start(); roles.verify()
    reopened, reopened_raw = read_stored(trial, roles, expected)
    trial.check('private_result_survives_actual_restart_full_bytes_exact', reopened == stored and reopened_raw == raw
        and private_snapshot(trial.query) == first and snapshot(trial) == before)
    # Fill only invented test artifacts through the same fixed function to
    # prove its finite50-row cap, not an actual provider/attempt budget policy.
    import base64
    p=json.loads(expected.canonical_metadata)
    fill="do $fill$ declare p jsonb:="+_literal(json.dumps(p,separators=(',',':'),ensure_ascii=False))+"::jsonb;i integer;begin for i in 1..49 loop perform tf_private_extraction.store_result(jsonb_set(p,'{operation_id}',to_jsonb(('60000000-0000-4000-8000-'||lpad(i::text,12,'0'))::text)),decode("+_literal(base64.b64encode(request.body).decode())+",'base64'),decode("+_literal(base64.b64encode(output).decode())+",'base64'));end loop;end $fill$;"
    owner_query(trial, roles, HEAD+'begin;'+fill+'commit;')
    full = private_snapshot(trial.query)
    trial.check('private_finite_laboratory_quota_filled_via_fixed_function', full['rows'] == 50 and snapshot(trial) == before)
    overflow = prepare_private_extraction_store(result_for(operation_id=str(uuid4())))
    refused(trial, roles, 'private_finite_laboratory_quota_refuses_new_operation', overflow.statement(), needle=b'invented_private_extraction_lab_quota')
    replay = owner_query(trial, roles, expected.statement()); replay_raw = committed_pg_json(replay.stdout, replay.stderr, replay.returncode)
    trial.check('private_exact_replay_still_allowed_at_full_laboratory_quota', replay_raw == raw and private_snapshot(trial.query) == full)
    trial.stop(); trial.start(); roles.verify()
    final, final_raw = read_stored(trial, roles, expected)
    trial.check('private_final_restart_all_fifty_rows_and_originals_exact', final == stored and final_raw == raw
        and private_snapshot(trial.query) == full and snapshot(trial) == before)
    final_access = private_profile(trial.query); final_base = reference_profile(trial.query); final_defaults = private_defaults(trial.query)
    trial.record('PRIVATE_EXTRACTION_FINAL_ACCESS', final_access)
    trial.record('PRIVATE_EXTRACTION_FINAL_BASE_ACCESS', final_base)
    trial.record('PRIVATE_EXTRACTION_FINAL_DEFAULTS', final_defaults)
    trial.check('private_owner_acl_rls_trigger_fks_defaults_and_base_profile_exact', final_access == access
        and final_base == base_access and final_defaults == defaults)
    return dict(operationId=result.operation_id, artifactId=stored.artifact_id,
        rows=50, actualUsageObserved=False, actualCostObserved=False, modelCalls=0,
        sourceRequests=0, heldIssueProposalRowsWritten=0, originalOutcomeRowsChanged=0, operationalAcceptance=False)


def main():
    if sys.argv[1:]: raise FeedPgTrialError('Fixed invented private extraction trial takes no arguments')
    os.umask(0o077); trial=FreshFeedPostgres()
    try:
        freeze_all(trial); freeze_change(trial); freeze_reference(trial); freeze_private(trial)
        trial.create(); scope=cases(trial)
        trial.record('PRIVATE_EXTRACTION_RESULT', dict(state='PASS_INVENTED_PRIVATE_EXTRACTION',
            assertions=trial.assertions, assertionCount=len(trial.assertions), scope=scope, primaryChanged=False))
    except BaseException as error:
        trial.record('PRIVATE_EXTRACTION_FAILED', dict(type=type(error).__name__, message='invented_private_extraction_failed'))
        raise
    finally:
        try: trial.stop()
        finally:
            try: trial.stop_initializer()
            finally: trial.verify_sources('FINAL_PRIVATE_EXTRACTION')
        if trial.identity is not None: trial.record('PRIVATE_EXTRACTION_FINAL_OWNED_STATE', trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof), assertions=len(trial.assertions),
        state='PASS_INVENTED_PRIVATE_EXTRACTION', primaryChanged=False)))


if __name__ == '__main__': main()
