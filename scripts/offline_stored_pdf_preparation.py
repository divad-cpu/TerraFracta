"""Fixed supplied stored-preparation opening; no database or backend selector."""
import sys
from scripts.offline_pdf_request_context import _closed
from scripts.offline_pdf_custody_review import _decode as _custody_input
from scripts.offline_pdf_report import _instant
from workers.closed_pair_channel import _json as strict_json, _binary
from workers.detached_proposal_custody import part_bytes
from workers.error_diagnostics import diagnostic_worker
from workers.feed_postgres_contract import MAX_CAPTURE_OUTPUT
from workers.pdf_preparation_postgres import (
    prepare_pdf_preparation_reopen, reopen_stored_pdf_preparation,
    ReopenedStoredPdfPreparation, PdfPreparationPostgresError,
)
from workers.pdf_proposal_custody import PdfPreparationIntent, ReobservedPdfProposal, MAX_INTENT_BYTES
from workers.private_extraction_held_proposal import _json

MAX_INPUT_BYTES = 768 * 1024
MAX_OUTPUT_BYTES = 256 * 1024
HELP = ('Offline private stored PDF preparation opening: supply private_stored_pdf_preparation_input v1 on stdin. '
    'Separately supply preparation intent, expected artifact and stored time, complete result receipt, '
    'independent original PDF expectations and result intent. Output preserves all four historical parts. '
    'Matching supplied receipts do not authenticate a database, source, actor or current editorial eligibility. '
    'No path, provider, database, capture or publication is selected. '
    'Supervise EOF/deadline and discard partial output unless exit zero and every part validates.\n')


class OfflineStoredPdfInputError(ValueError): pass
class OfflineStoredPdfTechnicalError(RuntimeError): pass


def _decode(raw):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES: raise ValueError
    value = _closed(strict_json(raw), ('schema_version', 'kind', 'custody_receipt_base64',
        'intent_base64', 'expected', 'observed_at', 'preparation_receipt_base64',
        'preparation_intent_base64', 'preparation_artifact_id', 'preparation_stored_at'))
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != 'private_stored_pdf_preparation_input'): raise ValueError
    raw_receipt = _binary(value['preparation_receipt_base64'], MAX_CAPTURE_OUTPUT)
    intent = PdfPreparationIntent(_binary(value['preparation_intent_base64'], MAX_INTENT_BYTES))
    stored_at = _instant(value['preparation_stored_at'])
    base = {key: value[key] for key in ('schema_version', 'custody_receipt_base64',
        'intent_base64', 'expected', 'observed_at')}
    base['kind'] = 'private_pdf_result_custody_review_input'
    result_receipt, pdf_expected, result_intent, observed_at = _custody_input(_json(base))
    expected = prepare_pdf_preparation_reopen(intent=intent,
        artifact_id=value['preparation_artifact_id'], stored_at=stored_at, observed_at=observed_at)
    return raw_receipt, expected, result_receipt, pdf_expected, result_intent, observed_at


def preparation_from_envelope(raw):
    try: raw_receipt, expected, result_receipt, pdf_expected, result_intent, at = _decode(raw)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise OfflineStoredPdfInputError('stored_pdf_preparation_unavailable') from None
    except Exception: raise OfflineStoredPdfTechnicalError('stored_pdf_preparation_unavailable') from None
    try:
        reopened = reopen_stored_pdf_preparation(raw_receipt, expected, receipt=result_receipt,
            extraction_expected=pdf_expected, intent_raw=result_intent, observed_at=at)
    except PdfPreparationPostgresError:
        raise OfflineStoredPdfInputError('stored_pdf_preparation_unavailable') from None
    except Exception: raise OfflineStoredPdfTechnicalError('stored_pdf_preparation_unavailable') from None
    try:
        if (type(reopened) is not ReopenedStoredPdfPreparation
                or type(reopened.result) is not ReobservedPdfProposal): raise ValueError
        parts = part_bytes(reopened.result.parts)
        output = _json(dict(zip(('payloadJson', 'selectionJson', 'provenanceJson', 'contextJson'),
            (part.decode('utf8', 'strict') for part in parts)))) + b'\n'
        if len(output) > MAX_OUTPUT_BYTES: raise ValueError
        return output
    except Exception: raise OfflineStoredPdfTechnicalError('stored_pdf_preparation_unavailable') from None


def main(*, args=None, stdin=None, stdout=None, stderr=None):
    args = sys.argv[1:] if args is None else args
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout.buffer if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args == ['--help']: stderr.write(HELP); return 0
            if args: stderr.write('offline_stored_pdf_preparation_arguments_refused\n'); return 2
            try: output = preparation_from_envelope(stdin.read(MAX_INPUT_BYTES + 1))
            except OfflineStoredPdfInputError:
                stderr.write('offline_stored_pdf_preparation_unavailable\n'); return 2
            if stdout.write(output) != len(output): raise OSError
            stdout.flush(); return 0
    except Exception:
        try: stderr.write('offline_stored_pdf_preparation_unavailable\n')
        except Exception: pass
        return 1

if __name__ == '__main__': raise SystemExit(main())
