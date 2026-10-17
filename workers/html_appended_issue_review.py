"""Structural whole-issue HTML composition over independently supplied known base.

Reopens all four full receipts; preserves every prior claim/order and raw base.
This is not a capture, issue replacement, source qualification or publication.
The unchanged strict TypeScript payload grammar remains a separate next gate.
"""
from dataclasses import dataclass,field
from hashlib import sha256
import base64
from workers.issue_review_composition import (_claims,_publication_uuid,MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROOF_BYTES,MAX_TRANSFER_BYTES,PART_KEYS,INTENT,compose_known_issue_candidate)
from workers.html_proposal_postgres import reopen_stored_html_proposal
from workers.html_preparation_review_report import html_preparation_review_report
from workers.html_extraction_held_proposal import _capture_spelling
from workers.detached_proposal_custody import part_bytes
from workers.private_extraction_held_proposal import _json,_shape,_text,_date
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import _utc,_time
from workers.dispatch_input_snapshot import freeze_input,thaw_input
from workers.html_proposal_postgres import HtmlPreparationReopenExpected
from workers.html_proposal_custody import HtmlPreparationIntent
from workers.html_extraction_custody import HtmlExtractionReopenExpected
from workers.html_original_custody import HtmlOriginalReopenExpected,HtmlOriginalIntent
from workers.html_passage_binding import HtmlDocumentReceipt,HtmlPassageBinding,HtmlSelectionMap,HtmlElementSelection

_ENTRY_RECORDS=(HtmlPreparationReopenExpected,HtmlPreparationIntent,HtmlExtractionReopenExpected,
    HtmlOriginalReopenExpected,HtmlOriginalIntent,HtmlDocumentReceipt,HtmlPassageBinding,HtmlSelectionMap,HtmlElementSelection)


class HtmlAppendedIssueReviewError(ValueError):pass


@dataclass(frozen=True)
class HtmlAppendedIssueReviewPreparation:
    candidate_report_raw:bytes=field(repr=False)
    baseline_raw:bytes=field(repr=False)
    canonical_baseline_raw:bytes=field(repr=False)
    context_raw:bytes=field(repr=False)
    proposal_raw:bytes=field(repr=False)
    composition_raw:bytes=field(repr=False)
    evidence_state:str='invented_html_structural_whole_issue_preparation_requires_strict_typescript_admission'


def html_composition_parts(prepared):
    if type(prepared) is not HtmlAppendedIssueReviewPreparation:raise ValueError
    parts=(prepared.candidate_report_raw,prepared.baseline_raw,prepared.canonical_baseline_raw,prepared.context_raw,prepared.proposal_raw,prepared.composition_raw)
    for raw,limit in zip(parts,(524288,MAX_BASELINE_BYTES,MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROOF_BYTES)):
        if type(raw) is not bytes or not 1<=len(raw)<=limit:raise ValueError
    return parts


def prepare_html_appended_issue_review(receipt,expected,baseline_raw,context_raw,*,extraction_receipt,extraction_expected,current_receipt,previous_receipt,observed_at):
    """Known nonempty historical base only; never chooses or replaces a claim."""
    try:
        # Freeze the complete independent graph before the earliest accepted
        # UTC callback. Two groups preserve the existing tuple-size ceiling.
        supplied,originals,observed_at=thaw_input(freeze_input(
            ((receipt,expected,baseline_raw,context_raw),
             (extraction_receipt,extraction_expected,current_receipt,previous_receipt),observed_at),_ENTRY_RECORDS))
        receipt,expected,baseline_raw,context_raw=supplied
        extraction_receipt,extraction_expected,current_receipt,previous_receipt=originals
        if (not _utc(observed_at) or type(baseline_raw) is not bytes or not 1<=len(baseline_raw)<=MAX_BASELINE_BYTES
                or type(context_raw) is not bytes or not 1<=len(context_raw)<=MAX_CONTEXT_BYTES):raise ValueError
        confirmed=reopen_stored_html_proposal(receipt,expected,extraction_receipt=extraction_receipt,extraction_expected=extraction_expected,
            current_receipt=current_receipt,previous_receipt=previous_receipt,observed_at=observed_at)
        old_parts=confirmed.result.parts;payload=strict_json(old_parts.payload_raw);provenance=strict_json(old_parts.provenance_raw)
        original=provenance['independent_context']
        baseline,snapshot,context,claims,proposed=compose_known_issue_candidate(payload,original,baseline_raw,context_raw,observed_at)
        _capture_spelling(proposed)
        proposal_raw=_json(proposed);canonical_base=_json(baseline)
        if len(proposal_raw)>MAX_PAYLOAD_BYTES or len(canonical_base)>MAX_BASELINE_BYTES:raise ValueError
        report_raw=html_preparation_review_report(receipt,expected,extraction_receipt=extraction_receipt,extraction_expected=extraction_expected,
            current_receipt=current_receipt,previous_receipt=previous_receipt,observed_at=observed_at)
        proof=dict(schema_version=1,kind='invented_html_appended_issue_review',scope='invented_supplied_full_receipts_only',snapshot_intent=INTENT,
            evidence_state='unverified_whole_issue_preparation_not_captured_or_publication_qualified',observed_at=_time(observed_at),
            candidate_report_sha256=sha256(report_raw).hexdigest(),candidate_preparation_intent_sha256=sha256(confirmed.result.intent.canonical_metadata).hexdigest(),
            candidate_full_receipt_sha256=sha256(confirmed.full_receipt).hexdigest(),candidate_part_sha256=[sha256(x).hexdigest() for x in part_bytes(old_parts)],
            baseline_sha256=sha256(baseline_raw).hexdigest(),canonical_baseline_sha256=sha256(canonical_base).hexdigest(),context_raw_sha256=sha256(context_raw).hexdigest(),
            context_sha256=sha256(_json(context)).hexdigest(),independent_context=context,proposal_sha256=sha256(proposal_raw).hexdigest(),
            preserved_claim_sha256=[sha256(_json(claim)).hexdigest() for claim in snapshot['claims']],appended_claim_sha256=sha256(_json(claims[-1])).hexdigest(),
            source_manifest_sha256=sha256(_json(proposed['dependencyManifest'])).hexdigest())
        prepared=HtmlAppendedIssueReviewPreparation(report_raw,baseline_raw,canonical_base,context_raw,proposal_raw,_json(proof));parts=html_composition_parts(prepared)
        # Conservative six-part local-transfer envelope only. A future native
        # association needs its own complete receipt/statement preflight too.
        envelope=_json({key+'_base64':base64.b64encode(raw).decode() for key,raw in zip(PART_KEYS,parts)})
        if len(envelope)>MAX_TRANSFER_BYTES:raise ValueError
        return prepared
    except Exception:raise HtmlAppendedIssueReviewError('html_appended_issue_review_unavailable') from None
