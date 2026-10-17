"""One private supplied PDF candidate, retaining all four detached parts.

No input/output path, database, provider, capture command or publication. Full
receipt, independent expected intent and held context must all be supplied.
"""
import sys
from scripts.offline_pdf_request_context import _closed
from scripts.offline_pdf_custody_review import _decode as _custody_input
from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.error_diagnostics import diagnostic_worker
from workers.private_extraction_held_proposal import _json, MAX_CONTEXT_BYTES, MAX_PAYLOAD_BYTES, MAX_PROVENANCE_BYTES
from workers.pdf_extraction_held_proposal import (
    prepare_pdf_extraction_held_proposal, DetachedPdfExtractionProposal, PdfExtractionHeldProposalError)

MAX_INPUT_BYTES=512*1024
MAX_OUTPUT_BYTES=256*1024
HELP=('Offline private PDF held preparation: supply private_pdf_held_preparation_input v1 on stdin. '
      'Output retains payload, selection, distinct PDF provenance and exact private context together. '
      'It is unverified, detached and not captured; no issue replacement or publication is authorized. '
      'No path, source request, provider, backend or database is selected. Supervise EOF/deadline '
      'and discard all partial output unless the process exits zero and every part validates.\n')

class OfflinePdfHeldInputError(ValueError):pass
class OfflinePdfHeldTechnicalError(RuntimeError):pass


def _decode(raw):
    if type(raw) is not bytes or not 1<=len(raw)<=MAX_INPUT_BYTES:raise ValueError
    v=_closed(strict_json(raw),('schema_version','kind','custody_receipt_base64','intent_base64','expected','observed_at','context_base64'))
    if type(v['schema_version']) is not int or v['schema_version']!=1 or v['kind']!='private_pdf_held_preparation_input':raise ValueError
    ctx=bounded_binary(v['context_base64'],MAX_CONTEXT_BYTES)
    # Identical existing closed receipt/independent expectation dialect; no
    # value is inferred from the receipt. Only the fixed outer kind differs.
    base={k:value for k,value in v.items() if k!='context_base64'}
    base['kind']='private_pdf_result_custody_review_input'
    return (*_custody_input(_json(base)),ctx)


def preparation_from_envelope(raw):
    try:receipt,expected,intent,at,context=_decode(raw)
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError,RecursionError):
        raise OfflinePdfHeldInputError('pdf_held_preparation_unavailable')from None
    except Exception:raise OfflinePdfHeldTechnicalError('pdf_held_preparation_unavailable')from None
    try:parts=prepare_pdf_extraction_held_proposal(receipt,expected,context,intent_raw=intent,observed_at=at)
    except PdfExtractionHeldProposalError:
        raise OfflinePdfHeldInputError('pdf_held_preparation_unavailable')from None
    except Exception:raise OfflinePdfHeldTechnicalError('pdf_held_preparation_unavailable')from None
    try:
        if type(parts) is not DetachedPdfExtractionProposal:raise ValueError
        data={}
        for name,body,limit in (('payloadJson',parts.payload_raw,MAX_PAYLOAD_BYTES),('selectionJson',parts.selection_raw,2048),
                ('provenanceJson',parts.provenance_raw,MAX_PROVENANCE_BYTES),('contextJson',parts.context_raw,MAX_CONTEXT_BYTES)):
            if type(body)is not bytes or not 1<=len(body)<=limit:raise ValueError
            data[name]=body.decode('utf8','strict')
        output=_json(data)+b'\n'
        if len(output)>MAX_OUTPUT_BYTES:raise ValueError
        return output
    except Exception:raise OfflinePdfHeldTechnicalError('pdf_held_preparation_unavailable')from None


def main(*,args=None,stdin=None,stdout=None,stderr=None):
    args=sys.argv[1:]if args is None else args
    stdin=sys.stdin.buffer if stdin is None else stdin
    stdout=sys.stdout.buffer if stdout is None else stdout
    stderr=sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args==['--help']:stderr.write(HELP);return 0
            if args:stderr.write('offline_pdf_held_preparation_arguments_refused\n');return 2
            try:output=preparation_from_envelope(stdin.read(MAX_INPUT_BYTES+1))
            except OfflinePdfHeldInputError:stderr.write('offline_pdf_held_preparation_unavailable\n');return 2
            if stdout.write(output)!=len(output):raise OSError
            stdout.flush();return 0
    except Exception:
        try:stderr.write('offline_pdf_held_preparation_unavailable\n')
        except Exception:pass
        return 1

if __name__=='__main__':raise SystemExit(main())
