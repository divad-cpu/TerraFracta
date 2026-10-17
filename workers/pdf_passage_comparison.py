"""Compare selected native PDF pages by rebinding both complete originals.

Physical-page selection is explicit and stable under the same mapping recipe.
Exact derived text equality only skips repeated selected-page model input; it
never establishes visual/table/OCR completeness, factual support or rights.
"""
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from dataclasses import dataclass, field
from datetime import datetime

from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import (
    PdfPassageBinding, PdfPageSelectionMap, BoundPdfPassages, bind_pdf_passages,
    capture_pdf_passage_inputs, PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection,
)
from workers.prose_passage_selection import PassageSelection, select_changed_passages
from workers.passage_model_plan import PassageChange


class PdfComparisonError(ValueError):
    """All-or-nothing refusal without source, parser or private text details."""


@dataclass(frozen=True)
class PdfPassageCapture:
    raw: bytes = field(repr=False)
    document: PdfDocumentReceipt
    binding: PdfPassageBinding
    mapping: PdfPageSelectionMap


@dataclass(frozen=True)
class PdfPassageComparison:
    current: BoundPdfPassages
    previous: BoundPdfPassages | None
    source_bytes_changed: bool | None
    selection: PassageSelection
    change: PassageChange
    evidence_state: str = 'offline_selected_native_pdf_pages_comparison_only'


def _capture(value, observed_at):
    if type(value) is not PdfPassageCapture:
        raise ValueError
    # Admit and copy every nested primitive before either owned worker starts.
    return capture_pdf_passage_inputs(value.raw, value.document, binding=value.binding,
                                      mapping=value.mapping, observed_at=observed_at)


def _bind(capture, observed_at):
    return bind_pdf_passages(capture.raw, capture.document, binding=capture.binding,
                             mapping=capture.mapping, observed_at=observed_at)


def compare_pdf_passages(current: PdfPassageCapture,
        previous: PdfPassageCapture | None = None, *, observed_at: datetime):
    """Prebuilt reports/snapshots cannot replace either complete byte envelope.

    Both original vintages receive their own fixed bounded inspection. A failed
    previous envelope is not absence of a baseline. The wrapper does not extend
    either original worker deadline, dispatch a model or persist any checkpoint.
    Expected page-text hashes can change with the source; changing an ordered
    locator/physical-page identity under the same recipe requires review.
    """
    try:
        current, previous, observed_at = thaw_input(freeze_input((current, previous, observed_at),
            (PdfPassageCapture, PdfDocumentReceipt, PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection)))
        current = _capture(current, observed_at)
        previous = None if previous is None else _capture(previous, current.observed_at)
        now = _bind(current, current.observed_at)
        before = None if previous is None else _bind(previous, current.observed_at)
        if before is not None:
            if (any(getattr(now.document, key) != getattr(before.document, key)
                    for key in ('source_key', 'item_key', 'source_url'))
                    or now.document.retrieved_at < before.document.retrieved_at
                    or tuple((p.locator, p.page_number) for p in now.spans)
                    != tuple((p.locator, p.page_number) for p in before.spans)):
                raise ValueError
            if (now.document.content_sha256 == before.document.content_sha256
                    and current.raw != previous.raw):
                raise ValueError
        selected = select_changed_passages(now.snapshot, None if before is None else before.snapshot)
        return PdfPassageComparison(now, before,
            None if before is None else current.raw != previous.raw, selected,
            PassageChange(now.snapshot, None if before is None else before.snapshot))
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise PdfComparisonError('pdf_comparison_unavailable') from None
