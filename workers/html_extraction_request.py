"""Compile selected HTML parsed text into a private offline request, never a call.

Reuses the established extraction instruction/schema and strict proposal parser.
Original HTML and both derivation witnesses remain bound on every use. Caller
assertions about token bounds do not measure a provider or qualify source,
recipe, language, factual support, current rights, custody or publication.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import json

from workers.html_passage_comparison import HtmlPassageCapture, compare_html_passages
from workers.model_proposal import ModelProposal, MAX_OUTPUT_BYTES
from workers.passage_extraction_request import (
    INSTRUCTIONS, MAX_REQUEST_BYTES, FullRequestTokenLimit,
    _canonical, _output_schema, _tokens,
)
from workers.passage_model_plan import PassageTokenLimit
from workers.passage_model_proposal import parse_changed_passage_proposal

TEMPLATE_ID = 'tf-private-html-passage-extraction-1'


class HtmlExtractionRequestError(ValueError):
    """Fixed private refusal without evidence, source, request or parser text."""


@dataclass(frozen=True)
class OfflineHtmlExtractionRequest:
    item_key: str
    body: bytes = field(repr=False)
    request_sha256: str
    selected_payload_sha256: str
    maximum_output_tokens: int
    evidence_state: str = 'offline_html_complete_extraction_envelope_only'


def _compile(current, previous, observed_at, maximum_output_tokens):
    if not _tokens(maximum_output_tokens):
        raise ValueError
    compared = compare_html_passages(current, previous, observed_at=observed_at)
    selected = compared.selection
    if selected.state != 'ready' or selected.payload is None:
        raise ValueError
    payload = json.loads(selected.payload)
    body = _canonical(dict(schema_version=1, kind='private_offline_html_extraction_request',
        template_id=TEMPLATE_ID, instructions=INSTRUCTIONS, selected_payload=payload,
        selected_payload_sha256=selected.payload_sha256,
        html_provenance=dict(adapter_identity=compared.current.adapter_identity,
            current_derivation_sha256=compared.current.derivation_manifest_sha256,
            previous_derivation_sha256=None if compared.previous is None else compared.previous.derivation_manifest_sha256,
            coverage=compared.current.coverage, rendered_visibility_verified=False),
        output_schema=_output_schema(payload), maximum_output_bytes=MAX_OUTPUT_BYTES,
        maximum_output_tokens=maximum_output_tokens))
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError
    return OfflineHtmlExtractionRequest(payload['item_key'], body, sha256(body).hexdigest(),
                                        selected.payload_sha256, maximum_output_tokens), compared


def compile_html_extraction_request(current: HtmlPassageCapture,
        previous: HtmlPassageCapture | None = None, *, observed_at: datetime,
        maximum_output_tokens: int) -> OfflineHtmlExtractionRequest:
    try:
        return _compile(current, previous, observed_at, maximum_output_tokens)[0]
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise HtmlExtractionRequestError('html_extraction_request_unavailable') from None


def _regenerate(request, current, previous, observed_at, maximum_output_tokens):
    try:
        if (type(request) is not OfflineHtmlExtractionRequest or type(request.body) is not bytes
                or any(type(value) is not str for value in (request.item_key, request.request_sha256,
                    request.selected_payload_sha256, request.evidence_state))
                or not _tokens(request.maximum_output_tokens)):
            raise ValueError
        expected, compared = _compile(current, previous, observed_at, maximum_output_tokens)
        if request != expected:
            raise ValueError
        return compared
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise HtmlExtractionRequestError('html_extraction_request_binding_mismatch') from None


def bind_html_full_request_token_limit(request: OfflineHtmlExtractionRequest, *,
        current: HtmlPassageCapture, previous: HtmlPassageCapture | None,
        observed_at: datetime, maximum_output_tokens: int,
        proof: FullRequestTokenLimit) -> PassageTokenLimit:
    """The unchanged offline cost planner still decides every reservation."""
    _regenerate(request, current, previous, observed_at, maximum_output_tokens)
    if (type(proof) is not FullRequestTokenLimit or type(proof.item_key) is not str
            or proof.item_key != request.item_key or type(proof.request_sha256) is not str
            or proof.request_sha256 != request.request_sha256 or not _tokens(proof.maximum_input_tokens)):
        raise HtmlExtractionRequestError('html_extraction_full_token_binding_mismatch')
    return PassageTokenLimit(request.item_key, request.selected_payload_sha256, proof.maximum_input_tokens)


def parse_html_extraction_proposal(raw: bytes, request: OfflineHtmlExtractionRequest, *,
        current: HtmlPassageCapture, previous: HtmlPassageCapture | None,
        observed_at: datetime, maximum_output_tokens: int) -> ModelProposal:
    """Only changed exact locators; a structurally valid result stays unverified."""
    compared = _regenerate(request, current, previous, observed_at, maximum_output_tokens)
    return parse_changed_passage_proposal(raw, current=compared.current.snapshot,
        previous=None if compared.previous is None else compared.previous.snapshot,
        expected_payload_sha256=request.selected_payload_sha256)
