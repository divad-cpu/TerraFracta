"""Private historical PDF preparation review, distinct from detached provenance."""
from hashlib import sha256
from workers.detached_proposal_custody import part_bytes
from workers.pdf_preparation_postgres import reopen_stored_pdf_preparation, ReopenedStoredPdfPreparation
from workers.pdf_proposal_custody import ReobservedPdfProposal, intent_metadata
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json

MAX_REPORT_BYTES = 256 * 1024
PART_KEYS = ('payload_json', 'selection_json', 'provenance_json', 'context_json')
LIMITS = dict(original_pdf_included=False, request_body_included=False, output_body_included=False,
    full_result_receipt_included=False, full_preparation_receipt_included=False,
    source_authenticated=False, current_qualification_established=False,
    held_capture_observed=False, current_publication_observed=False, publication_authorized=False)


class PdfPreparationReviewReportError(ValueError): pass


def pdf_preparation_review_report(raw, expected, *, receipt, extraction_expected, intent_raw, observed_at):
    """Cold-open complete independent originals once; never select a backend.

    All output is derived from the core's captured result, not original caller
    objects that accepted UTC callbacks could have changed during reopening.
    """
    try:
        opened = reopen_stored_pdf_preparation(raw, expected, receipt=receipt,
            extraction_expected=extraction_expected, intent_raw=intent_raw, observed_at=observed_at)
        if type(opened) is not ReopenedStoredPdfPreparation or type(opened.result) is not ReobservedPdfProposal:
            raise ValueError
        result = opened.result
        metadata = intent_metadata(result.intent)
        parts = part_bytes(result.parts)
        report = dict(schema_version=1, kind='private_stored_pdf_preparation_review_report',
            scope='invented_supplied_pdf_custody_only', review_state='unverified',
            observed_at=_stamp(opened.observed_at),
            preparation=dict(operation_id=opened.stored.operation_id, artifact_id=opened.stored.artifact_id,
                result_operation_id=opened.stored.result_operation_id, prepared_at=metadata['prepared_at'],
                stored_at=_stamp(opened.stored.stored_at), receipt_sha256=sha256(opened.full_receipt).hexdigest(),
                intent_sha256=sha256(result.intent.canonical_metadata).hexdigest(),
                packet_sha256=sha256(opened.packet_raw).hexdigest()),
            intent_json=result.intent.canonical_metadata.decode('utf8', 'strict'),
            parts=dict(zip(PART_KEYS, (part.decode('utf8', 'strict') for part in parts))),
            limits=dict(LIMITS))
        output = _json(report)
        if not 1 <= len(output) <= MAX_REPORT_BYTES: raise ValueError
        return output
    except Exception:
        raise PdfPreparationReviewReportError('pdf_preparation_review_report_unavailable') from None
