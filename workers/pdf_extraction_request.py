"""A complete private PDF-page extraction envelope, never a model call.

Both full originals are rebound through the typed PDF comparison on compilation
and reuse. Existing instructions/schema/token and strict untrusted proposal
rules remain shared. Provenance is not rights, factual or provider acceptance.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import json

from workers.pdf_passage_comparison import PdfPassageCapture, compare_pdf_passages
from workers.passage_extraction_request import (
    INSTRUCTIONS, MAX_REQUEST_BYTES, FullRequestTokenLimit, _canonical, _output_schema, _tokens,
)
from workers.model_proposal import ModelProposal, MAX_OUTPUT_BYTES
from workers.passage_model_plan import PassageTokenLimit
from workers.passage_model_proposal import parse_changed_passage_proposal
from workers.prose_passage_selection import _digest

TEMPLATE_ID = 'tf-private-pdf-passage-extraction-1'


class PdfExtractionRequestError(ValueError):
    """Fixed private refusal without original, request or parser details."""


@dataclass(frozen=True)
class OfflinePdfExtractionRequest:
    item_key: str
    body: bytes = field(repr=False)
    request_sha256: str
    selected_payload_sha256: str
    maximum_output_tokens: int
    evidence_state: str = 'offline_pdf_complete_extraction_envelope_only'


def _compile(current, previous, observed_at, maximum_output_tokens):
    if not _tokens(maximum_output_tokens):
        raise ValueError
    compared = compare_pdf_passages(current, previous, observed_at=observed_at)
    selected = compared.selection
    if selected.state != 'ready' or selected.payload is None:
        raise ValueError
    payload = json.loads(selected.payload)
    body = _canonical(dict(schema_version=1, kind='private_offline_pdf_extraction_request',
        template_id=TEMPLATE_ID, instructions=INSTRUCTIONS, selected_payload=payload,
        selected_payload_sha256=selected.payload_sha256,
        pdf_provenance=dict(adapter_identity=compared.current.adapter_identity,
            parser_identity=compared.current.parser_identity,
            current_derivation_sha256=compared.current.derivation_manifest_sha256,
            previous_derivation_sha256=None if compared.previous is None else compared.previous.derivation_manifest_sha256,
            current_inspection_sha256=compared.current.inspection_report_sha256,
            previous_inspection_sha256=None if compared.previous is None else compared.previous.inspection_report_sha256,
            coverage=compared.current.coverage, page_index_kind='physical_1_based', offset_space='derived_page_utf8',
            whole_page_selection=True, rendered_visibility_verified=False, visual_qualification_established=False,
            ocr_qualification_established=False, table_qualification_established=False),
        output_schema=_output_schema(payload), maximum_output_bytes=MAX_OUTPUT_BYTES,
        maximum_output_tokens=maximum_output_tokens))
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError
    return OfflinePdfExtractionRequest(payload['item_key'], body, sha256(body).hexdigest(),
                                       selected.payload_sha256, maximum_output_tokens), compared


def compile_pdf_extraction_request(current: PdfPassageCapture,
        previous: PdfPassageCapture | None = None, *, observed_at: datetime,
        maximum_output_tokens: int) -> OfflinePdfExtractionRequest:
    try:
        return _compile(current, previous, observed_at, maximum_output_tokens)[0]
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError, RecursionError):
        raise PdfExtractionRequestError('pdf_extraction_request_unavailable') from None


def _request_snapshot(request):
    if type(request) is not OfflinePdfExtractionRequest:
        raise ValueError
    values = {name: getattr(request, name) for name in ('item_key', 'body', 'request_sha256',
              'selected_payload_sha256', 'maximum_output_tokens', 'evidence_state')}
    if (type(values['body']) is not bytes or any(type(values[name]) is not str for name in
            ('item_key', 'request_sha256', 'selected_payload_sha256', 'evidence_state'))
            or not _tokens(values['maximum_output_tokens'])
            or not 1 <= len(values['body']) <= MAX_REQUEST_BYTES
            or not _digest(values['request_sha256']) or not _digest(values['selected_payload_sha256'])
            or sha256(values['body']).hexdigest() != values['request_sha256']
            or values['evidence_state'] != 'offline_pdf_complete_extraction_envelope_only'):
        raise ValueError
    return OfflinePdfExtractionRequest(**values)


def _regenerate(request, current, previous, observed_at, maximum_output_tokens):
    try:
        # Capture the caller's request before either original's process callback.
        captured = _request_snapshot(request)
        if captured.maximum_output_tokens != maximum_output_tokens:
            raise ValueError
        expected, compared = _compile(current, previous, observed_at, maximum_output_tokens)
        if captured != expected:
            raise ValueError
        return compared
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError, RecursionError):
        raise PdfExtractionRequestError('pdf_extraction_request_binding_mismatch') from None


def bind_pdf_full_request_token_limit(request: OfflinePdfExtractionRequest, *,
        current: PdfPassageCapture, previous: PdfPassageCapture | None, observed_at: datetime,
        maximum_output_tokens: int, proof: FullRequestTokenLimit) -> PassageTokenLimit:
    """Adapt only an exact complete-envelope caller proof; reserve no spend."""
    try:
        captured = _request_snapshot(request)
        if type(proof) is not FullRequestTokenLimit:
            raise ValueError
        item_key, digest, maximum_input = proof.item_key, proof.request_sha256, proof.maximum_input_tokens
        if (type(item_key) is not str or type(digest) is not str or not _tokens(maximum_input)
                or item_key != captured.item_key or digest != captured.request_sha256):
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise PdfExtractionRequestError('pdf_extraction_full_token_binding_mismatch') from None
    _regenerate(captured, current, previous, observed_at, maximum_output_tokens)
    return PassageTokenLimit(captured.item_key, captured.selected_payload_sha256, maximum_input)


def parse_pdf_extraction_proposal(raw: bytes, request: OfflinePdfExtractionRequest, *,
        current: PdfPassageCapture, previous: PdfPassageCapture | None, observed_at: datetime,
        maximum_output_tokens: int) -> ModelProposal:
    """Only changed exact locators; a structural result remains unverified."""
    compared = _regenerate(request, current, previous, observed_at, maximum_output_tokens)
    return parse_changed_passage_proposal(raw, current=compared.current.snapshot,
        previous=None if compared.previous is None else compared.previous.snapshot,
        expected_payload_sha256=compared.selection.payload_sha256)
