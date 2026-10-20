"""Passive supplied HTML inspection, never storage, visibility or source approval.

Both full original vintages are rederived before projection. A supplied request
must equal the independently recompiled complete typed request. Original HTML
and request bodies are omitted; report consistency cannot authenticate them.
"""
from datetime import datetime
import json

from workers.html_passage_comparison import HtmlPassageCapture, compare_html_passages
from workers.html_extraction_request import OfflineHtmlExtractionRequest, compile_html_extraction_request, _snapshot_request_values

MAX_HTML_INSPECTION_BYTES = 256 * 1024


class HtmlInspectionReportError(ValueError):
    """All-or-nothing refusal without source, request or parser details."""


def _instant(value):
    return value.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _source(bound, capture):
    document = bound.document
    return dict(source_key=document.source_key, item_key=document.item_key,
        source_version_id=document.source_version_id, source_url=document.source_url,
        content_sha256=document.content_sha256, original_bytes=len(capture.raw),
        retrieved_at=_instant(document.retrieved_at), mapping_sha256=bound.snapshot.mapping_sha256,
        language_code=bound.snapshot.language_code, adapter_identity=bound.adapter_identity,
        parser_identity=bound.parser_identity,
        derivation_manifest_json=bound.derivation_manifest_raw.decode('utf8'),
        derivation_manifest_sha256=bound.derivation_manifest_sha256,
        passages=[dict(locator=passage.locator, element_id=span.element_id, tag=span.tag,
            start=span.start, end=span.end, raw_sha256=span.raw_sha256,
            text=passage.text, text_sha256=passage.text_sha256)
            for passage, span in zip(bound.snapshot.passages, bound.spans)])


def html_inspection_report(current: HtmlPassageCapture, previous: HtmlPassageCapture | None = None, *,
        observed_at: datetime, request: OfflineHtmlExtractionRequest | None = None,
        maximum_output_tokens: int | None = None) -> bytes:
    """Project exact selected text and provenance; never choose/repair a baseline."""
    try:
        try:
            current, previous, observed_at, request, maximum_output_tokens = _snapshot_request_values(
                current, previous, observed_at, request, maximum_output_tokens)
        except Exception:
            raise HtmlInspectionReportError('html_inspection_report_unavailable') from None
        compared = compare_html_passages(current, previous, observed_at=observed_at)
        request_summary = None
        if request is None:
            if maximum_output_tokens is not None:
                raise ValueError
        else:
            if (type(request) is not OfflineHtmlExtractionRequest or type(request.body) is not bytes
                    or type(request.maximum_output_tokens) is not int
                    or any(type(value) is not str for value in (request.item_key, request.request_sha256,
                        request.selected_payload_sha256, request.evidence_state))):
                raise ValueError
            regenerated = compile_html_extraction_request(current, previous, observed_at=observed_at,
                maximum_output_tokens=maximum_output_tokens)
            if request != regenerated:
                raise ValueError
            request_summary = dict(request_sha256=request.request_sha256,
                selected_payload_sha256=request.selected_payload_sha256,
                maximum_output_tokens=request.maximum_output_tokens, body_bytes=len(request.body))
        selection = compared.selection
        report = dict(schema_version=1, kind='private_html_inspection_report',
            scope='offline_supplied_html_comparison_only', review_state='unverified',
            observed_at=_instant(observed_at), current=_source(compared.current, current),
            previous=None if compared.previous is None else _source(compared.previous, previous),
            source_bytes_changed=compared.source_bytes_changed,
            selection=dict(state=selection.state, reason_code=selection.reason_code,
                unchanged_locators=list(selection.unchanged_locators), removed_locators=list(selection.removed_locators),
                payload_json=None if selection.payload is None else selection.payload.decode('utf8'),
                payload_sha256=selection.payload_sha256), request=request_summary,
            limits=dict(coverage='selected_elements_parsed_text_only', rendered_visibility_verified=False,
                original_html_included=False, request_body_included=False, storage='not_observed',
                source_qualification='not_established', rights='not_established', semantic_support='not_assessed',
                language_qualification='not_established', provider_usage='not_observed', publication='not_authorized'))
        encoded = json.dumps(report, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf8')
        if len(encoded) > MAX_HTML_INSPECTION_BYTES:
            raise ValueError
        return encoded
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError, RecursionError):
        raise HtmlInspectionReportError('html_inspection_report_unavailable') from None
