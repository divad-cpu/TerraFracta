"""Supplied binary response consistency -> typed selected native PDF pages.

This composes existing guards on already supplied bytes. Independent document
and page-map assertions must match the exact response identity and retrieval;
no source/transport authentication, rights, storage, fetch or publication follows.
"""
from dataclasses import dataclass, field
from datetime import datetime

from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.fixed_response_envelope import (
    ExpectedResponseBody, SuppliedResponseEnvelope, CheckedResponseBody, check_fixed_response_envelope,
)
from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import (
    PdfPassageBinding, PdfPageSelection, PdfPageSelectionMap, BoundPdfPassages, bind_pdf_passages,
)
from workers.pdf_passage_comparison import PdfPassageCapture


class PdfResponseBindingError(ValueError):
    """Fixed all-or-nothing refusal; never a source/transport-quality verdict."""


@dataclass(frozen=True)
class BoundPdfResponse:
    response: CheckedResponseBody = field(repr=False)
    capture: PdfPassageCapture = field(repr=False)
    result: BoundPdfPassages = field(repr=False)
    observed_at: datetime
    evidence_state: str = 'supplied_pdf_response_and_native_pages_only_not_transport_authenticated'


def bind_pdf_response(body: bytes, expected: ExpectedResponseBody, envelope: SuppliedResponseEnvelope, *,
        document: PdfDocumentReceipt, binding: PdfPassageBinding, mapping: PdfPageSelectionMap,
        observed_at: datetime) -> BoundPdfResponse:
    """Capture both HTTP and PDF intent before any clock or parser callback."""
    try:
        body, expected, envelope, document, binding, mapping, observed_at = thaw_input(freeze_input(
            (body, expected, envelope, document, binding, mapping, observed_at),
            (ExpectedResponseBody, SuppliedResponseEnvelope, PdfDocumentReceipt,
             PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection)))
        if type(expected) is not ExpectedResponseBody or expected.profile != 'native_pdf' or type(document) is not PdfDocumentReceipt:
            raise ValueError
        response = check_fixed_response_envelope(body, expected, envelope, observed_at=observed_at)
        if (response.endpoint != document.source_url or response.content_sha256 != document.content_sha256
                or response.retrieved_at != document.retrieved_at or response.media_type != document.media_type):
            raise ValueError
        result = bind_pdf_passages(response.body, document, binding=binding, mapping=mapping, observed_at=observed_at)
        return BoundPdfResponse(response, PdfPassageCapture(response.body, result.document, binding, mapping), result, observed_at)
    except Exception:
        raise PdfResponseBindingError('pdf_response_binding_unavailable') from None
