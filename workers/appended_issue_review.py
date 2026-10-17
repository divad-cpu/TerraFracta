"""Two-phase append-only whole-issue review preparation over explicit bytes.

Python re-admits full candidate custody and duplicate-free original baseline.
It preserves old claims and proposes new whole-page fields explicitly. Complete
publication/payload syntax is owned by the existing TypeScript admission, not
this structural composer. No capture, replacement, qualification or IO occurs.
"""
from dataclasses import dataclass,field
from datetime import datetime
from hashlib import sha256
import base64
from workers.detached_proposal_postgres import ReopenedStoredDetachedProposal,parse_reopened_detached_proposal
from workers.detached_proposal_custody import ReobservedDetachedProposal,part_bytes
from workers.detached_proposal_report import detached_proposal_review_report
from workers.issue_review_composition import (_claims,_publication_uuid,MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROOF_BYTES,MAX_TRANSFER_BYTES,PART_KEYS,INTENT,compose_known_issue_candidate)
from workers.private_extraction_held_proposal import _json,_shape,_text,_instant,_date
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import _uuid,_utc,_time
from workers.dispatch_input_snapshot import freeze_input,thaw_input
from workers.detached_proposal_custody import DetachedPreparationIntent,DetachedProposalParts
from workers.detached_proposal_postgres import StoredDetachedProposal
from workers.document_passage_binding import DocumentByteSpan,DocumentPassageBinding,DocumentSpanMap,PlainDocumentReceipt
from workers.document_result_contract import FeedDocumentAssociation,InventedDocumentResult
from workers.document_result_reopen import DocumentReopenRequest,ReopenedDocumentResult
from workers.feed_capture_reopen import ReopenRequest,ReopenedCapture
from workers.feed_collection_inventory import InventoryCut,InventoryCursor,InventoryItem,InventoryRequest
from workers.feed_postgres_processing import InventedPgOutcomeReceipt
from workers.feed_discovery import FeedReceipt
from workers.feed_postgres_contract import InventedPgCapture
from workers.feed_window_lineage import InventedCollectionScope
from workers.model_proposal import ModelProposal
from workers.passage_extraction_request import OfflineExtractionRequest
from workers.private_extraction_postgres import PrivateExtractionStoreRequest,StoredPrivateExtractionResult
from workers.private_extraction_reopen import PrivateExtractionReopenRequest,ReopenedPrivateExtractionResult
from workers.private_extraction_result import PrivateExtractionResult

_ENTRY_RECORDS=(
    DetachedPreparationIntent,DetachedProposalParts,ReobservedDetachedProposal,ReopenedStoredDetachedProposal,
    StoredDetachedProposal,DocumentByteSpan,DocumentPassageBinding,DocumentSpanMap,
    PlainDocumentReceipt,FeedDocumentAssociation,InventedDocumentResult,DocumentReopenRequest,
    ReopenedDocumentResult,ReopenRequest,ReopenedCapture,InventoryCursor,
    InventoryItem,InventoryRequest,InventoryCut,InventedPgOutcomeReceipt,FeedReceipt,InventedPgCapture,
    InventedCollectionScope,ModelProposal,OfflineExtractionRequest,PrivateExtractionStoreRequest,
    StoredPrivateExtractionResult,PrivateExtractionReopenRequest,ReopenedPrivateExtractionResult,PrivateExtractionResult,
)



class AppendedIssueReviewError(ValueError):pass


@dataclass(frozen=True)
class AppendedIssueReviewPreparation:
    candidate_report_raw: bytes=field(repr=False)
    baseline_raw: bytes=field(repr=False)
    canonical_baseline_raw: bytes=field(repr=False)
    context_raw: bytes=field(repr=False)
    proposal_raw: bytes=field(repr=False)
    composition_raw: bytes=field(repr=False)
    evidence_state: str='invented_structural_whole_issue_preparation_requires_strict_typescript_admission'


