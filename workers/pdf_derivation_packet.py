"""Private supplied PDF derivation bytes, never a storage or trust receipt.

Reopening rederives the complete original at its recorded observation. A later
reopening time never replaces that historical observation or renews a source
check. Both vintages must retain the same original request observation to reuse
an old complete request; differing observations are not silently normalized.
No path, archive, SQL, transport, model, authentication or publication is chosen.
"""
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import base64

from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.passage_extraction_request import _canonical
from workers.pdf_text_inspection import PdfDocumentReceipt, LIMITS, PARSER_IDENTITY
from workers.pdf_passage_binding import (
    PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection, BoundPdfPassages, PdfPassageInputs, ADAPTER_IDENTITY,
    capture_pdf_passage_inputs, bind_pdf_passages, _checked_report, _utc_copy, _stamp,
)
from workers.pdf_passage_comparison import PdfPassageCapture
from workers.prose_passage_selection import _digest

MAX_DERIVATION_BYTES = 32768
MAX_PACKET_BYTES = 512 * 1024
KIND = 'private_supplied_pdf_derivation_packet'
PART_LIMITS = dict(original=LIMITS['max_input_bytes'], inspection=LIMITS['max_output_bytes'],
                   derivation=MAX_DERIVATION_BYTES)
PACKET_KEYS = frozenset(('schema_version', 'kind', 'recorded_observed_at')) | frozenset(
    f'{part}_{suffix}' for part in PART_LIMITS for suffix in ('base64', 'bytes', 'sha256'))
EXPECTED_KEYS = frozenset(('document', 'binding', 'mapping', 'recorded_observed_at',
                           'packet_sha256', 'inspection_sha256', 'derivation_sha256'))


class PdfDerivationPacketError(ValueError):
    """Fixed private refusal; no original, report, path or parser detail."""


@dataclass(frozen=True)
class PdfDerivationPacketExpected:
    document: PdfDocumentReceipt
    binding: PdfPassageBinding
    mapping: PdfPageSelectionMap
    recorded_observed_at: datetime
    packet_sha256: str
    inspection_sha256: str
    derivation_sha256: str


@dataclass(frozen=True)
class PreparedPdfDerivationPacket:
    raw: bytes = field(repr=False)
    packet_sha256: str
    inspection_sha256: str
    derivation_sha256: str
    recorded_observed_at: datetime
    capture: PdfPassageCapture = field(repr=False)
    result: BoundPdfPassages = field(repr=False)
    evidence_state: str = 'private_supplied_pdf_derivation_packet_only_not_stored_or_authenticated'


@dataclass(frozen=True)
class ReopenedPdfDerivationPacket:
    raw: bytes = field(repr=False)
    packet_sha256: str
    recorded_observed_at: datetime
    reopened_at: datetime
    capture: PdfPassageCapture = field(repr=False)
    result: BoundPdfPassages = field(repr=False)
    evidence_state: str = 'supplied_pdf_packet_rederived_at_recorded_observation_not_current_trust'


@dataclass(frozen=True)
class PdfDerivationPacketInputs:
    raw: bytes = field(repr=False)
    expected: PdfDerivationPacketExpected = field(repr=False)
    inputs: PdfPassageInputs = field(repr=False)
    inspection_raw: bytes = field(repr=False)
    derivation_raw: bytes = field(repr=False)
    reopened_at: datetime


def _capture(capture, at):
    if type(capture) is not PdfPassageCapture:
        raise ValueError
    return capture_pdf_passage_inputs(capture.raw, capture.document, binding=capture.binding,
                                      mapping=capture.mapping, observed_at=at)


def _public_capture(captured):
    return PdfPassageCapture(captured.raw, captured.document, captured.binding, captured.mapping)


def _bind(captured):
    return bind_pdf_passages(captured.raw, captured.document, binding=captured.binding,
                             mapping=captured.mapping, observed_at=captured.observed_at)


def _body(original, result, recorded):
    if type(result) is not BoundPdfPassages:
        raise ValueError
    parts = dict(original=original, inspection=result.inspection_report_raw,
                 derivation=result.derivation_manifest_raw)
    body = dict(schema_version=1, kind=KIND, recorded_observed_at=_stamp(recorded))
    for name, part in parts.items():
        if type(part) is not bytes or not 1 <= len(part) <= PART_LIMITS[name]:
            raise ValueError
        body.update({f'{name}_base64': base64.b64encode(part).decode('ascii'),
                     f'{name}_bytes': len(part), f'{name}_sha256': sha256(part).hexdigest()})
    if (body['inspection_sha256'] != result.inspection_report_sha256
            or body['derivation_sha256'] != result.derivation_manifest_sha256):
        raise ValueError
    raw = _canonical(body)
    if len(raw) > MAX_PACKET_BYTES:
        raise ValueError
    return raw, body


def prepare_pdf_derivation_packet(capture: PdfPassageCapture, *,
        recorded_observed_at: datetime) -> PreparedPdfDerivationPacket:
    """Inspect one complete independent original once; write nothing anywhere."""
    try:
        captured = _capture(capture, recorded_observed_at)
        result = _bind(captured)
        raw, body = _body(captured.raw, result, captured.observed_at)
        return PreparedPdfDerivationPacket(raw, sha256(raw).hexdigest(), body['inspection_sha256'],
            body['derivation_sha256'], captured.observed_at, _public_capture(captured), result)
    except Exception:
        raise PdfDerivationPacketError('pdf_derivation_packet_unavailable') from None


