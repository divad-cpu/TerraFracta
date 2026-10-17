"""Manual fresh matching PDF preparation restore; no default input or target.

Checks complete source-selected bytes/rows and the declared bounded lab profile.
No full historical catalogue, populated rollback, off-host or actor/source claim.
"""
from dataclasses import dataclass, field, fields
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
import base64
import json
import re
import sys

from scripts import rehearse_pdf_preparation_custody as producer
from scripts.rehearse_pdf_result_custody_restore import _private_write, _restore as _restore_archive
from workers.closed_pair_channel import _json as strict_json, _binary
from workers.feed_postgres_contract import _uuid, _parse_time
from workers.pdf_result_custody import (
    _intent as result_intent, RECEIPT_KEYS as RESULT_RECEIPT_KEYS,
    RECEIPT_KIND as RESULT_KIND, MAX_CUSTODY_PACKET_BYTES,
    pdf_result_custody_read_statement,
)
from workers.pdf_proposal_custody import PdfPreparationIntent
from workers.pdf_preparation_postgres import _receipt, prepare_pdf_preparation_reopen, reopen_stored_pdf_preparation
from workers.pdf_preparation_packet import _parts
from workers.detached_proposal_custody import part_bytes
from workers.private_extraction_held_proposal import _json
from workers.prose_passage_selection import _digest

custody = producer.custody
ROOT = producer.ROOT
BIN = custody.BIN
FeedPgTrialError = custody.FeedPgTrialError
ENTRY = 'scripts/rehearse_pdf_preparation_restore.py'
TEST = 'tests/test_pdf_preparation_restore_scope.py'
CODE = 'pdf_preparation_restore_unavailable'
KIND = 'invented_pdf_preparation_restore_inputs'
SCOPE = 'invented_pdf_preparation_matching_bytes_rows_bounded_profile_only'
MAX_INPUT_BYTES = 2 * 1024 * 1024
LIMITS = dict(archive_base64=131072, result_independent_input_base64=3 * 1024 * 1024,
    result_receipt_base64=131072, result_intent_base64=2048,
    preparation_receipt_base64=131072, preparation_intent_base64=4096, profile_base64=16384)
FIELDS = frozenset(('kind', 'archive_sha256', 'rows', *LIMITS))
OPERANDS = None


@dataclass(frozen=True)
class PdfPreparationRestoreInputs:
    raw: bytes = field(repr=False)


def _now():
    return datetime.now(timezone.utc)


def _capture(value):
    if type(value) is not PdfPreparationRestoreInputs:
        raise ValueError
    namespace = vars(value)
    if type(namespace) is not dict:
        raise ValueError
    keys = tuple(namespace)
    if any(type(key) is not str for key in keys) or keys != ('raw',):
        raise ValueError
    raw = namespace['raw']
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES:
        raise ValueError
    return PdfPreparationRestoreInputs(raw)


def _profile(raw):
    value = strict_json(raw)
    expected = dict(schema_owner='postgres', public_schema_grants=0,
        schemas=['tf_pdf_result_rehearsal'], tables=[dict(name=name, owner='postgres', rls=True)
            for name in ('preparations', 'results')], functions=[dict(name=name, owner='postgres',
            definer=False, config=['search_path=pg_catalog']) for name in (
                'preparation_receipt', 'refuse_mutation', 'refuse_preparation_mutation',
                'result_receipt', 'store_preparation', 'store_result')],
        policies=0, public_table_grants=0, public_function_grants=0,
        result_fk=1, fk_index=1, append_only_triggers=4)
    if _json(value) != _json(expected):
        raise ValueError
    return value