def composition_parts(prepared):
    if type(prepared) is not AppendedIssueReviewPreparation:raise ValueError
    parts=(prepared.candidate_report_raw,prepared.baseline_raw,prepared.canonical_baseline_raw,prepared.context_raw,prepared.proposal_raw,prepared.composition_raw)
    for raw,limit in zip(parts,(262144,MAX_BASELINE_BYTES,MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROOF_BYTES)):
        if type(raw) is not bytes or not 1<=len(raw)<=limit:raise ValueError
    return parts




def prepare_appended_issue_review(candidate,baseline_raw,context_raw,*,observed_at):
    """Known nonempty historical base only; never chooses or replaces a claim."""
    try:
        # The complete known graph fits the unchanged depth/node ceilings.
        # Copy all primitives before the earliest nested or outer UTC hook.
        candidate,baseline_raw,context_raw,observed_at=thaw_input(freeze_input(
            (candidate,baseline_raw,context_raw,observed_at),_ENTRY_RECORDS))
        if (type(candidate) is not ReopenedStoredDetachedProposal or type(candidate.result) is not ReobservedDetachedProposal
                or not _utc(observed_at) or type(baseline_raw) is not bytes or not 1<=len(baseline_raw)<=MAX_BASELINE_BYTES
                or type(context_raw) is not bytes or not 1<=len(context_raw)<=MAX_CONTEXT_BYTES):raise ValueError
        confirmed=parse_reopened_detached_proposal(candidate.full_receipt,candidate.result.intent,candidate.result.extraction,observed_at=candidate.observed_at)
        if observed_at<confirmed.observed_at:raise ValueError
        old_parts=confirmed.result.parts;payload=strict_json(old_parts.payload_raw);provenance=strict_json(old_parts.provenance_raw)
        original=provenance['independent_context']
        baseline,snapshot,context,claims,proposed=compose_known_issue_candidate(payload,original,baseline_raw,context_raw,observed_at)
        proposal_raw=_json(proposed);canonical_base=_json(baseline)
        if len(proposal_raw)>MAX_PAYLOAD_BYTES or len(canonical_base)>MAX_BASELINE_BYTES:raise ValueError
        report_raw=detached_proposal_review_report(confirmed)
        proof=dict(schema_version=1,kind='invented_appended_issue_review',scope='invented_offline_rehearsal_only',snapshot_intent=INTENT,
            evidence_state='unverified_whole_issue_preparation_not_captured_or_publication_qualified',observed_at=_time(observed_at),
            candidate_report_sha256=sha256(report_raw).hexdigest(),candidate_preparation_intent_sha256=sha256(confirmed.result.intent.canonical_metadata).hexdigest(),
            candidate_full_receipt_sha256=sha256(confirmed.full_receipt).hexdigest(),candidate_part_sha256=[sha256(x).hexdigest() for x in part_bytes(old_parts)],
            baseline_sha256=sha256(baseline_raw).hexdigest(),canonical_baseline_sha256=sha256(canonical_base).hexdigest(),context_raw_sha256=sha256(context_raw).hexdigest(),
            context_sha256=sha256(_json(context)).hexdigest(),independent_context=context,proposal_sha256=sha256(proposal_raw).hexdigest(),
            preserved_claim_sha256=[sha256(_json(claim)).hexdigest() for claim in snapshot['claims']],appended_claim_sha256=sha256(_json(claims[-1])).hexdigest(),
            source_manifest_sha256=sha256(_json(proposed['dependencyManifest'])).hexdigest())
        prepared=AppendedIssueReviewPreparation(report_raw,baseline_raw,canonical_base,context_raw,proposal_raw,_json(proof));parts=composition_parts(prepared)
        # Conservative six-part local-transfer envelope only. A future native
        # association needs its own complete receipt/statement preflight too.
        envelope=_json({key+'_base64':base64.b64encode(raw).decode() for key,raw in zip(PART_KEYS,parts)})
        if len(envelope)>MAX_TRANSFER_BYTES:raise ValueError
        return prepared
    except Exception:raise AppendedIssueReviewError('appended_issue_review_unavailable') from None
