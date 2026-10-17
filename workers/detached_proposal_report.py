"""Lossless private historical-preparation projection for passive inspection.

Full Python custody is re-admitted before projection. Serialized report identity
is not authenticated storage, qualified support, current head or publication.
No transport, source/provider, selection, approval, capture or write operation.
"""
from hashlib import sha256
import json
from workers.detached_proposal_postgres import ReopenedStoredDetachedProposal,parse_reopened_detached_proposal
from workers.detached_proposal_custody import part_bytes
from workers.private_extraction_report import private_extraction_review_report
from workers.feed_postgres_contract import _time
MAX_DETACHED_REPORT_BYTES=262144


class DetachedProposalReportError(ValueError):pass


def detached_proposal_review_report(reopened):
    """Exact four original strings; whole refusal rather than partial report."""
    try:
        if type(reopened) is not ReopenedStoredDetachedProposal:raise ValueError
        checked=parse_reopened_detached_proposal(reopened.full_receipt,reopened.result.intent,reopened.result.extraction,observed_at=reopened.observed_at)
        result=checked.result;stored=checked.stored;parts=part_bytes(result.parts)
        report=dict(schema_version=1,kind='invented_detached_preparation_review',scope='invented_offline_rehearsal_only',review_state='unverified',
            evidence_state='historical_preparation_not_current_qualification_or_held_capture',observed_at=_time(checked.observed_at),
            preparation=dict(operation_id=stored.operation_id,artifact_id=stored.artifact_id,prepared_at=_time(result.prepared_at),
                historical_artifact_observed_at=_time(result.historical_artifact_observed_at),stored_at=_time(stored.stored_at),
                full_receipt_sha256=sha256(checked.full_receipt).hexdigest()),
            intent_json=result.intent.canonical_metadata.decode('utf8'),
            parts={key:raw.decode('utf8') for key,raw in zip(('payload_json','selection_json','provenance_json','context_json'),parts)},
            extraction_report=json.loads(private_extraction_review_report(result.extraction)))
        raw=json.dumps(report,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf8')
        if len(raw)>MAX_DETACHED_REPORT_BYTES:raise ValueError
        return raw
    except Exception:
        raise DetachedProposalReportError('detached_proposal_report_unavailable') from None
