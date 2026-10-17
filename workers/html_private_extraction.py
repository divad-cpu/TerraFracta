"""Bind supplied unverified output to a complete request and two retained HTMLs.

This pure packet is not a stored extraction result, authenticated provider
response, usage/cost settlement, feed completion, factual acceptance or public
writer. Both originals and the exact request are reconfirmed on every use.
"""
from dataclasses import dataclass, asdict, field
from datetime import datetime
from hashlib import sha256
import base64

from workers.html_original_custody import HtmlOriginalReopenExpected
from workers.html_extraction_request import OfflineHtmlExtractionRequest, parse_html_extraction_proposal
from workers.stored_html_change import StoredHtmlExtractionPlan, compile_stored_html_request
from workers.model_proposal import ModelProposal
from workers.feed_postgres_contract import _uuid, _utc, _time
from workers.passage_extraction_request import _canonical

MAX_HTML_PRIVATE_EXTRACTION_BYTES = 256 * 1024


class HtmlPrivateExtractionError(ValueError):
    """Fixed private refusal; no source, model, receipt or request is exposed."""


@dataclass(frozen=True)
class HtmlPrivateExtraction:
    current_receipt: bytes = field(repr=False)
    current_expected: HtmlOriginalReopenExpected = field(repr=False)
    previous_receipt: bytes = field(repr=False)
    previous_expected: HtmlOriginalReopenExpected = field(repr=False)
    plan: StoredHtmlExtractionPlan = field(repr=False)
    output_raw: bytes = field(repr=False)
    proposal: ModelProposal = field(repr=False)
    operation_id: str
    prepared_at: datetime
    observed_at: datetime
    maximum_output_tokens: int
    canonical_input: bytes = field(repr=False)
    evidence_state: str = 'invented_retained_html_exact_request_output_unverified_unstored'


def _original(stored):
    return dict(operation_id=stored.operation_id, artifact_id=stored.artifact_id,
        stored_at=_time(stored.stored_at), source_version_id=stored.result.document.source_version_id,
        content_sha256=stored.result.document.content_sha256,
        metadata_sha256=sha256(stored.canonical_metadata).hexdigest(),
        derivation_manifest_sha256=stored.result.derivation_manifest_sha256)


def prepare_html_private_extraction(current_receipt: bytes, current_expected: HtmlOriginalReopenExpected,
        previous_receipt: bytes, previous_expected: HtmlOriginalReopenExpected, *,
        request: OfflineHtmlExtractionRequest, output_raw: bytes, operation_id: str,
        prepared_at: datetime, observed_at: datetime, maximum_output_tokens: int) -> HtmlPrivateExtraction:
    """The preparer independently supplies immutable intent time and both vintages."""
    try:
        if not _uuid(operation_id) or not _utc(prepared_at) or not _utc(observed_at) or prepared_at > observed_at:
            raise ValueError
        plan = compile_stored_html_request(current_receipt, current_expected, previous_receipt,
            previous_expected, observed_at=observed_at, maximum_output_tokens=maximum_output_tokens)
        current, previous = plan.change.current, plan.change.previous
        if (prepared_at < max(current.stored_at, previous.stored_at)
                or current.operation_id == previous.operation_id or current.artifact_id == previous.artifact_id
                or request != plan.request):
            raise ValueError
        proposal = parse_html_extraction_proposal(output_raw, request, current=plan.change.current_capture,
            previous=plan.change.previous_capture, observed_at=observed_at, maximum_output_tokens=maximum_output_tokens)
        if proposal.review_state != 'unverified':
            raise ValueError
        body = _canonical(dict(schema_version=1, kind='invented_html_private_extraction_intent',
            operation_id=operation_id, prepared_at=_time(prepared_at), current_original=_original(current),
            previous_original=_original(previous), request_sha256=request.request_sha256,
            selected_payload_sha256=request.selected_payload_sha256, maximum_output_tokens=maximum_output_tokens,
            request_base64=base64.b64encode(request.body).decode('ascii'),
            output_sha256=sha256(output_raw).hexdigest(), output_base64=base64.b64encode(output_raw).decode('ascii'),
            proposal=asdict(proposal)))
        if len(body) > MAX_HTML_PRIVATE_EXTRACTION_BYTES:
            raise ValueError
        return HtmlPrivateExtraction(current_receipt, current_expected, previous_receipt, previous_expected,
            plan, output_raw, proposal, operation_id, prepared_at, observed_at, maximum_output_tokens, body)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise HtmlPrivateExtractionError('html_private_extraction_unavailable') from None


def recheck_html_private_extraction(expected: HtmlPrivateExtraction) -> HtmlPrivateExtraction:
    """No mutated prebuilt packet, proposal or plan can replace the originals."""
    try:
        if type(expected) is not HtmlPrivateExtraction or type(expected.canonical_input) is not bytes:
            raise ValueError
        checked = prepare_html_private_extraction(expected.current_receipt, expected.current_expected,
            expected.previous_receipt, expected.previous_expected, request=expected.plan.request,
            output_raw=expected.output_raw, operation_id=expected.operation_id, prepared_at=expected.prepared_at,
            observed_at=expected.observed_at, maximum_output_tokens=expected.maximum_output_tokens)
        if checked != expected:
            raise ValueError
        return checked
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise HtmlPrivateExtractionError('html_private_extraction_unavailable') from None
