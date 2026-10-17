"""Detached single PDF claim plus separately supplied editorial correspondence.

No plain/HTML cast, ID/head selection, support finding, durable association,
SQL/capture command, provider or publication. Keep all four private parts.
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime
from hashlib import sha256

from workers.closed_pair_channel import _json as strict_json
from workers.detached_review_context import _prepare_detached_context
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.pdf_result_packet import PdfResultPacketExpected, _RECORDS
from workers.pdf_result_custody import reopen_pdf_result_custody
from workers.pdf_extraction_review_report import _source
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import (
    MAX_CONTEXT_BYTES, MAX_PROVENANCE_BYTES, MAX_PAYLOAD_BYTES, _json,
)


class PdfExtractionHeldProposalError(ValueError):
    """Fixed all-or-nothing refusal; never private PDF/context diagnostics."""


@dataclass(frozen=True)
class DetachedPdfExtractionProposal:
    payload_raw: bytes = field(repr=False)
    selection_raw: bytes = field(repr=False)
    provenance_raw: bytes = field(repr=False)
    context_raw: bytes = field(repr=False)
    evidence_state: str = 'invented_pdf_unverified_detached_not_captured'


def prepare_pdf_extraction_held_proposal(receipt: bytes, expected: PdfResultPacketExpected,
        independent_context: bytes, *, intent_raw: bytes, observed_at: datetime) -> DetachedPdfExtractionProposal:
    """Cold-open each present original once; no report/object can substitute.

    Every caller assertion is captured before a clock or owned-child callback.
    The existing independent context dialect supplies IDs, source correspondence,
    explicit head and proposed-only support. It cannot authorize issue replacement.
    """
    try:
        if type(independent_context) is not bytes or not 1 <= len(independent_context) <= MAX_CONTEXT_BYTES:
            raise ValueError
        receipt, expected, independent_context, intent_raw, observed_at = thaw_input(freeze_input(
            (receipt, expected, independent_context, intent_raw, observed_at), _RECORDS))
        # Reject malformed context framing before expensive original inspection;
        # semantic joins below require the actual reopened result, never JSON alone.
        strict_json(independent_context)
        stored = reopen_pdf_result_custody(receipt, expected, intent_raw=intent_raw, observed_at=observed_at)
        result = stored.result; context = result.context; proposal = asdict(result.proposal)
        current = _source(context.current, context.current_packet_sha256)
        previous = None if context.previous is None else _source(context.previous, context.previous_packet_sha256)
        artifact = dict(operation_id=stored.operation_id, artifact_id=stored.artifact_id,
            request_sha256=context.request.request_sha256, output_sha256=result.output_sha256)
        payload, selection, ctx, exact = _prepare_detached_context(independent_context,
            current=current, proposal=proposal, artifact_values=artifact,
            stored_at=stored.stored_at, observed_at=stored.observed_at, maximum_payload_bytes=MAX_PAYLOAD_BYTES)
        proof = _json(dict(schema_version=1, kind='detached_pdf_extraction_proposal',
            scope='invented_supplied_pdf_custody_only', evidence_state='unverified_not_captured_no_durable_association',
            snapshot_intent=ctx['snapshot_intent'], artifact=exact, current=current, previous=previous,
            full_receipt_sha256=sha256(receipt).hexdigest(), canonical_intent_sha256=sha256(intent_raw).hexdigest(),
            selected_payload_sha256=context.request.selected_payload_sha256,
            independent_context=ctx, context_sha256=sha256(_json(ctx)).hexdigest(),
            supplied_context_sha256=sha256(independent_context).hexdigest(),
            recorded_observed_at=_stamp(context.recorded_observed_at),
            artifact_prepared_at=_stamp(result.prepared_at), artifact_stored_at=_stamp(stored.stored_at),
            artifact_observed_at=_stamp(stored.observed_at), prepared_at=_stamp(observed_at),
            payload_sha256=sha256(payload).hexdigest(), selection_sha256=sha256(selection).hexdigest(),
            claim_id=ctx['content']['claim_id'], source_date_text=proposal['source_date_text'],
            review_date_basis=ctx['content']['review_date_basis'],
            limits=dict(page_index_kind='physical_1_based', offset_space='derived_page_utf8',
                whole_page_selection=True, original_pdf_included=False,
                rendered_visibility_verified=False, visual_qualification_established=False,
                ocr_qualification_established=False, table_qualification_established=False,
                durable_association_included=False, publication_authorized=False)))
        if len(selection) > 2048 or len(proof) > MAX_PROVENANCE_BYTES:
            raise ValueError
        return DetachedPdfExtractionProposal(payload, selection, proof, independent_context)
    except Exception:
        raise PdfExtractionHeldProposalError('pdf_extraction_held_proposal_unavailable') from None
