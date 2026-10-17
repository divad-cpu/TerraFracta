"""Selected PDF result review, with original/request reopening before projection.

The complete result packet is rederived once through its typed core. Only the
changed selected page text and its exact earlier wording are projected; no
unselected or unchanged page text, original PDF, full request or raw output.
This is a supplied unverified report, never authenticated custody or acceptance.
"""
from dataclasses import asdict
from datetime import datetime
import json

from workers.pdf_result_packet import PdfResultPacketExpected, reopen_pdf_result_packet
from workers.pdf_passage_binding import _stamp
from workers.passage_extraction_request import _canonical

MAX_PDF_EXTRACTION_REVIEW_BYTES = 384 * 1024


class PdfExtractionReviewReportError(ValueError):
    """Fixed private refusal; no partial source, proposal or packet detail."""


def _source(bound, packet_sha):
    doc, snapshot = bound.document, bound.snapshot
    return dict(source_key=doc.source_key, item_key=doc.item_key,
        source_version_id=doc.source_version_id, source_url=doc.source_url,
        content_sha256=doc.content_sha256, retrieved_at=_stamp(doc.retrieved_at),
        mapping_sha256=snapshot.mapping_sha256, language_code=snapshot.language_code,
        packet_sha256=packet_sha, inspection_sha256=bound.inspection_report_sha256,
        derivation_sha256=bound.derivation_manifest_sha256,
        selected_pages=[dict(locator=p.locator, page_number=p.page_number,
            page_text_sha256=p.page_text_sha256) for p in bound.spans])


def _project_reopened_result(result) -> bytes:
    """Internal projection only, after an actual typed result opener returns.

    Public entries accept complete supplied bytes and independent expectations;
    they never accept a caller's parsed proposal or prebuilt reopened context.
    """
    context = result.context
    # These are producer-generated request bytes from the actual complete
    # original rederivation, not a model-supplied selection or stored claim.
    selected = json.loads(context.request.body)['selected_payload']
    current = {p.locator: p for p in context.current.spans}
    prior_spans = {} if context.previous is None else {p.locator: p for p in context.previous.spans}
    prior_text = {} if context.previous is None else {p.locator: p for p in context.previous.snapshot.passages}
    groups = []
    for group in selected['passages']:
        earlier = []
        for locator in group['locators']:
            prior = prior_text.get(locator)
            earlier.append(None if prior is None else dict(locator=locator,
                page_number=prior_spans[locator].page_number,
                text=prior.text, text_sha256=prior.text_sha256))
        groups.append(dict(text=group['text'], text_sha256=group['text_sha256'],
            locators=group['locators'], page_numbers=[current[loc].page_number for loc in group['locators']],
            earlier=earlier))
    report = dict(schema_version=1, kind='private_pdf_extraction_review_report',
        scope='supplied_pdf_result_rederivation_only', review_state='unverified',
        recorded_observed_at=_stamp(context.recorded_observed_at), prepared_at=_stamp(result.prepared_at),
        reopened_at=_stamp(context.reopened_at),
        artifact=dict(operation_id=result.operation_id, packet_sha256=result.packet_sha256,
            packet_bytes=len(result.raw), output_sha256=result.output_sha256, output_bytes=len(result.output_raw)),
        request=dict(request_sha256=context.request.request_sha256,
            selected_payload_sha256=context.request.selected_payload_sha256,
            request_bytes=len(context.request.body), maximum_output_tokens=context.request.maximum_output_tokens),
        current=_source(context.current, context.current_packet_sha256),
        previous=None if context.previous is None else _source(context.previous, context.previous_packet_sha256),
        selected_passages=groups, proposal=asdict(result.proposal),
        context=dict(storage='not_observed', source_qualification='not_established', rights='not_established',
            factual_support='not_assessed', conflict_assessment='not_recorded', translation_assessment='not_recorded',
            provider_usage='not_observed', actual_cost='not_observed', publication='not_authorized'),
        limits=dict(page_index_kind='physical_1_based', offset_space='derived_page_utf8', whole_page_selection=True,
            original_pdf_included=False, request_body_included=False, output_body_included=False,
            unselected_text_included=False, unchanged_text_included=False,
            rendered_visibility_verified=False, visual_qualification_established=False,
            ocr_qualification_established=False, table_qualification_established=False,
            review_decision_included=False))
    encoded = _canonical(report)
    if len(encoded) > MAX_PDF_EXTRACTION_REVIEW_BYTES:
        raise ValueError
    return encoded


def pdf_extraction_review_report(raw: bytes, expected: PdfResultPacketExpected, *,
        reopened_at: datetime) -> bytes:
    """Cold reopen once; never accept a supplied parsed context or proposal."""
    try:
        result = reopen_pdf_result_packet(raw, expected, reopened_at=reopened_at)
        return _project_reopened_result(result)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError, RecursionError):
        raise PdfExtractionReviewReportError('pdf_extraction_review_report_unavailable') from None
