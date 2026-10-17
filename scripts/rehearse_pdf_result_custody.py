"""Manual one-table PDF-result custody in a new isolated PostgreSQL17 cluster.

No existing target, primary connection, login, network, provider or publication.
The small native port stores supplied bytes, not approved evidence. Full expected
intent stays separately retained and mandatory for every Python cold reopening.
"""
from __future__ import annotations
import ast
import base64
from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
import re
import sys
from uuid import uuid4

from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, FeedPgTrialError, ROOT, BIN
from scripts.offline_pdf_result_review import _decode
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER, committed_pg_json
from workers.pair_native_sql import _literal
from workers.passage_extraction_request import _canonical
from workers.pdf_result_custody import (
    prepare_pdf_result_custody, pdf_result_custody_read_statement, reopen_pdf_result_custody,
)

ENTRY = 'scripts/rehearse_pdf_result_custody.py'
FIXTURE = 'fixtures/fictional-pdf-result-review-input.json'
SCHEMA = 'tests/fixtures/invented_pdf_result_custody.sql'
NEW_FILES = (ENTRY, FIXTURE, SCHEMA, 'workers/pdf_result_custody.py',
             'tests/test_pdf_result_custody.py', 'tests/test_pdf_custody_lifecycle.py')


def freeze_pdf_sources(trial):
    if trial.counter or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError('PDF freeze must precede resource commands')
    pending = list(NEW_FILES); names = set(pending)
    while pending:
        name = pending.pop(); raw = (ROOT / name).read_bytes()
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(raw)):
                modules = ([node.module] if isinstance(node, ast.ImportFrom) and node.module else
                           [v.name for v in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    child = module.replace('.', '/') + '.py'
                    if (ROOT / child).is_file() and child not in names:
                        names.add(child); pending.append(child)
    rows = []
    for name in sorted(names):
        raw = (ROOT / name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name] != raw: raise FeedPgTrialError('PDF source changed')
            continue
        target = trial.proof / 'inputs' / name; target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open('xb') as stream: stream.write(raw)
        target.chmod(0o600); trial.frozen[name] = raw
        rows.append(dict(path=name, bytes=len(raw), sha256=sha256(raw).hexdigest()))
    trial.source_bindings.extend(rows); trial.record('PDF_SOURCE_BINDINGS', rows)


class FreshPdfResultPostgres(FreshFeedPostgres):
    """Reuse lifecycle and pipe bounds; install only the fixed PDF lab schema."""
    def __init__(self):
        super().__init__()
        freeze_pdf_sources(self)

    def bootstrap_schema(self):
        fixture = self.frozen[SCHEMA].decode('utf8')
        self.query("begin;set local statement_timeout='10s';set local lock_timeout='1s';" + fixture + 'commit;')


def committed(trial, statement):
    result = trial.query(statement)
    return committed_pg_json(result.stdout, result.stderr, result.returncode)


def matches_native_refusal(stderr, expected_state, expected_message):
    if type(stderr) is not bytes or not 1 <= len(stderr) <= 4096:
        return False
    try:
        lines = re.findall(r'^ERROR:\s+([0-9A-Z]{5}): ([^\r\n]*)$', stderr.decode('utf8'), re.MULTILINE)
    except UnicodeError:
        return False
    return lines == [(expected_state, expected_message)]


def direct(intent, packet):
    # Deliberately used by the native negative cases, never a user-chosen SQL port.
    parts = ','.join('decode(' + _literal(base64.b64encode(raw).decode('ascii')) + ",'base64')" for raw in (intent, packet))
    statement = HEAD + "set time zone 'UTC';begin isolation level read committed read write;select tf_pdf_result_rehearsal.store_result(" + parts + ");commit;\n\\echo " + COMMIT_MARKER.decode() + '\n'
    if len(statement.encode()) > 294912: raise FeedPgTrialError('PDF native statement limit')
    return statement


def variant(packet, expected, *, operation=None, assertion=None):
    value = json.loads(packet)
    if operation is not None: value['operation_id'] = operation
    output_sha = expected.output_sha256
    if assertion is not None:
        output = json.loads(base64.b64decode(value['output']['base64']))
        output['proposed_assertion'] = assertion
        raw = _canonical(output); output_sha = sha256(raw).hexdigest()
        value['output'] = dict(base64=base64.b64encode(raw).decode('ascii'), bytes=len(raw), sha256=output_sha)
    raw = _canonical(value)
    return raw, replace(expected, operation_id=expected.operation_id if operation is None else operation,
                        output_sha256=output_sha, packet_sha256=sha256(raw).hexdigest())


def fingerprint(trial):
    sql = "begin isolation level repeatable read read only;select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'stored_at',stored_at,'intent_sha256',encode(sha256(intent),'hex'),'packet_sha256',encode(sha256(packet),'hex')) order by operation_id),'[]'::jsonb) from tf_pdf_result_rehearsal.results;commit;"
    return json.loads(trial.query(sql).stdout)


def profile(trial):
    sql = """begin isolation level repeatable read read only;
select jsonb_build_object(
 'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname!~'^pg_' and nspname not in('public','information_schema')),
 'schema_owner',(select pg_get_userbyid(nspowner) from pg_namespace where nspname='tf_pdf_result_rehearsal'),
 'table_owner',(select pg_get_userbyid(relowner) from pg_class where oid='tf_pdf_result_rehearsal.results'::regclass),
 'rls',(select relrowsecurity and not relforcerowsecurity from pg_class where oid='tf_pdf_result_rehearsal.results'::regclass),
 'policies',(select count(*) from pg_policy where polrelid='tf_pdf_result_rehearsal.results'::regclass),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tf_pdf_result_rehearsal'),
 'public_grants',(select count(*) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='tf_pdf_result_rehearsal' and a.grantee=0)+(select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='tf_pdf_result_rehearsal.results'::regclass and a.grantee=0)+(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='tf_pdf_result_rehearsal' and a.grantee=0));
commit;"""
    value = json.loads(trial.query(sql).stdout)
    if (value['schemas'] != ['tf_pdf_result_rehearsal'] or value['schema_owner'] != 'postgres'
            or value['table_owner'] != 'postgres' or not value['rls'] or value['policies'] != 0
            or value['public_grants'] != 0 or len(value['functions']) != 3
            or {v['name'] for v in value['functions']} != {'refuse_mutation', 'result_receipt', 'store_result'}
            or any(v['owner'] != 'postgres' or v['definer'] or v['config'] != ['search_path=pg_catalog'] for v in value['functions'])):
        raise FeedPgTrialError('PDF isolated schema profile differs')
    trial.record('PDF_PROFILE', value)
    return value


def export_archive(trial):
    trial.inspect()
    result = trial.run(['docker', 'exec', trial.identity, BIN + 'pg_dump', '-h', '/tmp', '-U', 'postgres',
        '-d', 'postgres', '--format=custom', '--schema=tf_pdf_result_rehearsal', '--no-comments'])
    if result.returncode or result.stderr or not 1 <= len(result.stdout) <= 131072 or not result.stdout.startswith(b'PGDMP'):
        raise FeedPgTrialError('PDF complete archive unavailable')
    target = trial.proof / 'PDF_RESULT_ARCHIVE.dump'
    with target.open('xb') as stream:
        if stream.write(result.stdout) != len(result.stdout): raise FeedPgTrialError('PDF archive write incomplete')
        stream.flush(); os.fsync(stream.fileno())
    target.chmod(0o600)
    directory = os.open(trial.proof, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(directory)
    finally: os.close(directory)
    if target.read_bytes() != result.stdout: raise FeedPgTrialError('PDF archive readback differs')
    value = dict(kind='invented_small_pdf_result_archive', bytes=len(result.stdout), sha256=sha256(result.stdout).hexdigest(),
        path=str(target), schema='tf_pdf_result_rehearsal', source_owned_identity=trial.identity,
        independent_expected_input_sha256=sha256(trial.frozen[FIXTURE]).hexdigest(),
        portable_packet_limit=2097152, native_packet_limit=65536, native_archive_limit=131072,
        restored=False, source_authenticated=False, operationally_qualified=False)
    trial.record('PDF_RESULT_ARCHIVE', value)
    return value


def exercise(trial):
    packet, expected, _ = _decode(trial.frozen[FIXTURE])
    # Ignore the CLI example's later illustrative report time. This manual port
    # uses actual local UTC for preparing the write and observing its readback.
    prepared = prepare_pdf_result_custody(packet, expected, observed_at=datetime.now(timezone.utc))
    trial.record('INDEPENDENT_EXPECTED_INPUT', json.loads(trial.frozen[FIXTURE]))
    trial.record('PDF_STORE_INTENT', dict(intent_base64=base64.b64encode(prepared.canonical_intent).decode(),
        intent_sha256=sha256(prepared.canonical_intent).hexdigest(), packet_sha256=expected.packet_sha256))
    receipt = committed(trial, prepared.statement)
    stored = reopen_pdf_result_custody(receipt, expected, intent_raw=prepared.canonical_intent, observed_at=datetime.now(timezone.utc))
    replay = committed(trial, prepared.statement)
    if replay != receipt: raise FeedPgTrialError('PDF exact replay changed original artifact or time')
    read = committed(trial, pdf_result_custody_read_statement(expected.operation_id))
    if read != receipt: raise FeedPgTrialError('PDF complete readback differs')
    reopened = reopen_pdf_result_custody(read, expected, intent_raw=prepared.canonical_intent, observed_at=datetime.now(timezone.utc))
    if reopened.result.output_raw != stored.result.output_raw: raise FeedPgTrialError('PDF cold output differs')
    with (trial.proof / 'PDF_FULL_RECEIPT.json').open('xb') as stream: stream.write(receipt)
    trial.stop(); trial.start()
    _, cold_expected, _ = _decode(trial.frozen[FIXTURE])
    cold_receipt = committed(trial, pdf_result_custody_read_statement(cold_expected.operation_id))
    if cold_receipt != receipt: raise FeedPgTrialError('PDF database restart changed complete custody')
    cold = reopen_pdf_result_custody(cold_receipt, cold_expected, intent_raw=prepared.canonical_intent,
                                   observed_at=datetime.now(timezone.utc))
    if cold.artifact_id != stored.artifact_id or cold.stored_at != stored.stored_at:
        raise FeedPgTrialError('PDF database restart changed historical artifact')
    before = fingerprint(trial)
    if len(before) != 1: raise FeedPgTrialError('PDF first write count differs')
    failures = []
    def refused(label, statement, state, message):
        result = trial.query('\\set VERBOSITY verbose\n' + statement, allowed=True)
        if (result.returncode == 0 or COMMIT_MARKER in result.stdout
                or not matches_native_refusal(result.stderr, state, message) or fingerprint(trial) != before):
            raise FeedPgTrialError('PDF negative outcome changed custody')
        failures.append(label)
    different, other = variant(packet, expected, assertion='A different invented unverified assertion is retained.')
    alternative = prepare_pdf_result_custody(different, other, observed_at=datetime.now(timezone.utc))
    refused('same_operation_different_valid_packet', alternative.statement, '23505', 'invented_pdf_result_replay_conflict')
    refused('same_operation_different_intent_bytes', direct(prepared.canonical_intent + b' ', packet), '23505', 'invented_pdf_result_replay_conflict')
    rollback_packet, rollback_expected = variant(packet, expected, operation=str(uuid4()))
    rollback = prepare_pdf_result_custody(rollback_packet, rollback_expected, observed_at=datetime.now(timezone.utc))
    if rollback.statement.count('commit;') != 1: raise FeedPgTrialError('PDF fixed commit boundary differs')
    refused('post_inner_failure_rolls_back', rollback.statement.replace('commit;', 'select 1/0;commit;'), '22012', 'division by zero')
    refused('append_only_update', HEAD + "begin;update tf_pdf_result_rehearsal.results set stored_at=clock_timestamp();commit;\n\\echo " + COMMIT_MARKER.decode() + '\n', '55000', 'invented_pdf_result_append_only')
    refused('append_only_delete', HEAD + "begin;delete from tf_pdf_result_rehearsal.results;commit;\n\\echo " + COMMIT_MARKER.decode() + '\n', '55000', 'invented_pdf_result_append_only')
    refused('append_only_truncate', HEAD + "begin;truncate tf_pdf_result_rehearsal.results;commit;\n\\echo " + COMMIT_MARKER.decode() + '\n', '55000', 'invented_pdf_result_append_only')
    trial.query('begin;create role tf_pdf_custody_probe nologin nosuperuser nocreatedb nocreaterole noinherit;commit;')
    refused('ordinary_nologin_has_no_schema_read', HEAD + "begin;set local role tf_pdf_custody_probe;select tf_pdf_result_rehearsal.result_receipt(" + _literal(expected.operation_id) + "::uuid);commit;\n\\echo " + COMMIT_MARKER.decode() + '\n', '42501', 'permission denied for schema tf_pdf_result_rehearsal')
    # The explicit independent expectation/intent remain mandatory even when the
    # actual database returns byte-consistent original custody.
    rejected = 0
    for independent, intent in ((replace(expected, output_sha256='f'*64), prepared.canonical_intent), (expected, b'{}'), (None, prepared.canonical_intent)):
        try: reopen_pdf_result_custody(read, independent, intent_raw=intent, observed_at=datetime.now(timezone.utc))
        except ValueError: rejected += 1
        else: raise FeedPgTrialError('PDF absent/foreign independent intent adopted')
    if rejected != 3: raise FeedPgTrialError('PDF independent refusal count differs')
    archive = export_archive(trial)
    trial.record('PDF_CASES', dict(status='PASS', exact_replay=True, complete_readback=True,
        cold_originals_rederived=True, database_restart_preserved_exact_receipt=True, negative_cases=failures, independent_refusals=rejected,
        rows=fingerprint(trial), source_requests=0, provider_calls=0, publication=False))
    return dict(operation_id=stored.operation_id, artifact_id=stored.artifact_id,
        stored_at=stored.stored_at.isoformat(), packet_sha256=expected.packet_sha256,
        receipt_sha256=sha256(receipt).hexdigest(), archive_sha256=archive['sha256'], negative_cases=len(failures), independent_refusals=rejected)


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args == ['--help']:
        print('Fixed invented PDF custody in a new isolated cluster; no target/path/source/provider selector.'); return 0
    if args:
        print('pdf_custody_arguments_refused', file=sys.stderr); return 2
    trial = None; result = None; failed = False; cleanup = []
    try:
        trial = FreshPdfResultPostgres()
        trial.verify_sources('PDF_BEFORE_CREATE')
        trial.create()
        profile(trial)
        result = exercise(trial)
        trial.verify_sources('PDF_AFTER_CASES')
    except Exception:
        failed = True
    finally:
        if trial is not None:
            for label, action in [('cluster_stopped', trial.stop), ('initializer_stopped', trial.stop_initializer)]:
                try:
                    action(); cleanup.append(dict(check=label, status='PASS'))
                except Exception:
                    failed = True; cleanup.append(dict(check=label, status='FAIL'))
            try: trial.record('PDF_CLEANUP', cleanup)
            except Exception: failed = True
    if failed or result is None:
        if trial is not None:
            try: trial.record('PDF_FAILURE', dict(status='FAIL', code='pdf_custody_trial_unavailable'))
            except Exception: pass
        print('pdf_custody_trial_unavailable', file=sys.stderr); return 1
    try:
        trial.record('PDF_RESULT', dict(status='PASS', scope='invented_small_pdf_result_byte_custody_only',
            evidence=str(trial.proof), primary_changed=False, source_authenticated=False,
            storage_operationally_qualified=False, owned_resources_stopped=True, **result))
    except Exception:
        print('pdf_custody_trial_unavailable', file=sys.stderr); return 1
    print(json.dumps(dict(status='PASS', evidence=str(trial.proof), scope='invented_small_pdf_result_byte_custody_only')))
    return 0


if __name__ == '__main__': raise SystemExit(main())
