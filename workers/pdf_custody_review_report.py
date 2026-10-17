"""Supplied PDF custody bytes to the unchanged private selected-text report.

The full independent expected and exact intent remain required. Receipt
consistency is not proof that a database, backend or authenticated custodian was
observed. No duplicate result/original opening and no supplied parsed proposal.
"""
from datetime import datetime

from workers.pdf_result_packet import PdfResultPacketExpected
from workers.pdf_result_custody import reopen_pdf_result_custody
from workers.pdf_extraction_review_report import _project_reopened_result


class PdfCustodyReviewReportError(ValueError):
    """Fixed private refusal; unavailable is not a source-quality verdict."""


def pdf_custody_review_report(receipt_raw: bytes, expected: PdfResultPacketExpected, *,
        intent_raw: bytes, observed_at: datetime) -> bytes:
    """Cold-open once per present original, then project that actual result.

    The existing typed custody opener captures the complete receipt, independent
    expected, intent and clock before invoking any callback. Matching supplied
    bytes never promote storage/source/rights/provider/publication authority.
    """
    try:
        stored = reopen_pdf_result_custody(receipt_raw, expected,
            intent_raw=intent_raw, observed_at=observed_at)
        return _project_reopened_result(stored.result)
    except Exception:
        raise PdfCustodyReviewReportError('pdf_custody_review_report_unavailable') from None