def _row_time(value):
    if (type(value) is not str or re.fullmatch(
            r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)', value) is None):
        raise ValueError
    stamp = datetime.fromisoformat(value)
    if stamp.utcoffset() != timedelta(0):
        raise ValueError
    return stamp


def _rows(value):
    if type(value) is not dict or set(value) != {'results', 'preparations'} or len(_json(value)) > 16384:
        raise ValueError
    for name, size in (('results', 5), ('preparations', 6)):
        rows = value[name]
        if type(rows) is not list or len(rows) != 1 or type(rows[0]) is not list or len(rows[0]) != size:
            raise ValueError
        row = rows[0]
        if any(not _uuid(v) for v in row[:size - 3]) or any(not _digest(v) for v in row[-2:]):
            raise ValueError
        _row_time(row[-3])
    if value['preparations'][0][2] != value['results'][0][0]:
        raise ValueError
    return value


def _source_result(raw, packet, expected, intent):
    value = strict_json(raw)
    if (type(value) is not dict or set(value) != RESULT_RECEIPT_KEYS
            or type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != RESULT_KIND or value['operation_id'] != expected.operation_id
            or not _uuid(value['artifact_id'])):
        raise ValueError
    actual_intent = _binary(value['intent_base64'], 2048)
    actual_packet = _binary(value['packet_base64'], MAX_CUSTODY_PACKET_BYTES)
    if actual_intent != intent or actual_packet != packet or result_intent(packet, expected) != intent:
        raise ValueError
    for name, body in (('intent', intent), ('packet', packet)):
        if (type(value[name + '_bytes']) is not int or value[name + '_bytes'] != len(body)
                or value[name + '_sha256'] != sha256(body).hexdigest()):
            raise ValueError
    stored = _parse_time(value['stored_at'])
    if stored < expected.prepared_at:
        raise ValueError
    return value, stored


def _admit(inputs):
    value = strict_json(inputs.raw)
    if type(value) is not dict or set(value) != FIELDS or value['kind'] != KIND:
        raise ValueError
    body = {key: _binary(value[key], cap) for key, cap in LIMITS.items()}
    archive = body['archive_base64']
    if (not _digest(value['archive_sha256']) or not archive.startswith(b'PGDMP')
            or sha256(archive).hexdigest() != value['archive_sha256']):
        raise ValueError
    profile = _profile(body['profile_base64'])
    rows = _rows(value['rows'])
    packet, expected, _example_time = custody._decode(body['result_independent_input_base64'])
    source_result, result_stored = _source_result(body['result_receipt_base64'], packet,
        expected, body['result_intent_base64'])
    intent = PdfPreparationIntent(body['preparation_intent_base64'])
    preparation_packet, stored = _receipt(body['preparation_receipt_base64'], intent)
    result_row = rows['results'][0]
    prep_row = rows['preparations'][0]
    if (result_row[:2] != [expected.operation_id, source_result['artifact_id']]
            or _row_time(result_row[2]) != result_stored
            or result_row[-2:] != [sha256(body['result_intent_base64']).hexdigest(), sha256(packet).hexdigest()]
            or prep_row[:3] != [stored.operation_id, stored.artifact_id, stored.result_operation_id]
            or _row_time(prep_row[3]) != stored.stored_at
            or prep_row[-2:] != [sha256(intent.canonical_metadata).hexdigest(), sha256(preparation_packet).hexdigest()]
            or stored.result_operation_id != expected.operation_id):
        raise ValueError
    return SimpleNamespace(body=body, archive=archive, archive_sha256=value['archive_sha256'],
        profile=profile, rows=rows, packet=packet, expected=expected, intent=intent,
        stored=stored, parts=part_bytes(_parts(preparation_packet, intent)))


def _open(frame, prep_raw, result_raw):
    # These selectors always come from independent source operands, not the
    # incoming target's artifact/time. One full rederivation per phase only.
    expected = prepare_pdf_preparation_reopen(intent=frame.intent,
        artifact_id=frame.stored.artifact_id, stored_at=frame.stored.stored_at, observed_at=_now())
    opened = reopen_stored_pdf_preparation(prep_raw, expected, receipt=result_raw,
        extraction_expected=frame.expected, intent_raw=frame.body['result_intent_base64'], observed_at=_now())
    if part_bytes(opened.result.parts) != frame.parts or opened.stored != frame.stored:
        raise ValueError
    return opened


def _preflight(inputs):
    captured = _capture(inputs)
    frame = _admit(captured)
    _open(frame, frame.body['preparation_receipt_base64'], frame.body['result_receipt_base64'])
    return captured


class FreshPdfPreparationReceiver(custody.FreshPdfResultPostgres):
    def __init__(self):
        super().__init__()
        producer.freeze_preparation(self, extras=(ENTRY, TEST))

    def bootstrap_schema(self):
        result = self.query("begin isolation level repeatable read read only;select count(*) from pg_namespace where nspname!~'^pg_' and nspname not in('public','information_schema');commit;")
        if type(result.returncode) is not int or result.returncode != 0 or result.stderr != b'' or result.stdout != b'0\n':
            raise FeedPgTrialError(CODE)
        self.record('PDF_PREPARATION_RESTORE_EMPTY', dict(nondefault_schemas=0, installed_schemas=0))


def _record_operands(trial, inputs):
    directory = trial.proof / 'restore-operands'
    directory.mkdir(mode=0o700)
    _private_write(directory / 'manifest.json', inputs.raw)
    trial.record('PDF_PREPARATION_RESTORE_OPERANDS', dict(bytes=len(inputs.raw),
        sha256=sha256(inputs.raw).hexdigest(), exact_fields=10, source_full_receipts_and_intents=True))


def _verify(trial, inputs, label):
    trial.verify_sources('PDF_PREPARATION_RESTORE_' + label)
    if (trial.proof / 'restore-operands/manifest.json').read_bytes() != inputs.raw:
        raise FeedPgTrialError(CODE)
    trial.record('PDF_PREPARATION_OPERANDS_' + label, dict(unchanged=True))


def _matching(trial, frame, label):
    actual_profile = strict_json(producer.profile(trial))
    actual_rows = producer.fingerprints(trial)
    if _json(actual_profile) != _json(frame.profile) or _json(actual_rows) != _json(frame.rows):
        raise FeedPgTrialError(CODE)
    trial.record('PDF_PREPARATION_MATCH_' + label,
        dict(exact_two_table_rows=True, bounded_profile=True, full_catalogue_equivalence=False))


def _phase(trial, inputs, label):
    frame = _admit(inputs)
    _matching(trial, frame, label)
    result_raw = custody.committed(trial, pdf_result_custody_read_statement(frame.expected.operation_id))
    expected = prepare_pdf_preparation_reopen(intent=frame.intent, artifact_id=frame.stored.artifact_id,
        stored_at=frame.stored.stored_at, observed_at=_now())
    prep_raw = custody.committed(trial, expected.statement())
    if result_raw != frame.body['result_receipt_base64'] or prep_raw != frame.body['preparation_receipt_base64']:
        raise FeedPgTrialError(CODE)
    _private_write(trial.proof / ('PREPARATION_RESTORED_RESULT_' + label + '.json'), result_raw)
    _private_write(trial.proof / ('PREPARATION_RESTORED_FULL_' + label + '.json'), prep_raw)
    opened = _open(frame, prep_raw, result_raw)
    _verify(trial, inputs, label)
    return dict(preparation_operation_id=opened.stored.operation_id,
        preparation_artifact_id=opened.stored.artifact_id, preparation_stored_at=opened.stored.stored_at.isoformat(),
        result_operation_id=frame.expected.operation_id,
        preparation_receipt_sha256=sha256(prep_raw).hexdigest(), result_receipt_sha256=sha256(result_raw).hexdigest())


def run_restore(inputs):
    trial = None
    captured = None
    result = None
    failed = False
    cleanup = []
    try:
        captured = _preflight(inputs)
        trial = FreshPdfPreparationReceiver()
        _record_operands(trial, captured)
        _verify(trial, captured, 'BEFORE_CREATE')
        trial.create()
        _verify(trial, captured, 'BEFORE_RESTORE')
        frame = _admit(captured)
        _restore_archive(trial, frame)
        result = _phase(trial, captured, 'AFTER_RESTORE')
        trial.stop()
        trial.start()
        restarted = _phase(trial, captured, 'AFTER_RESTART')
        if _json(result) != _json(restarted):
            raise FeedPgTrialError(CODE)
    except Exception:
        failed = True
    finally:
        if trial is not None:
            for label, action in (('cluster_stopped', trial.stop), ('initializer_stopped', trial.stop_initializer)):
                try:
                    action()
                    cleanup.append(dict(check=label, status='PASS'))
                except Exception:
                    failed = True
                    cleanup.append(dict(check=label, status='FAIL'))
            try:
                trial.record('PDF_PREPARATION_RESTORE_CLEANUP', cleanup)
                _verify(trial, captured, 'AFTER_CLEANUP')
            except Exception:
                failed = True
    if failed or result is None:
        if trial is not None:
            try:
                trial.record('PDF_PREPARATION_RESTORE_FAILURE', dict(status='FAIL', code=CODE))
            except Exception:
                pass
        raise FeedPgTrialError(CODE) from None
    value = dict(status='PASS', scope=SCOPE, evidence=str(trial.proof), owned_resources_stopped=True,
        exact_source_receipts=True, owned_restart=True, source_authenticated=False,
        storage_operationally_qualified=False, full_catalogue_equivalence=False,
        populated_restore_rollback_qualified=False, offhost_recovery_qualified=False,
        primary_changed=False, capture_executed=False, **result)
    try:
        trial.record('PDF_PREPARATION_RESTORE_RESULT', value)
    except Exception:
        raise FeedPgTrialError(CODE) from None
    return value


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args == ['--help']:
        print('Fixed supplied two-table PDF preparation restore; no default archive, path, role or target.')
        return 0
    if args or OPERANDS is None:
        print('pdf_preparation_restore_operands_required', file=sys.stderr)
        return 2
    try:
        value = run_restore(OPERANDS)
    except FeedPgTrialError:
        print(CODE, file=sys.stderr)
        return 1
    print(json.dumps(value))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
