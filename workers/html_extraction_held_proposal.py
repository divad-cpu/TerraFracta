"""One detached HTML-derived review candidate, with independent editorial context.

No cast to the plain-document result type, ID allocation, issue replacement,
factual support approval, durable association, decision or publication. Retain
all four exact returned parts; supplied correspondence is not authentication.
"""
from dataclasses import dataclass,field
from datetime import datetime,timedelta
from hashlib import sha256
import json,re

from workers.html_extraction_custody import HtmlExtractionReopenExpected,_snapshot_custody_values
from workers.html_extraction_review_report import html_extraction_review_report
from workers.private_extraction_held_proposal import (MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROVENANCE_BYTES,
    _json,_unique,_shape,_text,_instant,_date)
from workers.feed_postgres_contract import _uuid,_time
from workers.detached_review_context import _prepare_detached_context, _capture_spelling


class HtmlExtractionHeldProposalError(ValueError):pass


@dataclass(frozen=True)
class DetachedHtmlExtractionProposal:
    payload_raw:bytes=field(repr=False)
    selection_raw:bytes=field(repr=False)
    provenance_raw:bytes=field(repr=False)
    context_raw:bytes=field(repr=False)
    evidence_state:str='invented_html_unverified_detached_not_captured'


def _source(report,key):
    source=report['inspection'][key]
    keys=('source_key','item_key','source_version_id','source_url','content_sha256','mapping_sha256',
        'language_code','retrieved_at','adapter_identity','parser_identity','derivation_manifest_sha256')
    return dict(**{k:source[k] for k in keys},**report['originals'][key])


def prepare_html_extraction_held_proposal(receipt:bytes,expected:HtmlExtractionReopenExpected,
        independent_context:bytes,*,current_receipt:bytes,previous_receipt:bytes,observed_at:datetime)->DetachedHtmlExtractionProposal:
    """Reopen all originals/output; require separately supplied held/head/support.

    The shared context dialect and canonical payload helpers are reused without
    widening any old custody type or installing an HTML capture/provider route.
    """
    try:
        receipt, expected, independent_context, current_receipt, previous_receipt, observed_at = _snapshot_custody_values(
            receipt, expected, independent_context, current_receipt, previous_receipt, observed_at)
        if (type(independent_context) is not bytes or not 1<=len(independent_context)<=MAX_CONTEXT_BYTES
                or type(observed_at) is not datetime or observed_at.utcoffset()!=timedelta(0)):raise ValueError
        report=json.loads(html_extraction_review_report(receipt,expected,current_receipt=current_receipt,
            previous_receipt=previous_receipt,observed_at=observed_at))
        b=report['inspection']['current'];proposal=report['proposal']
        raw,selection,ctx,exact=_prepare_detached_context(independent_context,current=b,proposal=proposal,
            artifact_values=report['artifact'],stored_at=_instant(report['artifact']['stored_at']),observed_at=observed_at,maximum_payload_bytes=MAX_PAYLOAD_BYTES)
        content=ctx['content']
        provenance=_json(dict(schema_version=1,kind='detached_html_extraction_proposal',scope='invented_supplied_full_receipts_only',
            evidence_state='unverified_not_captured_no_durable_association',snapshot_intent=ctx['snapshot_intent'],artifact=exact,
            current=_source(report,'current'),previous=_source(report,'previous'),full_receipt_sha256=sha256(receipt).hexdigest(),
            extraction_metadata_sha256=report['artifact']['metadata_sha256'],selected_payload_sha256=report['inspection']['request']['selected_payload_sha256'],
            independent_context=ctx,context_sha256=sha256(_json(ctx)).hexdigest(),supplied_context_sha256=sha256(independent_context).hexdigest(),
            artifact_prepared_at=report['prepared_at'],artifact_stored_at=report['artifact']['stored_at'],artifact_observed_at=report['observed_at'],
            payload_sha256=sha256(raw).hexdigest(),selection_sha256=sha256(selection).hexdigest(),claim_id=content['claim_id'],
            source_date_text=proposal['source_date_text'],review_date_basis=content['review_date_basis'],prepared_at=_time(observed_at)))
        if len(selection)>2048 or len(provenance)>MAX_PROVENANCE_BYTES:raise ValueError
        return DetachedHtmlExtractionProposal(raw,selection,provenance,independent_context)
    except Exception:
        raise HtmlExtractionHeldProposalError('html_extraction_held_proposal_unavailable') from None
