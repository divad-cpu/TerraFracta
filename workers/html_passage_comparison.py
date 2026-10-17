"""Rebind complete supplied HTML vintages before comparing selected parsed text.

Pure offline composition. Parsed-source equality covers only the independently
selected elements and is not rendered visibility, source publication order,
current rights, factual support, model dispatch or publication eligibility.
"""
from dataclasses import dataclass, field
from datetime import datetime

from workers.html_passage_binding import (
    HtmlDocumentReceipt, HtmlPassageBinding, HtmlSelectionMap,
    BoundHtmlPassages, bind_html_passages,
)
from workers.passage_model_plan import PassageChange
from workers.prose_passage_selection import PassageSelection, select_changed_passages


class HtmlComparisonError(ValueError):
    """Curated refusal, without original text, URLs, parser details or paths."""


@dataclass(frozen=True)
class HtmlPassageCapture:
    raw: bytes = field(repr=False)
    document: HtmlDocumentReceipt
    binding: HtmlPassageBinding
    mapping: HtmlSelectionMap


@dataclass(frozen=True)
class HtmlPassageComparison:
    current: BoundHtmlPassages
    previous: BoundHtmlPassages | None
    source_bytes_changed: bool | None
    selection: PassageSelection
    change: PassageChange
    evidence_state: str = 'offline_html_selected_text_comparison_only'


def _bind(capture, observed_at):
    if type(capture) is not HtmlPassageCapture:
        raise ValueError
    return bind_html_passages(capture.raw, capture.document, binding=capture.binding,
                              mapping=capture.mapping, observed_at=observed_at)


def compare_html_passages(current: HtmlPassageCapture,
        previous: HtmlPassageCapture | None = None, *, observed_at: datetime):
    """Invalid/missing selection or prior evidence never becomes a new baseline.

    Every use rederives both original envelopes. Receipt equality or a prebuilt
    snapshot cannot substitute for original bytes. Changing the chosen element
    identity under the same recipe requires independent review; byte offsets,
    markup and document versions may change while that selection stays fixed.
    """
    try:
        now = _bind(current, observed_at)
        before = None if previous is None else _bind(previous, observed_at)
        if before is not None:
            if (any(getattr(now.document, key) != getattr(before.document, key)
                    for key in ('source_key', 'item_key', 'source_url'))
                    or now.document.retrieved_at < before.document.retrieved_at
                    or current.mapping.selections != previous.mapping.selections):
                raise ValueError
            if now.document.content_sha256 == before.document.content_sha256 and current.raw != previous.raw:
                raise ValueError
        selected = select_changed_passages(now.snapshot, None if before is None else before.snapshot)
        return HtmlPassageComparison(now, before,
            None if before is None else current.raw != previous.raw, selected,
            PassageChange(now.snapshot, None if before is None else before.snapshot))
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise HtmlComparisonError('html_comparison_unavailable') from None
