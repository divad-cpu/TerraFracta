"""Passive projection of exact invented HTML custody, never editorial acceptance.

The caller supplies an independent immutable intent and three full receipts.
Every use reopens both originals, rederives selected text and the whole request,
and parses the exact stored output. Receipts alone do not authenticate a server.
"""
from dataclasses import asdict
from datetime import datetime
from hashlib import sha256
import json

from workers.html_extraction_custody import HtmlExtractionReopenExpected,reopen_html_extraction,_snapshot_custody_values
from workers.html_inspection_report import html_inspection_report
from workers.feed_postgres_contract import _time

MAX_HTML_EXTRACTION_REVIEW_BYTES=384*1024


class HtmlExtractionReviewReportError(ValueError):
    """Generic private refusal; no original, request, output or path is echoed."""


def _original(stored,receipt):
    return dict(operation_id=stored.operation_id,artifact_id=stored.artifact_id,
        stored_at=_time(stored.stored_at),metadata_sha256=sha256(stored.canonical_metadata).hexdigest(),
        receipt_sha256=sha256(receipt).hexdigest())


def html_extraction_review_report(receipt:bytes,expected:HtmlExtractionReopenExpected,*,
        current_receipt:bytes,previous_receipt:bytes,observed_at:datetime)->bytes:
    """No partial report, prebuilt proposal, or inferred publication context."""
    try:
        try:
            receipt, expected, current_receipt, previous_receipt, observed_at = _snapshot_custody_values(
                receipt, expected, current_receipt, previous_receipt, observed_at)
        except Exception:
            raise HtmlExtractionReviewReportError('html_extraction_review_report_unavailable') from None
        stored=reopen_html_extraction(receipt,expected,current_receipt=current_receipt,
            previous_receipt=previous_receipt,observed_at=observed_at)
        result=stored.result;plan=result.plan
        inspection=json.loads(html_inspection_report(plan.change.current_capture,plan.change.previous_capture,
            observed_at=observed_at,request=plan.request,maximum_output_tokens=result.maximum_output_tokens))
        report=dict(schema_version=1,kind='private_html_extraction_review_report',
            scope='invented_supplied_full_receipts_only',review_state='unverified',
            prepared_at=_time(result.prepared_at),observed_at=_time(observed_at),
            artifact=dict(operation_id=stored.operation_id,artifact_id=stored.artifact_id,stored_at=_time(stored.stored_at),
                metadata_sha256=sha256(stored.canonical_metadata).hexdigest(),receipt_sha256=sha256(receipt).hexdigest(),
                request_sha256=plan.request.request_sha256,request_bytes=len(plan.request.body),
                output_sha256=sha256(result.output_raw).hexdigest(),output_bytes=len(result.output_raw)),
            originals=dict(current=_original(plan.change.current,current_receipt),previous=_original(plan.change.previous,previous_receipt)),
            inspection=inspection,proposal=asdict(result.proposal),
            context=dict(current_publication='not_connected',affected_pages='not_connected',
                held_decision='not_connected',conflict_assessment='not_recorded',translation_assessment='not_recorded',
                factual_support='not_assessed',source_qualification='not_established',rights='not_established',
                server_authentication='not_established',provider_usage='not_observed',actual_cost='not_observed',
                publication='not_authorized'),
            limits=dict(original_html_included=False,request_body_included=False,output_body_included=False,
                rendered_visibility_verified=False,review_decision_included=False))
        encoded=json.dumps(report,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf8')
        if len(encoded)>MAX_HTML_EXTRACTION_REVIEW_BYTES:raise ValueError
        return encoded
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError,RecursionError):
        raise HtmlExtractionReviewReportError('html_extraction_review_report_unavailable') from None
