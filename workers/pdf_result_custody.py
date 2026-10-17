"""Small owner-only invented byte custody, never source/storage authentication.

The full independent PDF expectations remain explicit on every opening. The
SQL row carries bytes and a small exact intent, not enough to recreate those
expectations. This separate64KiB port does not raise portable2MiB limits.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import base64
import json

from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.feed_postgres_contract import (
    HEAD, COMMIT_MARKER, MAX_CAPTURE_STATEMENT, MAX_CAPTURE_OUTPUT, _uuid, _parse_time,
)
from workers.pair_native_sql import _literal
from workers.passage_extraction_request import _canonical
from workers.pdf_extraction_request import _request_snapshot
from workers.pdf_passage_binding import _utc_copy, _stamp
from workers.pdf_request_packet_context import ReopenedPdfRequestContext
from workers.pdf_result_packet import (
    PdfResultPacketExpected, ReopenedPdfResultPacket, reopen_pdf_result_packet, _RECORDS,
)
from workers.prose_passage_selection import _digest

MAX_CUSTODY_PACKET_BYTES = 65536
MAX_CUSTODY_INTENT_BYTES = 2048
RECEIPT_MARGIN = 4096
INTENT_KIND = 'invented_pdf_result_custody'
RECEIPT_KIND = 'invented_pdf_result_stored'
RECEIPT_KEYS = frozenset(('schema_version', 'kind', 'operation_id', 'artifact_id', 'stored_at',
    'intent_base64', 'packet_base64', 'intent_sha256', 'packet_sha256', 'intent_bytes', 'packet_bytes'))


class PdfResultCustodyError(ValueError):
    """Fixed private refusal; supplied/native unavailability is not quality."""


@dataclass(frozen=True)
class PreparedPdfResultCustody:
    raw: bytes = field(repr=False)
    expected: PdfResultPacketExpected = field(repr=False)
    context: ReopenedPdfRequestContext = field(repr=False)
    result: ReopenedPdfResultPacket = field(repr=False)
    canonical_intent: bytes = field(repr=False)
    statement: str = field(repr=False)
    operation_id: str
    observed_at: datetime
    evidence_state: str = 'invented_pdf_result_custody_prepared_only'


@dataclass(frozen=True)
class ReopenedPdfResultCustody:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    raw_receipt: bytes = field(repr=False)
    raw: bytes = field(repr=False)
    canonical_intent: bytes = field(repr=False)
    expected: PdfResultPacketExpected = field(repr=False)
    context: ReopenedPdfRequestContext = field(repr=False)
    result: ReopenedPdfResultPacket = field(repr=False)
    observed_at: datetime
    evidence_state: str = 'supplied_pdf_result_byte_custody_rederived_only_not_authenticated'


def _b64(raw): return base64.b64encode(raw).decode('ascii')


def _intent(raw, expected):
    if (type(raw) is not bytes or not 1 <= len(raw) <= MAX_CUSTODY_PACKET_BYTES
            or type(expected) is not PdfResultPacketExpected or not _uuid(expected.operation_id)
            or not _digest(expected.packet_sha256) or sha256(raw).hexdigest() != expected.packet_sha256
            or not _digest(expected.output_sha256)):
        raise ValueError
    request = _request_snapshot(expected.request)
    current = expected.current
    previous = expected.previous
    # Native qualification remains the existing cold opener's responsibility;
    # these are the independently supplied exact primitive joins only.
    if (not _digest(current.packet_sha256)
            or previous is not None and not _digest(previous.packet_sha256)):
        raise ValueError
    value = dict(schema_version=1, kind=INTENT_KIND, operation_id=expected.operation_id,
        prepared_at=_stamp(_utc_copy(expected.prepared_at)), packet_bytes=len(raw),
        packet_sha256=expected.packet_sha256, current_packet_sha256=current.packet_sha256,
        previous_packet_sha256=None if previous is None else previous.packet_sha256,
        request_sha256=request.request_sha256, selected_payload_sha256=request.selected_payload_sha256,
        output_sha256=expected.output_sha256)
    intent = _canonical(value)
    if len(intent) > MAX_CUSTODY_INTENT_BYTES:
        raise ValueError
    return intent


def _receipt_shape(operation, intent, packet):
    return dict(schema_version=1, kind=RECEIPT_KIND, operation_id=operation,
        artifact_id='ffffffff-ffff-4fff-bfff-ffffffffffff', stored_at='9999-12-31T23:59:59.999999Z',
        intent_base64=_b64(intent), packet_base64=_b64(packet),
        intent_sha256=sha256(intent).hexdigest(), packet_sha256=sha256(packet).hexdigest(),
        intent_bytes=len(intent), packet_bytes=len(packet))


def _budget(operation, intent, packet):
    if len(json.dumps(_receipt_shape(operation, intent, packet)).encode('utf8')) + RECEIPT_MARGIN > MAX_CAPTURE_OUTPUT:
        raise ValueError


def _statement(intent, packet):
    statement = (HEAD + "set time zone 'UTC';begin isolation level read committed read write;"
        "select tf_pdf_result_rehearsal.store_result(decode(" + _literal(_b64(intent)) + ",'base64'),decode("
        + _literal(_b64(packet)) + ",'base64'));commit;\n\\echo " + COMMIT_MARKER.decode() + '\n')
    if len(statement.encode('utf8')) > MAX_CAPTURE_STATEMENT:
        raise ValueError
    return statement


def prepare_pdf_result_custody(raw: bytes, expected: PdfResultPacketExpected, *,
        observed_at: datetime) -> PreparedPdfResultCustody:
    """Cold-open once, then build one fixed statement; execute nothing here."""
    try:
        # The smaller port bound must precede any child or caller clock hook.
        if type(raw) is not bytes or not 1 <= len(raw) <= MAX_CUSTODY_PACKET_BYTES:
            raise ValueError
        raw, expected, observed_at = thaw_input(freeze_input((raw, expected, observed_at), _RECORDS))
        at = _utc_copy(observed_at)
        intent = _intent(raw, expected)
        if _utc_copy(expected.prepared_at) > at:
            raise ValueError
        _budget(expected.operation_id, intent, raw)
        statement = _statement(intent, raw)
        result = reopen_pdf_result_packet(raw, expected, reopened_at=at)
        return PreparedPdfResultCustody(raw, expected, result.context, result, intent, statement,
                                        expected.operation_id, at)
    except Exception:
        raise PdfResultCustodyError('pdf_result_custody_unavailable') from None


def pdf_result_custody_read_statement(operation_id: str) -> str:
    """One exact operation; no target/schema/role or implicit latest selector."""
    try:
        if not _uuid(operation_id): raise ValueError
        return (HEAD + "set time zone 'UTC';begin isolation level repeatable read read only;"
            "select tf_pdf_result_rehearsal.result_receipt(" + _literal(operation_id)
            + "::uuid);commit;\n\\echo " + COMMIT_MARKER.decode() + '\n')
    except Exception:
        raise PdfResultCustodyError('pdf_result_custody_unavailable') from None


def reopen_pdf_result_custody(raw_receipt: bytes, expected: PdfResultPacketExpected, *,
        intent_raw: bytes, observed_at: datetime) -> ReopenedPdfResultCustody:
    """Verify the complete supplied receipt and independent intent before child.

    A native owning custodian separately establishes that these bytes actually
    came from its fixed committed getter. Matching supplied JSON alone cannot.
    """
    try:
        if (type(raw_receipt) is not bytes or not 1 <= len(raw_receipt) <= MAX_CAPTURE_OUTPUT
                or type(intent_raw) is not bytes or not 1 <= len(intent_raw) <= MAX_CUSTODY_INTENT_BYTES):
            raise ValueError
        raw_receipt, expected, intent_raw, observed_at = thaw_input(freeze_input(
            (raw_receipt, expected, intent_raw, observed_at), _RECORDS))
        at = _utc_copy(observed_at)
        value = strict_json(raw_receipt)
        if (type(value) is not dict or set(value) != RECEIPT_KEYS
                or type(value['schema_version']) is not int or value['schema_version'] != 1
                or value['kind'] != RECEIPT_KIND or not _uuid(value['operation_id'])
                or not _uuid(value['artifact_id'])):
            raise ValueError
        intent = bounded_binary(value['intent_base64'], MAX_CUSTODY_INTENT_BYTES)
        packet = bounded_binary(value['packet_base64'], MAX_CUSTODY_PACKET_BYTES)
        for name, body in (('intent', intent), ('packet', packet)):
            if (type(value[name+'_bytes']) is not int or value[name+'_bytes'] != len(body)
                    or not _digest(value[name+'_sha256']) or value[name+'_sha256'] != sha256(body).hexdigest()):
                raise ValueError
        if (type(expected) is not PdfResultPacketExpected or value['operation_id'] != expected.operation_id
                or intent != intent_raw or intent != _intent(packet, expected)):
            raise ValueError
        stored = _parse_time(value['stored_at'])
        if not _utc_copy(expected.prepared_at) <= stored <= at:
            raise ValueError
        _budget(expected.operation_id, intent, packet)
        result = reopen_pdf_result_packet(packet, expected, reopened_at=at)
        return ReopenedPdfResultCustody(expected.operation_id, value['artifact_id'], stored,
            raw_receipt, packet, intent, expected, result.context, result, at)
    except Exception:
        raise PdfResultCustodyError('pdf_result_custody_unavailable') from None
