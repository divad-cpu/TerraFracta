"""Fixed private portable preparation reopening, without a store or selector."""
import sys
from scripts.offline_pdf_request_context import _closed
from scripts.offline_pdf_custody_review import _decode as _custody_input
from scripts.offline_pdf_report import _instant
from workers.closed_pair_channel import _json as strict_json, _binary
from workers.detached_proposal_custody import part_bytes, PART_LIMITS
from workers.error_diagnostics import diagnostic_worker
from workers.pdf_preparation_packet import reopen_pdf_preparation_packet, PdfPreparationPacketError, MAX_PACKET_BYTES
from workers.pdf_proposal_custody import PdfPreparationIntent, ReobservedPdfProposal, MAX_INTENT_BYTES
from workers.private_extraction_held_proposal import _json

MAX_INPUT_BYTES = 768 * 1024
MAX_OUTPUT_BYTES = 256 * 1024
HELP = ('Offline private PDF preparation reopening: supply private_pdf_preparation_reopen_input v1 on stdin. '
    'Retain all four exact historical parts and separately supply prewrite intent, full result receipt, '
    'independent PDF expectation, result intent, asserted checkpoint and fresh observation. '
    'The checkpoint is not an observed store. No path, provider, database, source, capture or publication is selected. '
    'Supervise EOF/deadline and discard partial output unless exit zero and every part validates.\n')


class OfflinePdfPreparationInputError(ValueError): pass
class OfflinePdfPreparationTechnicalError(RuntimeError): pass


def _decode(raw):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES: raise ValueError
    v = _closed(strict_json(raw), ('schema_version', 'kind', 'custody_receipt_base64', 'intent_base64',
        'expected', 'observed_at', 'preparation_packet_base64', 'preparation_intent_base64', 'checkpoint_at'))
    if (type(v['schema_version']) is not int or v['schema_version'] != 1
            or v['kind'] != 'private_pdf_preparation_reopen_input'): raise ValueError
    packet = _binary(v['preparation_packet_base64'], MAX_PACKET_BYTES)
    intent = PdfPreparationIntent(_binary(v['preparation_intent_base64'], MAX_INTENT_BYTES))
    checkpoint = _instant(v['checkpoint_at'])
    base = {k: v[k] for k in ('schema_version', 'custody_receipt_base64', 'intent_base64', 'expected', 'observed_at')}
    base['kind'] = 'private_pdf_result_custody_review_input'
    return packet, intent, *_custody_input(_json(base)), checkpoint


def preparation_from_envelope(raw):
    try: packet, intent, receipt, expected, result_intent, at, checkpoint = _decode(raw)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise OfflinePdfPreparationInputError('pdf_preparation_reopen_unavailable') from None
    except Exception: raise OfflinePdfPreparationTechnicalError('pdf_preparation_reopen_unavailable') from None
    try:
        reopened = reopen_pdf_preparation_packet(packet, intent, receipt=receipt, extraction_expected=expected,
            intent_raw=result_intent, stored_at=checkpoint, observed_at=at)
    except PdfPreparationPacketError: raise OfflinePdfPreparationInputError('pdf_preparation_reopen_unavailable') from None
    except Exception: raise OfflinePdfPreparationTechnicalError('pdf_preparation_reopen_unavailable') from None
    try:
        if type(reopened) is not ReobservedPdfProposal: raise ValueError
        values = part_bytes(reopened.parts)
        output = _json(dict(zip(('payloadJson', 'selectionJson', 'provenanceJson', 'contextJson'),
            (raw.decode('utf8', 'strict') for raw in values)))) + b'\n'
        if len(output) > MAX_OUTPUT_BYTES: raise ValueError
        return output
    except Exception: raise OfflinePdfPreparationTechnicalError('pdf_preparation_reopen_unavailable') from None


def main(*, args=None, stdin=None, stdout=None, stderr=None):
    args = sys.argv[1:] if args is None else args
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout.buffer if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args == ['--help']: stderr.write(HELP); return 0
            if args: stderr.write('offline_pdf_preparation_reopen_arguments_refused\n'); return 2
            try: output = preparation_from_envelope(stdin.read(MAX_INPUT_BYTES + 1))
            except OfflinePdfPreparationInputError: stderr.write('offline_pdf_preparation_reopen_unavailable\n'); return 2
            if stdout.write(output) != len(output): raise OSError
            stdout.flush(); return 0
    except Exception:
        try: stderr.write('offline_pdf_preparation_reopen_unavailable\n')
        except Exception: pass
        return 1

if __name__ == '__main__': raise SystemExit(main())
