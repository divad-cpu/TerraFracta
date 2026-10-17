"""Compare two complete exact-byte original documents without losing receipts.

Pure offline mechanics. Retrieval order is not source publication order, current
rights, factual truth, editorial acceptance or permission to call/publish. URL
changes require explicit identity review, never inferred redirects/canonicality.
"""
from dataclasses import dataclass,field
from datetime import datetime

from workers.document_passage_binding import (
    PlainDocumentReceipt,DocumentPassageBinding,DocumentSpanMap,BoundDocumentPassages,bind_document_passages,
)
from workers.passage_model_plan import PassageChange
from workers.prose_passage_selection import PassageSelection,select_changed_passages


class DocumentComparisonError(ValueError):pass


@dataclass(frozen=True)
class DocumentPassageCapture:
    raw: bytes = field(repr=False)
    document: PlainDocumentReceipt
    binding: DocumentPassageBinding
    mapping: DocumentSpanMap


@dataclass(frozen=True)
class DocumentPassageComparison:
    current: BoundDocumentPassages
    previous: BoundDocumentPassages | None
    source_bytes_changed: bool | None
    selection: PassageSelection
    change: PassageChange
    evidence_state: str = 'offline_original_document_comparison_only'


def _bind(capture,observed_at):
    if type(capture) is not DocumentPassageCapture:raise ValueError
    return bind_document_passages(capture.raw,capture.document,binding=capture.binding,mapping=capture.mapping,observed_at=observed_at)


def compare_document_passages(current: DocumentPassageCapture,previous: DocumentPassageCapture | None=None,*,observed_at: datetime):
    """Never accept prebuilt snapshots/bindings in place of original bytes.

    Both envelopes are complete and independently rebound, or the entire prior
    envelope is absent. A failed prior envelope is not a first-observation retry.
    Existing recipe/language/version/locator-removal/token/rights gates retain
    their authority. The returned change is for the existing offline planner.
    """
    try:
        now=_bind(current,observed_at)
        before=None if previous is None else _bind(previous,observed_at)
        if before is not None:
            if (any(getattr(now.document,key)!=getattr(before.document,key) for key in ('source_key','item_key','source_url'))
                    or now.document.retrieved_at<before.document.retrieved_at):
                raise ValueError
            if now.document.content_sha256==before.document.content_sha256 and current.raw!=previous.raw:
                raise ValueError
        selected=select_changed_passages(now.snapshot,None if before is None else before.snapshot)
        return DocumentPassageComparison(now,before,None if before is None else current.raw!=previous.raw,
            selected,PassageChange(now.snapshot,None if before is None else before.snapshot))
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise DocumentComparisonError('document_comparison_unavailable') from None
