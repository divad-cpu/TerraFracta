"""Small supplied PDF preparation byte ports; no connection or held capture.

The separate portable192KiB carrier remains unchanged. This laboratory port
accepts at most64KiB and always requires independent historical assertions.
Matching supplied/native-shaped JSON is correspondence, not authentication.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import base64
import json

from workers.closed_pair_channel import _json as strict_json, _binary
from workers.detached_proposal_custody import part_bytes
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.feed_postgres_contract import (
    HEAD, COMMIT_MARKER, MAX_CAPTURE_OUTPUT, MAX_CAPTURE_STATEMENT, _uuid, _parse_time,
)
from workers.pair_native_sql import _literal
from workers.pdf_passage_binding import _utc_copy, _stamp
from workers.pdf_preparation_packet import (
    KIND as PORTABLE_KIND, PART_KEYS, _parts,
    prepare_pdf_preparation_packet, reopen_pdf_preparation_packet,
)
from workers.pdf_proposal_custody import (
    PdfPreparationIntent, PreparedPdfProposal, ReobservedPdfProposal,
    MAX_INTENT_BYTES, PREPARED_STATE, _LOCAL_RECORDS,
    _intent_metadata, _raw_inputs, _historical,
)
from workers.private_extraction_held_proposal import _json, _instant
from workers.prose_passage_selection import _digest

MAX_NATIVE_PACKET_BYTES = 65536
RECEIPT_MARGIN = 4096
RECEIPT_KIND = 'invented_pdf_preparation_stored'
RECEIPT_KEYS = frozenset(('schema_version', 'kind', 'operation_id', 'artifact_id',
    'result_operation_id', 'stored_at', 'intent_base64', 'packet_base64',
    'intent_sha256', 'packet_sha256', 'intent_bytes', 'packet_bytes'))


class PdfPreparationPostgresError(ValueError):
    """Fixed private refusal, never a source or storage-quality verdict."""


@dataclass(frozen=True)
class PdfPreparationStoreRequest:
    prepared: PreparedPdfProposal = field(repr=False)
    packet_raw: bytes = field(repr=False)

    def statement(self):
        """Rebuild one fixed statement without reopening originals again."""
        try:
            if type(self) is not PdfPreparationStoreRequest:
                raise ValueError
            request = _capture(self)
            metadata = _checked_request(request)
            return _store_statement(request.prepared.intent.canonical_metadata, request.packet_raw)
        except Exception:
            raise PdfPreparationPostgresError('pdf_preparation_store_unavailable') from None


@dataclass(frozen=True)
class StoredPdfPreparation:
    operation_id: str
    artifact_id: str
    result_operation_id: str
    stored_at: datetime
    evidence_state: str = 'supplied_pdf_preparation_byte_custody_only_not_authenticated'


@dataclass(frozen=True)
class PdfPreparationReopenExpected:
    intent: PdfPreparationIntent = field(repr=False)
    artifact_id: str
    stored_at: datetime
    observed_at: datetime

    def statement(self):
        try:
            if type(self) is not PdfPreparationReopenExpected:
                raise ValueError
            expected = _capture(self)
            metadata = _checked_expected(expected)
            return (HEAD + "set time zone 'UTC';begin isolation level repeatable read read only;"
                "select tf_pdf_result_rehearsal.preparation_receipt(" + _literal(metadata['operation_id'])
                + "::uuid);commit;\n\\echo " + COMMIT_MARKER.decode() + '\n')
        except Exception:
            raise PdfPreparationPostgresError('pdf_preparation_read_unavailable') from None


@dataclass(frozen=True)
class ReopenedStoredPdfPreparation:
    result: ReobservedPdfProposal = field(repr=False)
    stored: StoredPdfPreparation = field(repr=False)
    full_receipt: bytes = field(repr=False)
    packet_raw: bytes = field(repr=False)
    observed_at: datetime
    evidence_state: str = 'supplied_pdf_historical_preparation_not_current_qualification_or_capture'


_INPUT_RECORDS = _LOCAL_RECORDS + (PdfPreparationStoreRequest, PdfPreparationReopenExpected)


def _capture(value):
    return thaw_input(freeze_input(value, _INPUT_RECORDS))


def _b64(raw):
    return base64.b64encode(raw).decode('ascii')


def _prepared_metadata(prepared):
    if type(prepared) is not PreparedPdfProposal or type(prepared.evidence_state) is not str or prepared.evidence_state != PREPARED_STATE:
        raise ValueError
    _raw_inputs(prepared.receipt, prepared.extraction_expected, prepared.intent_raw)
    at = _utc_copy(prepared.observed_at)
    metadata, _, _, _ = _historical(prepared.receipt, prepared.extraction_expected,
        prepared.parts, prepared.intent, prepared.intent_raw, at, at)
    return metadata


def _native_packet_size(prepared):
    """Cheap exact frame-length budget, not a substitute serialization proof."""
    values = (prepared.intent.canonical_metadata, *part_bytes(prepared.parts))
    empty = dict(schema_version=1, kind=PORTABLE_KIND, intent_base64='',
                 **{key: '' for key in PART_KEYS})
    size = len(_json(empty)) + sum(4 * ((len(raw) + 2) // 3) for raw in values)
    if not 1 <= size <= MAX_NATIVE_PACKET_BYTES:
        raise ValueError
    return size


def _shape(metadata, intent, packet):
    return dict(schema_version=1, kind=RECEIPT_KIND, operation_id=metadata['operation_id'],
        artifact_id='ffffffff-ffff-4fff-bfff-ffffffffffff',
        result_operation_id=metadata['extraction_operation_id'], stored_at='9999-12-31T23:59:59.999999Z',
        intent_base64=_b64(intent), packet_base64=_b64(packet),
        intent_sha256=sha256(intent).hexdigest(), packet_sha256=sha256(packet).hexdigest(),
        intent_bytes=len(intent), packet_bytes=len(packet))


def _budget(metadata, intent, packet):
    if len(json.dumps(_shape(metadata, intent, packet)).encode('utf8')) + RECEIPT_MARGIN > MAX_CAPTURE_OUTPUT:
        raise ValueError


def _store_statement(intent, packet):
    sql = (HEAD + "set time zone 'UTC';begin isolation level read committed read write;"
        "select tf_pdf_result_rehearsal.store_preparation(decode(" + _literal(_b64(intent))
        + ",'base64'),decode(" + _literal(_b64(packet)) + ",'base64'));commit;\n\\echo "
        + COMMIT_MARKER.decode() + '\n')
    if len(sql.encode('utf8')) > MAX_CAPTURE_STATEMENT:
        raise ValueError
    return sql


def _checked_request(request):
    if type(request) is not PdfPreparationStoreRequest:
        raise ValueError
    metadata = _prepared_metadata(request.prepared)
    size = _native_packet_size(request.prepared)
    if type(request.packet_raw) is not bytes or len(request.packet_raw) != size:
        raise ValueError
    if part_bytes(_parts(request.packet_raw, request.prepared.intent)) != part_bytes(request.prepared.parts):
        raise ValueError
    _budget(metadata, request.prepared.intent.canonical_metadata, request.packet_raw)
    return metadata


def prepare_pdf_preparation_store(prepared):
    """Recheck the full historical preparation once; execute no store."""
    try:
        captured = _capture(prepared)
        metadata = _prepared_metadata(captured)
        size = _native_packet_size(captured)
        # The receipt bound is checked before the serializer can start a child.
        _budget(metadata, captured.intent.canonical_metadata, b'x' * size)
        packet = prepare_pdf_preparation_packet(captured)
        request = PdfPreparationStoreRequest(captured, packet)
        _checked_request(request)
        _store_statement(captured.intent.canonical_metadata, packet)
        return request
    except Exception:
        raise PdfPreparationPostgresError('pdf_preparation_store_unavailable') from None


def _checked_expected(expected):
    if type(expected) is not PdfPreparationReopenExpected:
        raise ValueError
    metadata = _intent_metadata(expected.intent)
    stored = _utc_copy(expected.stored_at)
    observed = _utc_copy(expected.observed_at)
    if not _uuid(expected.artifact_id) or not _instant(metadata['prepared_at']) <= stored <= observed:
        raise ValueError
    return metadata


def prepare_pdf_preparation_reopen(*, intent, artifact_id, stored_at, observed_at):
    """Require the independent exact artifact/time/prewrite intent selectors."""
    try:
        intent, artifact_id, stored_at, observed_at = _capture((intent, artifact_id, stored_at, observed_at))
        expected = PdfPreparationReopenExpected(intent, artifact_id, stored_at, observed_at)
        _checked_expected(expected)
        return expected
    except Exception:
        raise PdfPreparationPostgresError('pdf_preparation_read_unavailable') from None


def _receipt(raw, intent):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_CAPTURE_OUTPUT:
        raise ValueError
    value = strict_json(raw)
    metadata = _intent_metadata(intent)
    if (type(value) is not dict or set(value) != RECEIPT_KEYS
            or type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != RECEIPT_KIND or not _uuid(value['operation_id'])
            or not _uuid(value['artifact_id']) or not _uuid(value['result_operation_id'])
            or value['operation_id'] != metadata['operation_id']
            or value['result_operation_id'] != metadata['extraction_operation_id']):
        raise ValueError
    carried_intent = _binary(value['intent_base64'], MAX_INTENT_BYTES)
    packet = _binary(value['packet_base64'], MAX_NATIVE_PACKET_BYTES)
    for name, body in (('intent', carried_intent), ('packet', packet)):
        if (type(value[name + '_bytes']) is not int or value[name + '_bytes'] != len(body)
                or not _digest(value[name + '_sha256']) or value[name + '_sha256'] != sha256(body).hexdigest()):
            raise ValueError
    if carried_intent != intent.canonical_metadata:
        raise ValueError
    _parts(packet, intent)
    stored_at = _parse_time(value['stored_at'])
    if _instant(metadata['prepared_at']) > stored_at:
        raise ValueError
    _budget(metadata, carried_intent, packet)
    return packet, StoredPdfPreparation(value['operation_id'], value['artifact_id'],
                                        value['result_operation_id'], stored_at)


def parse_stored_pdf_preparation(raw, request, *, observed_at):
    """Warm acknowledgement rechecks once, never accepts a parsed proposal."""
    try:
        if type(raw) is not bytes or not 1 <= len(raw) <= MAX_CAPTURE_OUTPUT:
            raise ValueError
        raw, request, observed_at = _capture((raw, request, observed_at))
        _checked_request(request)
        packet, stored = _receipt(raw, request.prepared.intent)
        at = _utc_copy(observed_at)
        if packet != request.packet_raw or not stored.stored_at <= at:
            raise ValueError
        if prepare_pdf_preparation_packet(request.prepared) != packet:
            raise ValueError
        return stored
    except Exception:
        raise PdfPreparationPostgresError('pdf_preparation_stored_result_unavailable') from None


def reopen_stored_pdf_preparation(raw, expected, *, receipt, extraction_expected, intent_raw, observed_at):
    """Cold-open once using full independent result context, not SQL assertions."""
    try:
        if type(raw) is not bytes or not 1 <= len(raw) <= MAX_CAPTURE_OUTPUT:
            raise ValueError
        values = _capture((raw, expected, receipt, extraction_expected, intent_raw, observed_at))
        raw, expected, receipt, extraction_expected, intent_raw, observed_at = values
        _checked_expected(expected)
        at = _utc_copy(observed_at)
        if at < expected.observed_at:
            raise ValueError
        packet, stored = _receipt(raw, expected.intent)
        if stored.artifact_id != expected.artifact_id or stored.stored_at != expected.stored_at:
            raise ValueError
        result = reopen_pdf_preparation_packet(packet, expected.intent, receipt=receipt,
            extraction_expected=extraction_expected, intent_raw=intent_raw,
            stored_at=stored.stored_at, observed_at=at)
        return ReopenedStoredPdfPreparation(result, stored, raw, packet, at)
    except Exception:
        raise PdfPreparationPostgresError('pdf_preparation_reopened_result_unavailable') from None
