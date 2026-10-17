"""One fixed private stdin supplied PDF custody review; no backend or input path.

Output contains only the existing selected current/prior text and unverified
proposal report. Full independent expectations and intent must be supplied;
no values are adopted from the receipt as source or authentication authority.
"""
import sys

from scripts.offline_pdf_report import _instant
from scripts.offline_pdf_request_context import _closed
from scripts.offline_pdf_result_review import _result_expected
from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.error_diagnostics import diagnostic_worker
from workers.feed_postgres_contract import MAX_CAPTURE_OUTPUT
from workers.pdf_result_custody import MAX_CUSTODY_INTENT_BYTES
from workers.pdf_extraction_review_report import MAX_PDF_EXTRACTION_REVIEW_BYTES
from workers.pdf_custody_review_report import pdf_custody_review_report, PdfCustodyReviewReportError

# Receipt131072 ->174764 base64; intent2048 ->2732; independent request128KiB
# ->174764 plus closed identity/selection metadata. This512KiB frame raises no
# existing portable packet, process, custody receipt, or prior CLI limit.
MAX_INPUT_BYTES = 512 * 1024
MAX_OUTPUT_BYTES = MAX_PDF_EXTRACTION_REVIEW_BYTES + 1
HELP = ('Offline private supplied PDF custody review: supply private_pdf_result_custody_review_input v1 on stdin. '
        'Output includes selected current/earlier text and an unverified proposal; storage remains not_observed. '
        'Refusal is not a source-quality verdict. No input paths, fetch, provider, database, storage backend, '
        'authentication or publication is selected. Supervise the private output pipe and discard incomplete output.\n')


class OfflinePdfCustodyReviewInputError(ValueError):
    """Malformed or unavailable supplied context, not a quality verdict."""


class OfflinePdfCustodyReviewTechnicalError(RuntimeError):
    """Unexpected adapter failure with no private body or backend detail."""


def _decode(raw):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES:
        raise ValueError
    value = _closed(strict_json(raw), ('schema_version', 'kind', 'custody_receipt_base64',
                                      'intent_base64', 'expected', 'observed_at'))
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != 'private_pdf_result_custody_review_input'):
        raise ValueError
    receipt = bounded_binary(value['custody_receipt_base64'], MAX_CAPTURE_OUTPUT)
    intent = bounded_binary(value['intent_base64'], MAX_CUSTODY_INTENT_BYTES)
    expected = _result_expected(value['expected'])
    return receipt, expected, intent, _instant(value['observed_at'])


def report_from_envelope(raw: bytes) -> bytes:
    """One supplied-byte custody opener; no SQL/transport/store is selected."""
    try:
        receipt, expected, intent, observed_at = _decode(raw)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise OfflinePdfCustodyReviewInputError('pdf_custody_review_input_refused') from None
    except Exception:
        raise OfflinePdfCustodyReviewTechnicalError('pdf_custody_review_unavailable') from None
    try:
        report = pdf_custody_review_report(receipt, expected, intent_raw=intent, observed_at=observed_at)
    except PdfCustodyReviewReportError:
        # The core curates malformed context and derivation unavailability alike;
        # the adapter cannot attest why an original could not be rederived.
        raise OfflinePdfCustodyReviewInputError('pdf_custody_review_unavailable') from None
    except Exception:
        raise OfflinePdfCustodyReviewTechnicalError('pdf_custody_review_unavailable') from None
    try:
        if type(report) is not bytes or not 1 <= len(report) <= MAX_PDF_EXTRACTION_REVIEW_BYTES:
            raise ValueError
        return report + b'\n'
    except Exception:
        raise OfflinePdfCustodyReviewTechnicalError('pdf_custody_review_unavailable') from None


def main(*, args=None, stdin=None, stdout=None, stderr=None) -> int:
    args = sys.argv[1:] if args is None else args
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout.buffer if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args == ['--help']:
                stderr.write(HELP); return 0
            if args:
                stderr.write('offline_pdf_custody_review_arguments_refused\n'); return 2
            try:
                output = report_from_envelope(stdin.read(MAX_INPUT_BYTES + 1))
            except OfflinePdfCustodyReviewInputError:
                stderr.write('offline_pdf_custody_review_unavailable\n'); return 2
            if stdout.write(output) != len(output):
                raise OSError
            stdout.flush()
            return 0
    except Exception:
        try: stderr.write('offline_pdf_custody_review_unavailable\n')
        except Exception: pass
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
