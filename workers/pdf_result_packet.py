"""Portable private PDF result bytes, not a stored or approved model result.

Each preparation/reopening rederives every complete original once through the
existing historical request context, then parses raw output against its actual
changed selected passages. No parsed proposal is admitted from the packet.
Recorded observation, preparation and separate reopening times are distinct.
No path, backend, provider, authentication, rights or publication is selected.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import base64

from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.feed_postgres_contract import _uuid
from workers.model_proposal import ModelProposal, MAX_OUTPUT_BYTES
from workers.passage_extraction_request import _canonical, MAX_REQUEST_BYTES
from workers.passage_model_proposal import parse_changed_passage_proposal
from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import (
    PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection, _utc_copy, _stamp,
)
from workers.pdf_derivation_packet import PdfDerivationPacketExpected, MAX_PACKET_BYTES
from workers.pdf_extraction_request import OfflinePdfExtractionRequest, _request_snapshot
from workers.pdf_request_packet_context import (
    PdfPacketReference, ReopenedPdfRequestContext, reopen_pdf_request_packet_context,
)
from workers.prose_passage_selection import _digest

MAX_RESULT_PACKET_BYTES = 2 * 1024 * 1024
KIND = 'private_supplied_pdf_result_packet'
KEYS = frozenset(('schema_version', 'kind', 'operation_id', 'prepared_at',
                  'current', 'previous', 'request', 'output'))
PART_KEYS = frozenset(('base64', 'bytes', 'sha256'))


class PdfResultPacketError(ValueError):
    """Fixed private refusal, never output/original/request/parser details."""


@dataclass(frozen=True)
class PdfResultPacketExpected:
    current: PdfDerivationPacketExpected = field(repr=False)
    previous: PdfDerivationPacketExpected | None = field(repr=False)
    request: OfflinePdfExtractionRequest = field(repr=False)
    output_sha256: str
    packet_sha256: str
    operation_id: str
    prepared_at: datetime


@dataclass(frozen=True)
class PreparedPdfResultPacket:
    raw: bytes = field(repr=False)
    packet_sha256: str
    output_sha256: str
    operation_id: str
    prepared_at: datetime
    context: ReopenedPdfRequestContext = field(repr=False)
    output_raw: bytes = field(repr=False)
    proposal: ModelProposal = field(repr=False)
    evidence_state: str = 'private_supplied_pdf_result_packet_only_not_stored_or_authorized'


@dataclass(frozen=True)
class ReopenedPdfResultPacket:
    raw: bytes = field(repr=False)
    packet_sha256: str
    output_sha256: str
    operation_id: str
    prepared_at: datetime
    reopened_at: datetime
    context: ReopenedPdfRequestContext = field(repr=False)
    output_raw: bytes = field(repr=False)
    proposal: ModelProposal = field(repr=False)
    evidence_state: str = 'supplied_pdf_result_rederived_and_proposal_unverified_only'


_RECORDS = (PdfPacketReference, PdfDerivationPacketExpected, PdfDocumentReceipt,
            PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection,
            OfflinePdfExtractionRequest, PdfResultPacketExpected)


def _part(raw, maximum):
    if type(raw) is not bytes or not 1 <= len(raw) <= maximum:
        raise ValueError
    return dict(base64=base64.b64encode(raw).decode('ascii'), bytes=len(raw),
                sha256=sha256(raw).hexdigest())


def _read_part(value, maximum):
    if type(value) is not dict or set(value) != PART_KEYS:
        raise ValueError
    raw = bounded_binary(value['base64'], maximum)
    if (type(value['bytes']) is not int or value['bytes'] != len(raw)
            or not _digest(value['sha256']) or value['sha256'] != sha256(raw).hexdigest()):
        raise ValueError
    return raw


def _request_wire(request):
    # The exact existing request, including independent metadata, is retained.
    return dict(item_key=request.item_key, body=_part(request.body, MAX_REQUEST_BYTES),
        request_sha256=request.request_sha256, selected_payload_sha256=request.selected_payload_sha256,
        maximum_output_tokens=request.maximum_output_tokens, evidence_state=request.evidence_state)


def _reference(value):
    if type(value) is not PdfPacketReference or type(value.expected) is not PdfDerivationPacketExpected:
        raise ValueError
    part = _part(value.raw, MAX_PACKET_BYTES)
    if not _digest(value.expected.packet_sha256) or part['sha256'] != value.expected.packet_sha256:
        raise ValueError
    return part


def _times(current, previous, prepared_at, reopened_at):
    if type(current) is not PdfDerivationPacketExpected:
        raise ValueError
    if previous is not None and type(previous) is not PdfDerivationPacketExpected:
        raise ValueError
    recorded = _utc_copy(current.recorded_observed_at)
    prepared = _utc_copy(prepared_at); reopened = _utc_copy(reopened_at)
    if not recorded <= prepared <= reopened:
        raise ValueError
    if previous is not None and _utc_copy(previous.recorded_observed_at) != recorded:
        raise ValueError
    return prepared, reopened


def _body(current, previous, request, output_raw, operation_id, prepared):
    if not _uuid(operation_id):
        raise ValueError
    body = dict(schema_version=1, kind=KIND, operation_id=operation_id,
        prepared_at=_stamp(prepared), current=_reference(current),
        previous=None if previous is None else _reference(previous),
        request=_request_wire(request), output=_part(output_raw, MAX_OUTPUT_BYTES))
    raw = _canonical(body)
    if len(raw) > MAX_RESULT_PACKET_BYTES:
        raise ValueError
    return raw


def _evaluate(current, previous, request, output_raw, at):
    context = reopen_pdf_request_packet_context(current, previous, request=request,
        reopened_at=at, maximum_output_tokens=request.maximum_output_tokens)
    proposal = parse_changed_passage_proposal(output_raw, current=context.current.snapshot,
        previous=None if context.previous is None else context.previous.snapshot,
        expected_payload_sha256=context.request.selected_payload_sha256)
    return context, proposal


def prepare_pdf_result_packet(current: PdfPacketReference, previous: PdfPacketReference | None = None, *,
        request: OfflinePdfExtractionRequest, output_raw: bytes, operation_id: str,
        prepared_at: datetime) -> PreparedPdfResultPacket:
    """Retain raw output only after actual full-original context and parsing.

    Input assertions are copied before any supplied timezone callback. The
    packet is an in-memory carrier, not a durable receipt or provider response.
    """
    try:
        current, previous, request, output_raw, operation_id, prepared_at = thaw_input(freeze_input(
            (current, previous, request, output_raw, operation_id, prepared_at), _RECORDS))
        request = _request_snapshot(request)
        if type(current) is not PdfPacketReference or previous is not None and type(previous) is not PdfPacketReference:
            raise ValueError
        prepared, _ = _times(current.expected, None if previous is None else previous.expected,
                             prepared_at, prepared_at)
        raw = _body(current, previous, request, output_raw, operation_id, prepared)
        context, proposal = _evaluate(current, previous, request, output_raw, prepared)
        return PreparedPdfResultPacket(raw, sha256(raw).hexdigest(), sha256(output_raw).hexdigest(),
            operation_id, prepared, context, output_raw, proposal)
    except Exception:
        raise PdfResultPacketError('pdf_result_packet_unavailable') from None


def reopen_pdf_result_packet(raw: bytes, expected: PdfResultPacketExpected, *,
        reopened_at: datetime) -> ReopenedPdfResultPacket:
    """Reproduce the historical request and parse output anew, never adopt it.

    Every expected identity is independently supplied; packet fields cannot
    manufacture a source/recipe/request/output expectation or stored authority.
    """
    try:
        if type(raw) is not bytes or not 1 <= len(raw) <= MAX_RESULT_PACKET_BYTES or type(expected) is not PdfResultPacketExpected:
            raise ValueError
        raw, expected, reopened_at = thaw_input(freeze_input((raw, expected, reopened_at), _RECORDS))
        if (not _digest(expected.packet_sha256) or sha256(raw).hexdigest() != expected.packet_sha256
                or not _digest(expected.output_sha256) or not _uuid(expected.operation_id)):
            raise ValueError
        request = _request_snapshot(expected.request)
        prepared, reopened = _times(expected.current, expected.previous, expected.prepared_at, reopened_at)
        body = strict_json(raw)
        if (type(body) is not dict or set(body) != KEYS or type(body['schema_version']) is not int
                or body['schema_version'] != 1 or body['kind'] != KIND
                or body['operation_id'] != expected.operation_id or body['prepared_at'] != _stamp(prepared)
                or _canonical(body) != raw or _canonical(body['request']) != _canonical(_request_wire(request))):
            raise ValueError
        current = PdfPacketReference(_read_part(body['current'], MAX_PACKET_BYTES), expected.current)
        if body['previous'] is None:
            if expected.previous is not None: raise ValueError
            previous = None
        else:
            if expected.previous is None: raise ValueError
            previous = PdfPacketReference(_read_part(body['previous'], MAX_PACKET_BYTES), expected.previous)
        output_raw = _read_part(body['output'], MAX_OUTPUT_BYTES)
        if sha256(output_raw).hexdigest() != expected.output_sha256:
            raise ValueError
        # This also compares both independently expected packet hashes before
        # entering the existing full-original rederivation once.
        if _body(current, previous, request, output_raw, expected.operation_id, prepared) != raw:
            raise ValueError
        context, proposal = _evaluate(current, previous, request, output_raw, reopened)
        return ReopenedPdfResultPacket(raw, expected.packet_sha256, expected.output_sha256,
            expected.operation_id, prepared, reopened, context, output_raw, proposal)
    except Exception:
        raise PdfResultPacketError('pdf_result_packet_unavailable') from None
