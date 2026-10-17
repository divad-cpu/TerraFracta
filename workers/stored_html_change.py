"""Join two independently selected retained HTML receipts to offline planning.

Both originals are mandatory and fully reopened against separately retained
intent/source/recipe/artifact expectations. No failed prior becomes a first
observation. Matching receipt bytes are not authentication, current qualification,
rights, semantic support, a model dispatch or publication permission.
"""
from dataclasses import dataclass, field
from datetime import datetime

from workers.html_original_custody import (
    HtmlOriginalReopenExpected, StoredHtmlOriginal, reopen_html_original,
)
from workers.html_passage_comparison import (
    HtmlPassageCapture, HtmlPassageComparison, compare_html_passages,
)
from workers.html_extraction_request import OfflineHtmlExtractionRequest, compile_html_extraction_request


class StoredHtmlChangeError(ValueError):
    """Whole private comparison unavailable; no original or receipt details."""


@dataclass(frozen=True)
class StoredHtmlChange:
    current: StoredHtmlOriginal = field(repr=False)
    previous: StoredHtmlOriginal = field(repr=False)
    current_capture: HtmlPassageCapture = field(repr=False)
    previous_capture: HtmlPassageCapture = field(repr=False)
    comparison: HtmlPassageComparison = field(repr=False)
    evidence_state: str = 'invented_retained_html_pair_comparison_still_unqualified'


@dataclass(frozen=True)
class StoredHtmlExtractionPlan:
    change: StoredHtmlChange = field(repr=False)
    request: OfflineHtmlExtractionRequest = field(repr=False)
    evidence_state: str = 'invented_retained_html_pair_offline_request_only'


def _capture(receipt, expected, observed_at):
    if type(receipt) is not bytes or type(expected) is not HtmlOriginalReopenExpected:
        raise ValueError
    stored = reopen_html_original(receipt, expected, observed_at=observed_at)
    return stored, HtmlPassageCapture(stored.raw, expected.document, expected.binding, expected.mapping)


def prepare_stored_html_change(current_receipt: bytes, current_expected: HtmlOriginalReopenExpected,
        previous_receipt: bytes, previous_expected: HtmlOriginalReopenExpected, *, observed_at: datetime) -> StoredHtmlChange:
    """No caller-built bound snapshot substitutes for either exact stored original."""
    try:
        current, now = _capture(current_receipt, current_expected, observed_at)
        previous, before = _capture(previous_receipt, previous_expected, observed_at)
        compared = compare_html_passages(now, before, observed_at=observed_at)
        return StoredHtmlChange(current, previous, now, before, compared)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise StoredHtmlChangeError('stored_html_change_unavailable') from None


def compile_stored_html_request(current_receipt: bytes, current_expected: HtmlOriginalReopenExpected,
        previous_receipt: bytes, previous_expected: HtmlOriginalReopenExpected, *,
        observed_at: datetime, maximum_output_tokens: int) -> StoredHtmlExtractionPlan:
    """Reopen both receipts anew; unchanged selected text has no request."""
    try:
        change = prepare_stored_html_change(current_receipt, current_expected,
            previous_receipt, previous_expected, observed_at=observed_at)
        request = compile_html_extraction_request(change.current_capture, change.previous_capture,
            observed_at=observed_at, maximum_output_tokens=maximum_output_tokens)
        return StoredHtmlExtractionPlan(change, request)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise StoredHtmlChangeError('stored_html_request_unavailable') from None
