"""Reopen a supplied historical PDF request without changing its observation.

Both packet expectations and the independent full request are captured before
any child. The existing request compiler's complete-original inspections also
check packet component bytes, avoiding a second extraction of each original.
This is byte/provenance reproduction, not authenticated storage or a new check
of a source, support, rights, provider or publication status.
"""
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection
from dataclasses import dataclass, field
from datetime import datetime

from workers.pdf_derivation_packet import (
    PdfDerivationPacketExpected, capture_pdf_derivation_packet_inputs,
)
from workers.pdf_passage_binding import BoundPdfPassages
from workers.pdf_passage_comparison import PdfPassageCapture
from workers.pdf_extraction_request import OfflinePdfExtractionRequest, _compile, _request_snapshot
from workers.passage_extraction_request import _tokens


class PdfRequestPacketContextError(ValueError):
    """Curated all-or-nothing refusal, without packet/request/source details."""


@dataclass(frozen=True)
class PdfPacketReference:
    raw: bytes = field(repr=False)
    expected: PdfDerivationPacketExpected = field(repr=False)


@dataclass(frozen=True)
class ReopenedPdfRequestContext:
    current: BoundPdfPassages = field(repr=False)
    previous: BoundPdfPassages | None = field(repr=False)
    request: OfflinePdfExtractionRequest = field(repr=False)
    current_packet_sha256: str
    previous_packet_sha256: str | None
    recorded_observed_at: datetime
    reopened_at: datetime
    evidence_state: str = 'supplied_pdf_request_context_rederived_only_not_stored_or_authorized'


def _reference(value, reopened_at):
    if type(value) is not PdfPacketReference:
        raise ValueError
    return capture_pdf_derivation_packet_inputs(value.raw, value.expected, reopened_at=reopened_at)


def _capture(value):
    data = value.inputs
    return PdfPassageCapture(data.raw, data.document, data.binding, data.mapping)


def _matches(bound, packet):
    if (bound.inspection_report_raw != packet.inspection_raw
            or bound.derivation_manifest_raw != packet.derivation_raw):
        raise ValueError


def reopen_pdf_request_packet_context(current: PdfPacketReference,
        previous: PdfPacketReference | None = None, *, request: OfflinePdfExtractionRequest,
        reopened_at: datetime, maximum_output_tokens: int) -> ReopenedPdfRequestContext:
    """Keep the single original request observation across both full vintages.

    Differing packet observations cannot be normalized into an old request.
    Missing or invalid previous material never becomes a first observation.
    A supplied request must exactly equal the complete regenerated envelope;
    hashing or re-signing altered fields cannot establish an old request.
    """
    try:
        current, previous, request, reopened_at, maximum_output_tokens = thaw_input(freeze_input(
            (current, previous, request, reopened_at, maximum_output_tokens),
            (PdfPacketReference, PdfDerivationPacketExpected, PdfDocumentReceipt, PdfPassageBinding,
             PdfPageSelectionMap, PdfPageSelection, OfflinePdfExtractionRequest)))
        supplied = _request_snapshot(request)
        if not _tokens(maximum_output_tokens) or supplied.maximum_output_tokens != maximum_output_tokens:
            raise ValueError
        now = _reference(current, reopened_at)
        before = None if previous is None else _reference(previous, now.reopened_at)
        recorded = now.inputs.observed_at
        if (supplied.item_key != now.inputs.document.item_key
                or before is not None and before.inputs.observed_at != recorded):
            raise ValueError
        # _compile is the existing typed full-original producer, not a supplied
        # comparison/snapshot port. Its bound results witness both components.
        regenerated, compared = _compile(_capture(now), None if before is None else _capture(before),
                                          recorded, maximum_output_tokens)
        _matches(compared.current, now)
        if before is not None:
            _matches(compared.previous, before)
        if supplied != regenerated:
            raise ValueError
        return ReopenedPdfRequestContext(compared.current, compared.previous, regenerated,
            now.expected.packet_sha256, None if before is None else before.expected.packet_sha256,
            recorded, now.reopened_at)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError, RecursionError):
        raise PdfRequestPacketContextError('pdf_request_packet_context_unavailable') from None
