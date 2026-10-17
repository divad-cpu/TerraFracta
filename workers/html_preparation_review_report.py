"""Passive historical HTML preparation projection, never a prewrite witness.

Four full receipts are rechecked against independent retained selectors on every
use. The original context spelling is omitted, while its hash and canonical
context within provenance remain inspectable. Reobservation renews no authority.
"""
from datetime import datetime
from hashlib import sha256
import json
from workers.html_proposal_postgres import HtmlPreparationReopenExpected,reopen_stored_html_proposal
from workers.html_extraction_custody import HtmlExtractionReopenExpected
from workers.html_extraction_review_report import html_extraction_review_report
from workers.private_extraction_held_proposal import _json
from workers.feed_postgres_contract import _time

MAX_HTML_PREPARATION_REVIEW_BYTES=512*1024


class HtmlPreparationReviewReportError(ValueError):
    """All-or-nothing private refusal without bytes, paths or backend details."""


def html_preparation_review_report(receipt:bytes,expected:HtmlPreparationReopenExpected,*,
        extraction_receipt:bytes,extraction_expected:HtmlExtractionReopenExpected,
        current_receipt:bytes,previous_receipt:bytes,observed_at:datetime)->bytes:
    """Reopen all four full inputs and retain original immutable chronology."""
    try:
        reopened=reopen_stored_html_proposal(receipt,expected,extraction_receipt=extraction_receipt,
            extraction_expected=extraction_expected,current_receipt=current_receipt,
            previous_receipt=previous_receipt,observed_at=observed_at)
        result=reopened.result;parts=result.parts;metadata=result.intent.canonical_metadata
        extraction=json.loads(html_extraction_review_report(extraction_receipt,extraction_expected,
            current_receipt=current_receipt,previous_receipt=previous_receipt,observed_at=observed_at))
        report=dict(schema_version=1,kind='private_html_preparation_review_report',scope='invented_supplied_full_receipts_only',
            review_state='unverified',observed_at=_time(observed_at),
            preparation=dict(operation_id=reopened.stored.operation_id,artifact_id=reopened.stored.artifact_id,
                prepared_at=_time(result.prepared_at),stored_at=_time(reopened.stored.stored_at),
                historical_artifact_observed_at=_time(result.historical_artifact_observed_at),
                metadata_sha256=sha256(metadata).hexdigest(),receipt_sha256=sha256(receipt).hexdigest()),
            intent_json=metadata.decode('utf8'),payload_json=parts.payload_raw.decode('utf8'),
            selection_json=parts.selection_raw.decode('utf8'),provenance_json=parts.provenance_raw.decode('utf8'),extraction=extraction,
            limits=dict(original_html_included=False,request_body_included=False,output_body_included=False,raw_context_included=False,
                independent_intent_authenticated=False,current_qualification_established=False,held_capture_observed=False,
                current_publication_observed=False,publication_authorized=False))
        raw=_json(report)
        if len(raw)>MAX_HTML_PREPARATION_REVIEW_BYTES:raise ValueError
        return raw
    except Exception:
        raise HtmlPreparationReviewReportError('html_preparation_review_report_unavailable') from None