def _packet(raw, expected_sha, recorded):
    if (type(raw) is not bytes or not 1 <= len(raw) <= MAX_PACKET_BYTES
            or sha256(raw).hexdigest() != expected_sha):
        raise ValueError
    value = strict_json(raw)
    if (type(value) is not dict or set(value) != PACKET_KEYS
            or type(value['schema_version']) is not int or value['schema_version'] != 1
            or type(value['kind']) is not str or value['kind'] != KIND
            or value['recorded_observed_at'] != _stamp(recorded) or _canonical(value) != raw):
        raise ValueError
    parts = {}
    for name, maximum in PART_LIMITS.items():
        part = bounded_binary(value[f'{name}_base64'], maximum)
        if (type(value[f'{name}_bytes']) is not int or value[f'{name}_bytes'] != len(part)
                or not _digest(value[f'{name}_sha256'])
                or value[f'{name}_sha256'] != sha256(part).hexdigest()):
            raise ValueError
        parts[name] = part
    return value, parts


def _preflight(parts, captured, inspection_sha):
    """Check retained assertions only; never return/adopt a ready snapshot.

    The actual complete original is still re-inspected after this pure guard.
    Existing report/native validation remains authoritative. The manifest
    projection checks only fixed metadata and whole-page identities, not facts.
    """
    doc = {name: getattr(captured.document, name) for name in ('source_key', 'item_key',
           'source_version_id', 'source_url', 'content_sha256', 'retrieved_at', 'media_type')}
    report, encoded = _checked_report(strict_json(parts['inspection']), captured.raw, doc, captured.observed_at)
    if encoded != parts['inspection'] or report['state'] != 'inspected':
        raise ValueError
    spans = []
    for selected in captured.mapping.selections:
        if selected.page_number > report['page_count']:
            raise ValueError
        page = report['pages'][selected.page_number - 1]
        if page['state'] != 'text_extracted' or page['text_sha256'] != selected.page_text_sha256:
            raise ValueError
        spans.append(dict(locator=selected.locator, page_number=selected.page_number,
            page_text_sha256=selected.page_text_sha256, derived_start_utf8=0,
            derived_end_utf8=len(page['text'].encode('utf8')), derived_text_sha256=selected.page_text_sha256))
    # Exact canonical bytes also close keys/types, including bool/int aliases.
    expected = dict(schema_version=1, adapter_identity=ADAPTER_IDENTITY, parser_identity=PARSER_IDENTITY,
        document=dict(doc, retrieved_at=_stamp(doc['retrieved_at'])), original_bytes=len(captured.raw),
        observed_at=_stamp(captured.observed_at), mapping_sha256=captured.binding.mapping_sha256,
        language_code=captured.binding.language_code, inspection_report_sha256=inspection_sha,
        coverage='selected_native_pdf_pages_only', page_index_kind='physical_1_based',
        offset_space='derived_page_utf8', rendered_visibility_verified=False, spans=spans)
    # Strict parsing refuses duplicate/nonfinite/invalid UTF8 before comparison.
    if _canonical(strict_json(parts['derivation'])) != parts['derivation'] or _canonical(expected) != parts['derivation']:
        raise ValueError


def capture_pdf_derivation_packet_inputs(raw: bytes, expected: PdfDerivationPacketExpected, *,
        reopened_at: datetime) -> PdfDerivationPacketInputs:
    """Pure complete preflight/deep capture; start no PDF child.

    A multi-packet caller must capture every packet and expectation before its
    first reinspection. Supplied proof is checked for consistency, never trusted
    as source/custody authentication or adopted as a prebuilt snapshot.
    """
    try:
        if type(expected) is not PdfDerivationPacketExpected:
            raise ValueError
        raw, expected, reopened_at = thaw_input(freeze_input((raw, expected, reopened_at),
            (PdfDerivationPacketExpected, PdfDocumentReceipt, PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection)))
        fields = dict(vars(expected))
        if set(fields) != EXPECTED_KEYS or any(not _digest(fields[name]) for name in
                ('packet_sha256', 'inspection_sha256', 'derivation_sha256')):
            raise ValueError
        recorded = _utc_copy(fields['recorded_observed_at'])
        reopened = _utc_copy(reopened_at)
        if reopened < recorded:
            raise ValueError
        value, parts = _packet(raw, fields['packet_sha256'], recorded)
        if (value['inspection_sha256'] != fields['inspection_sha256']
                or value['derivation_sha256'] != fields['derivation_sha256']):
            raise ValueError
        captured = capture_pdf_passage_inputs(parts['original'], fields['document'], binding=fields['binding'],
                                              mapping=fields['mapping'], observed_at=recorded)
        _preflight(parts, captured, fields['inspection_sha256'])
        copied = PdfDerivationPacketExpected(captured.document, captured.binding, captured.mapping, recorded,
            fields['packet_sha256'], fields['inspection_sha256'], fields['derivation_sha256'])
        return PdfDerivationPacketInputs(raw, copied, captured, parts['inspection'], parts['derivation'], reopened)
    except Exception:
        raise PdfDerivationPacketError('pdf_derivation_packet_unavailable') from None


def reopen_pdf_derivation_packet(raw: bytes, expected: PdfDerivationPacketExpected, *,
        reopened_at: datetime) -> ReopenedPdfDerivationPacket:
    """Reinspect once at the recorded time; choose no storage/current trust."""
    try:
        frozen = capture_pdf_derivation_packet_inputs(raw, expected, reopened_at=reopened_at)
        result = _bind(frozen.inputs)
        if (result.inspection_report_raw != frozen.inspection_raw
                or result.derivation_manifest_raw != frozen.derivation_raw):
            raise ValueError
        return ReopenedPdfDerivationPacket(frozen.raw, frozen.expected.packet_sha256,
            frozen.expected.recorded_observed_at, frozen.reopened_at, _public_capture(frozen.inputs), result)
    except Exception:
        raise PdfDerivationPacketError('pdf_derivation_packet_unavailable') from None
