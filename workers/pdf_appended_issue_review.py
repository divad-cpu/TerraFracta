"""PDF whole-issue structural review over an independently supplied known base.

One complete original reopening, no format cast, replacement, capture, source
qualification or publication. Final TypeScript whole-payload admission remains
an explicit separate dependency before any native complete association.
"""
from dataclasses import dataclass,field
from hashlib import sha256
import base64
from workers.issue_review_composition import (MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROOF_BYTES,MAX_TRANSFER_BYTES,PART_KEYS,INTENT,compose_known_issue_candidate)
from workers.pdf_preparation_review_report import pdf_preparation_review_report,MAX_REPORT_BYTES
from workers.pdf_preparation_postgres import _INPUT_RECORDS
from workers.dispatch_input_snapshot import freeze_input,thaw_input
from workers.closed_pair_channel import _json as strict_json
from workers.private_extraction_held_proposal import _json
from workers.feed_postgres_contract import _utc


class PdfAppendedIssueReviewError(ValueError):pass


@dataclass(frozen=True)
class PdfAppendedIssueReviewPreparation:
    candidate_report_raw:bytes=field(repr=False)
    baseline_raw:bytes=field(repr=False)
    canonical_baseline_raw:bytes=field(repr=False)
    context_raw:bytes=field(repr=False)
    proposal_raw:bytes=field(repr=False)
    composition_raw:bytes=field(repr=False)
    evidence_state:str='invented_pdf_structural_whole_issue_preparation_requires_strict_typescript_admission'


def pdf_composition_parts(prepared):
    if type(prepared)is not PdfAppendedIssueReviewPreparation:raise ValueError
    parts=(prepared.candidate_report_raw,prepared.baseline_raw,prepared.canonical_baseline_raw,prepared.context_raw,prepared.proposal_raw,prepared.composition_raw)
    for raw,cap in zip(parts,(MAX_REPORT_BYTES,MAX_BASELINE_BYTES,MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROOF_BYTES)):
        if type(raw)is not bytes or not 1<=len(raw)<=cap:raise ValueError
    return parts


def prepare_pdf_appended_issue_review(raw,expected,baseline_raw,context_raw,*,receipt,extraction_expected,intent_raw,observed_at):
    """Known nonempty head; append a proposal without editing any old claim."""
    try:
        # Capture the complete independent graph before the earliest accepted
        # UTC hook. This preserves the existing tuple/depth/node ceilings.
        supplied,originals,observed_at=thaw_input(freeze_input(
            ((raw,expected,baseline_raw,context_raw),(receipt,extraction_expected,intent_raw),observed_at),_INPUT_RECORDS))
        raw,expected,baseline_raw,context_raw=supplied
        receipt,extraction_expected,intent_raw=originals
        if (not _utc(observed_at)or type(baseline_raw)is not bytes or not 1<=len(baseline_raw)<=MAX_BASELINE_BYTES
                or type(context_raw)is not bytes or not 1<=len(context_raw)<=MAX_CONTEXT_BYTES):raise ValueError
        # The existing report owns exactly ONE complete cold original opening.
        # All later values come from its captured result, never caller objects.
        report_raw=pdf_preparation_review_report(raw,expected,receipt=receipt,extraction_expected=extraction_expected,intent_raw=intent_raw,observed_at=observed_at)
        report=strict_json(report_raw);old_parts=tuple(report['parts'][key].encode('utf8')for key in ('payload_json','selection_json','provenance_json','context_json'))
        payload=strict_json(old_parts[0]);provenance=strict_json(old_parts[2]);original=provenance['independent_context']
        baseline,snapshot,context,claims,proposed=compose_known_issue_candidate(payload,original,baseline_raw,context_raw,observed_at)
        proposal_raw=_json(proposed);canonical_base=_json(baseline)
        if len(proposal_raw)>MAX_PAYLOAD_BYTES or len(canonical_base)>MAX_BASELINE_BYTES:raise ValueError
        proof=dict(schema_version=1,kind='invented_pdf_appended_issue_review',scope='invented_supplied_full_pdf_receipts_only',snapshot_intent=INTENT,
            evidence_state='unverified_whole_issue_preparation_not_captured_or_publication_qualified',observed_at=report['observed_at'],
            candidate_report_sha256=sha256(report_raw).hexdigest(),candidate_preparation_intent_sha256=report['preparation']['intent_sha256'],
            candidate_full_receipt_sha256=report['preparation']['receipt_sha256'],candidate_part_sha256=[sha256(part).hexdigest()for part in old_parts],
            baseline_sha256=sha256(baseline_raw).hexdigest(),canonical_baseline_sha256=sha256(canonical_base).hexdigest(),context_raw_sha256=sha256(context_raw).hexdigest(),
            context_sha256=sha256(_json(context)).hexdigest(),independent_context=context,proposal_sha256=sha256(proposal_raw).hexdigest(),
            preserved_claim_sha256=[sha256(_json(claim)).hexdigest()for claim in snapshot['claims']],appended_claim_sha256=sha256(_json(claims[-1])).hexdigest(),
            source_manifest_sha256=sha256(_json(proposed['dependencyManifest'])).hexdigest())
        prepared=PdfAppendedIssueReviewPreparation(report_raw,baseline_raw,canonical_base,context_raw,proposal_raw,_json(proof));parts=pdf_composition_parts(prepared)
        envelope=_json({key+'_base64':base64.b64encode(body).decode('ascii')for key,body in zip(PART_KEYS,parts)})
        if len(envelope)>MAX_TRANSFER_BYTES:raise ValueError
        return prepared
    except Exception:raise PdfAppendedIssueReviewError('pdf_appended_issue_review_unavailable')from None
