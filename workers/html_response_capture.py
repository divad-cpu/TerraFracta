"""Explicit supplied HTML response to private original-bound parsed passages.

Supplied HTTP metadata is consistency evidence, never authenticated transport,
complete framing, a fetch permission or storage proof. A selected source/recipe
binding is still independent. No model, source, database or browser is called.
"""
from dataclasses import dataclass, field
from datetime import datetime
from workers.dispatch_input_snapshot import freeze_input, thaw_input

from workers.fixed_response_envelope import (
    CheckedResponseBody, ExpectedResponseBody, SuppliedResponseEnvelope, check_fixed_response_envelope,
)
from workers.html_passage_binding import (
    HtmlDocumentReceipt, HtmlPassageBinding, HtmlElementSelection, HtmlSelectionMap, BoundHtmlPassages, bind_html_passages,
)
from workers.html_passage_comparison import HtmlPassageCapture


class HtmlResponseError(ValueError):
    """Fixed refusal without headers, URLs, original bytes or parser details."""


@dataclass(frozen=True)
class CheckedHtmlResponse:
    response: CheckedResponseBody = field(repr=False)
    capture: HtmlPassageCapture = field(repr=False)
    bound: BoundHtmlPassages = field(repr=False)
    evidence_state: str = 'supplied_html_response_and_derivation_only'


def bind_supplied_html_response(body: bytes, expected: ExpectedResponseBody,
        envelope: SuppliedResponseEnvelope, *, binding: HtmlPassageBinding,
        mapping: HtmlSelectionMap, observed_at: datetime) -> CheckedHtmlResponse:
    """Recheck raw metadata/body and selection together, without a prebuilt proof.

    The HTML profile must be explicitly selected. The independent source binding
    must match the actual supplied original SHA, endpoint and retrieval instant;
    equal derived text cannot substitute for any of those original identities.
    Old feed/plain-text profiles and their custody/settlement rules are retained.
    """
    try:
        body, expected, envelope, binding, mapping, observed_at = thaw_input(freeze_input(
            (body, expected, envelope, binding, mapping, observed_at),
            (ExpectedResponseBody, SuppliedResponseEnvelope, HtmlPassageBinding, HtmlSelectionMap, HtmlElementSelection)))
        if (type(expected) is not ExpectedResponseBody or expected.profile != 'utf8_html'
                or type(binding) is not HtmlPassageBinding):
            raise ValueError
        response = check_fixed_response_envelope(body, expected, envelope, observed_at=observed_at)
        document = HtmlDocumentReceipt(binding.source_key, binding.item_key, binding.source_version_id,
            response.endpoint, response.content_sha256, response.retrieved_at)
        bound = bind_html_passages(response.body, document, binding=binding, mapping=mapping, observed_at=observed_at)
        capture = HtmlPassageCapture(response.body, document, binding, mapping)
        return CheckedHtmlResponse(response, capture, bound)
    except Exception:
        raise HtmlResponseError('supplied_html_response_unavailable') from None
