"""Manual fresh-target recovery of supplied invented small PDF custody bytes.

No default operands or existing target. The supplied hashes select bytes, not
source authority. This checks byte/row equality and the producer's bounded
security profile; populated-restore rollback and full catalogue equivalence
are separate open gates. Actual execution requires separately bound inputs.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field, fields
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
import sys
from types import SimpleNamespace

from scripts.rehearse_pdf_result_custody import (
    FreshPdfResultPostgres, FeedPgTrialError, ROOT, BIN, committed, fingerprint, profile,
)
from scripts.offline_pdf_result_review import _decode
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import _uuid
from workers.passage_extraction_request import _canonical
from workers.pdf_result_custody import (
    PdfResultCustodyError, prepare_pdf_result_custody,
    pdf_result_custody_read_statement, reopen_pdf_result_custody,
)
from workers.prose_passage_selection import _digest

ENTRY = 'scripts/rehearse_pdf_result_custody_restore.py'
TEST = 'tests/test_pdf_custody_restore_scope.py'
LIMITS = dict(archive=131072, independent_input_raw=3 * 1024 * 1024,
              intent_raw=2048, source_receipt=131072,
              source_profile_raw=16384, source_rows_raw=16384)
OPERANDS = None
SCOPE = 'invented_pdf_result_matching_bytes_rows_bounded_security_profile_only'
CODE = 'pdf_custody_restore_unavailable'


@dataclass(frozen=True)
class PdfCustodyRestoreInputs:
    archive: bytes = field(repr=False)
    archive_sha256: str
    independent_input_raw: bytes = field(repr=False)
    intent_raw: bytes = field(repr=False)
    source_receipt: bytes = field(repr=False)
    source_profile_raw: bytes = field(repr=False)
    source_rows_raw: bytes = field(repr=False)


def _now():
    return datetime.now(timezone.utc)


def _capture(inputs):
    # No property, foreign namespace/key hook or caller clock is consulted.
    if type(inputs) is not PdfCustodyRestoreInputs:
        raise ValueError
    namespace = vars(inputs)
    if type(namespace) is not dict:
        raise ValueError
    keys = tuple(namespace)
    names = tuple(f.name for f in fields(PdfCustodyRestoreInputs))
    if any(type(k) is not str for k in keys) or set(keys) != set(names):
        raise ValueError
    values = {name: namespace[name] for name in names}
    for name, cap in LIMITS.items():
        if type(values[name]) is not bytes or not 1 <= len(values[name]) <= cap:
            raise ValueError
    digest = values['archive_sha256']
    if (not _digest(digest) or sha256(values['archive']).hexdigest() != digest
            or not values['archive'].startswith(b'PGDMP')):
        raise ValueError
    return PdfCustodyRestoreInputs(**values)


def _profile_value(raw):
    value = strict_json(raw)
    # Canonical comparison intentionally distinguishes JSON true from1/false0.
    expected = dict(schemas=['tf_pdf_result_rehearsal'], schema_owner='postgres',
        table_owner='postgres', rls=True, policies=0, public_grants=0,
        functions=[dict(name=name, owner='postgres', definer=False,
                        config=['search_path=pg_catalog'])
                   for name in ('refuse_mutation', 'result_receipt', 'store_result')])
    if _canonical(value) != _canonical(expected):
        raise ValueError
    return value


def _rows_value(raw):
    value = strict_json(raw)
    keys = {'operation_id', 'artifact_id', 'stored_at', 'intent_sha256', 'packet_sha256'}
    if type(value) is not list or len(value) != 1 or type(value[0]) is not dict or set(value[0]) != keys:
        raise ValueError
    row = value[0]
    if (not _uuid(row['operation_id']) or not _uuid(row['artifact_id'])
            or not _digest(row['intent_sha256']) or not _digest(row['packet_sha256'])
            or type(row['stored_at']) is not str or not 1 <= len(row['stored_at']) <= 40):
        raise ValueError
    stamp = datetime.fromisoformat(row['stored_at'])
    if stamp.tzinfo is None or stamp.utcoffset() != timezone.utc.utcoffset(stamp):
        raise ValueError
    return value


def _preflight(inputs):
    captured = _capture(inputs)
    source_profile = _profile_value(captured.source_profile_raw)
    source_rows = _rows_value(captured.source_rows_raw)
    packet, expected, _illustrative_time = _decode(captured.independent_input_raw)
    # Reopen at actual local UTC; the example's future display time is ignored.
    source = reopen_pdf_result_custody(captured.source_receipt, expected,
        intent_raw=captured.intent_raw, observed_at=_now())
    row = source_rows[0]
    if (source.raw != packet or source.operation_id != row['operation_id']
            or source.artifact_id != row['artifact_id']
            or source.stored_at != datetime.fromisoformat(row['stored_at'])
            or sha256(captured.intent_raw).hexdigest() != row['intent_sha256']
            or sha256(packet).hexdigest() != row['packet_sha256']):
        raise ValueError
    return captured


def freeze_restore_sources(trial):
    """Freeze this receiver/test and recursive local dependencies before commands."""
    if trial.counter or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError(CODE)
    names = {ENTRY, TEST, 'workers/_pdf_text_worker.py', 'pyproject.toml', 'uv.lock'}; pending = list(names)
    while pending:
        name = pending.pop()
        raw = (ROOT / name).read_bytes()
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(raw)):
                modules = ([node.module] if isinstance(node, ast.ImportFrom) and node.module else
                           [v.name for v in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    child = module.replace('.', '/') + '.py'
                    if child not in names and (ROOT / child).is_file():
                        names.add(child); pending.append(child)
    rows = []
    for name in sorted(names):
        raw = (ROOT / name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name] != raw:
                raise FeedPgTrialError(CODE)
            continue
        path = trial.proof / 'inputs' / name
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        _private_write(path, raw)
        trial.frozen[name] = raw
        rows.append(dict(path=name, bytes=len(raw), sha256=sha256(raw).hexdigest()))
    trial.source_bindings.extend(rows)
    trial.record('PDF_RESTORE_SOURCE_BINDINGS', rows)


def _private_write(path, raw):
    # Exclusive writes preserve every prior attempt; no public intermediate mode.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        if stream.write(raw) != len(raw):
            raise FeedPgTrialError(CODE)
        stream.flush(); os.fsync(stream.fileno())


def _operand_bodies(inputs):
    return {f.name: (inputs.archive_sha256.encode('ascii') if f.name == 'archive_sha256'
                     else getattr(inputs, f.name)) for f in fields(PdfCustodyRestoreInputs)}


def _record_operands(trial, inputs):
    directory = trial.proof / 'restore-operands'; directory.mkdir(mode=0o700)
    rows = []
    for name, raw in _operand_bodies(inputs).items():
        _private_write(directory / (name + '.bin'), raw)
        rows.append(dict(name=name, bytes=len(raw), sha256=sha256(raw).hexdigest()))
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    trial.record('PDF_RESTORE_OPERANDS', rows)


def _verify(trial, inputs, label):
    trial.verify_sources(label)
    if any((trial.proof / 'restore-operands' / (name + '.bin')).read_bytes() != raw
           for name, raw in _operand_bodies(inputs).items()):
        raise FeedPgTrialError(CODE)
    trial.record('PDF_RESTORE_OPERAND_CHECK_' + label, dict(unchanged=True, exact_operands=7))


class FreshPdfCustodyReceiver(FreshPdfResultPostgres):
    """The inherited lifecycle creates only a fresh, owned network-none target."""
    def __init__(self):
        super().__init__()
        freeze_restore_sources(self)

    def bootstrap_schema(self):
        # No feed or PDF fixture is installed. pg_restore creates its own schema.
        result = self.query("begin isolation level repeatable read read only;select count(*) from pg_namespace where nspname!~'^pg_' and nspname not in('public','information_schema');commit;")
        if result.returncode or result.stderr or result.stdout != b'0\n':
            raise FeedPgTrialError(CODE)
        self.record('PDF_RESTORE_EMPTY_TARGET', dict(nondefault_schemas=0, installed_schemas=0))


def _observe_profile(trial, label):
    # Producer profile has one fixed record name; namespace each fresh reading
    # without changing its SQL, assertions, target, role or profile coverage.
    adapter = SimpleNamespace(query=trial.query,
        record=lambda name, value: trial.record('PDF_RESTORE_' + label + '_' + name, value))
    return profile(adapter)


def _restore(trial, inputs):
    trial.inspect()
    # The exact producer archive already selects the PDF schema. A restore-side
    # namespace filter omits the archive's CREATE SCHEMA on a pristine cluster.
    result = trial.run(['docker', 'exec', '-i', trial.identity, BIN + 'pg_restore',
        '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '--exit-on-error',
        '--single-transaction'], payload=inputs.archive)
    if result.returncode or result.stderr or result.stdout:
        raise FeedPgTrialError(CODE)


def _matching(trial, inputs, label):
    actual_profile = _observe_profile(trial, label)
    actual_rows = fingerprint(trial)
    if (_canonical(actual_profile) != _canonical(strict_json(inputs.source_profile_raw))
            or _canonical(actual_rows) != _canonical(strict_json(inputs.source_rows_raw))):
        raise FeedPgTrialError(CODE)
    trial.record('PDF_RESTORE_MATCH_' + label, dict(rows=1, row_metadata=True,
        bounded_security_profile=True, full_catalogue_equivalence=False))


def _exercise(trial, inputs):
    _matching(trial, inputs, 'AFTER_RESTORE')
    packet, expected, _ = _decode(inputs.independent_input_raw)
    raw = committed(trial, pdf_result_custody_read_statement(expected.operation_id))
    if raw != inputs.source_receipt:
        raise FeedPgTrialError(CODE)
    _private_write(trial.proof / 'PDF_RESTORED_FULL_RECEIPT.json', raw)
    restored = reopen_pdf_result_custody(raw, expected, intent_raw=inputs.intent_raw, observed_at=_now())
    if restored.raw != packet:
        raise FeedPgTrialError(CODE)
    refused = 0
    for intent in (b'', b'{}'):
        try:
            reopen_pdf_result_custody(raw, expected, intent_raw=intent, observed_at=_now())
        except PdfResultCustodyError:
            refused += 1
        else:
            raise FeedPgTrialError(CODE)
    prepared = prepare_pdf_result_custody(packet, expected, observed_at=_now())
    if prepared.canonical_intent != inputs.intent_raw:
        raise FeedPgTrialError(CODE)
    replay = committed(trial, prepared.statement)
    if replay != raw:
        raise FeedPgTrialError(CODE)
    _matching(trial, inputs, 'AFTER_REPLAY')
    return dict(archive_sha256=inputs.archive_sha256,
        receipt_sha256=sha256(raw).hexdigest(), operation_id=restored.operation_id,
        artifact_id=restored.artifact_id, stored_at=restored.stored_at.isoformat(),
        exact_receipt=True, historical_replay=True, independent_intent_refusals=refused)


def run_restore(inputs: PdfCustodyRestoreInputs):
    """Return metadata only after successful checks and both owned stop checks.

    Failure is always the fixed private FeedPgTrialError. No argument admits an
    existing target. A constructor is unreachable until original PDF preflight.
    """
    trial = None; result = None; failed = False; cleanup = []
    try:
        captured = _preflight(inputs)
        trial = FreshPdfCustodyReceiver()
        _record_operands(trial, captured)
        _verify(trial, captured, 'PDF_RESTORE_BEFORE_CREATE')
        trial.create()
        _verify(trial, captured, 'PDF_RESTORE_BEFORE_ARCHIVE')
        _restore(trial, captured)
        result = _exercise(trial, captured)
        _verify(trial, captured, 'PDF_RESTORE_AFTER_CHECKS')
    except Exception:
        failed = True
    finally:
        if trial is not None:
            for label, action in (('cluster_stopped', trial.stop), ('initializer_stopped', trial.stop_initializer)):
                try:
                    action(); cleanup.append(dict(check=label, status='PASS'))
                except Exception:
                    failed = True; cleanup.append(dict(check=label, status='FAIL'))
            try:
                trial.record('PDF_RESTORE_CLEANUP', cleanup)
                _verify(trial, captured, 'PDF_RESTORE_AFTER_CLEANUP')
            except Exception:
                failed = True
    if failed or result is None:
        if trial is not None:
            try:
                trial.record('PDF_RESTORE_FAILURE', dict(status='FAIL', code=CODE))
            except Exception:
                pass
        raise FeedPgTrialError(CODE) from None
    value = dict(status='PASS', scope=SCOPE, evidence=str(trial.proof),
        owned_resources_stopped=True, primary_changed=False, source_authenticated=False,
        storage_operationally_qualified=False, full_catalogue_equivalence=False,
        populated_restore_rollback_qualified=False, offhost_recovery_qualified=False, **result)
    try:
        trial.record('PDF_RESTORE_RESULT', value)
    except Exception:
        raise FeedPgTrialError(CODE) from None
    return value


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args == ['--help']:
        print('Fixed supplied invented PDF custody restore; no default archive, path, target or provider selector.')
        return 0
    if args or OPERANDS is None:
        print('pdf_custody_restore_operands_required', file=sys.stderr)
        return 2
    try:
        result = run_restore(OPERANDS)
    except FeedPgTrialError:
        print(CODE, file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
