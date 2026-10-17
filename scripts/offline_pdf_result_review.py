"""One private stdin PDF result review, never a source/model/storage operation.

The result packet and every independent expectation are supplied explicitly.
Output intentionally contains selected current/earlier text and an unverified
proposal; supervise the private pipe and discard incomplete writes on failure.
"""
import sys

from scripts.offline_pdf_report import _instant
from scripts.offline_pdf_request_context import _closed, _expected, _request
from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.error_diagnostics import diagnostic_worker
from workers.pdf_result_packet import PdfResultPacketExpected, MAX_RESULT_PACKET_BYTES
from workers.pdf_extraction_review_report import (
    pdf_extraction_review_report, PdfExtractionReviewReportError, MAX_PDF_EXTRACTION_REVIEW_BYTES,
)

# A2MiB result packet takes <=2,796,204 base64 bytes; the independent128KiB
# request adds <=174,764, leaving finite metadata space within3MiB. The prior
# request-context command retains its own unchanged2MiB cap.
MAX_INPUT_BYTES = 3 * 1024 * 1024
MAX_OUTPUT_BYTES = MAX_PDF_EXTRACTION_REVIEW_BYTES + 1
HELP = ('Offline private PDF result review: supply private_pdf_result_review_input v1 on stdin. '
        'Output includes selected current/earlier text and an unverified proposal. '
        'Refusal is not a source-quality verdict. No input paths, fetch, provider, storage, '
        'authentication or publication is selected; supervise stdin EOF and the private output pipe.\n')


class OfflinePdfResultReviewInputError(ValueError):
    """Malformed/unavailable supplied context, not a source-quality verdict."""


class OfflinePdfResultReviewTechnicalError(RuntimeError):
    """Fixed unexpected adapter error without private original/result details."""


def _result_expected(e):
    """Decode the explicit full independent result assertions; infer nothing."""
    e = _closed(e, ('current', 'previous', 'request', 'output_sha256',
                                  'packet_sha256', 'operation_id', 'prepared_at'))
    if any(type(e[k]) is not str for k in ('output_sha256', 'packet_sha256', 'operation_id')):
        raise ValueError
    current = _expected(e['current'])
    previous = None if e['previous'] is None else _expected(e['previous'])
    return PdfResultPacketExpected(current, previous, _request(e['request']),
        e['output_sha256'], e['packet_sha256'], e['operation_id'], _instant(e['prepared_at']))


def _decode(raw):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES:
        raise ValueError
    value = _closed(strict_json(raw), ('schema_version', 'kind', 'result_packet_base64', 'expected', 'reopened_at'))
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != 'private_pdf_result_review_input'):
        raise ValueError
    packet = bounded_binary(value['result_packet_base64'], MAX_RESULT_PACKET_BYTES)
    expected = _result_expected(value['expected'])
    return packet, expected, _instant(value['reopened_at'])


def report_from_envelope(raw: bytes) -> bytes:
    """Call the existing actual-original report core once; choose no backend."""
    try:
        packet, expected, reopened_at = _decode(raw)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise OfflinePdfResultReviewInputError('pdf_result_review_input_refused') from None
    except Exception:
        raise OfflinePdfResultReviewTechnicalError('pdf_result_review_unavailable') from None
    try:
        report = pdf_extraction_review_report(packet, expected, reopened_at=reopened_at)
    except PdfExtractionReviewReportError:
        # The existing core intentionally curates both bad input and native
        # unavailability. This cannot attest why a source was unavailable.
        raise OfflinePdfResultReviewInputError('pdf_result_review_unavailable') from None
    except Exception:
        raise OfflinePdfResultReviewTechnicalError('pdf_result_review_unavailable') from None
    try:
        if type(report) is not bytes or not 1 <= len(report) <= MAX_PDF_EXTRACTION_REVIEW_BYTES:
            raise ValueError
        return report + b'\n'
    except Exception:
        raise OfflinePdfResultReviewTechnicalError('pdf_result_review_unavailable') from None


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
                stderr.write('offline_pdf_result_review_arguments_refused\n'); return 2
            try:
                output = report_from_envelope(stdin.read(MAX_INPUT_BYTES + 1))
            except OfflinePdfResultReviewInputError:
                stderr.write('offline_pdf_result_review_unavailable\n'); return 2
            if stdout.write(output) != len(output):
                raise OSError
            stdout.flush()
            return 0
    except Exception:
        try: stderr.write('offline_pdf_result_review_unavailable\n')
        except Exception: pass
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
