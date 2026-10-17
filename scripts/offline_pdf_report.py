"""One private stdin-only PDF inspection; no source URL or filename is opened."""
import base64
from datetime import datetime
import json
from re import fullmatch
import sys

from workers.error_diagnostics import diagnostic_worker
from workers.pdf_text_inspection import PdfDocumentReceipt,PdfInspectionError,PdfInspectionInputError,inspect_pdf_bytes,_object,_constant,_encode,LIMITS

MAX_INPUT_BYTES=96*1024
HELP='Offline PDF inspection: supply private_pdf_inspection_input v1 on stdin. Derived page text is private unverified material; no OCR, factual acceptance, storage or publication.\n'


class OfflinePdfInputError(ValueError):pass


def _instant(value):
    if type(value)is not str or fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z',value)is None:raise ValueError
    return datetime.fromisoformat(value)


def report_from_envelope(raw):
    try:
        if type(raw)is not bytes or not 1<=len(raw)<=MAX_INPUT_BYTES:raise ValueError
        v=json.loads(raw.decode('utf8'),object_pairs_hook=_object,parse_constant=_constant)
        if(type(v)is not dict or set(v)!={'schema_version','kind','raw_base64','document','observed_at'}or type(v['schema_version'])is not int
           or v['schema_version']!=1 or v['kind']!='private_pdf_inspection_input'or type(v['raw_base64'])is not str
           or not 1<=len(v['raw_base64'])<=4*((LIMITS['max_input_bytes']+2)//3)):raise ValueError
        data=base64.b64decode(v['raw_base64'],validate=True)
        if base64.b64encode(data).decode('ascii')!=v['raw_base64']:raise ValueError
        doc=v['document']
        if type(doc)is not dict or set(doc)!={'source_key','item_key','source_version_id','source_url','content_sha256','retrieved_at','media_type'}or any(type(x)is not str for x in doc.values()):raise ValueError
        observed=_instant(v['observed_at']);receipt=PdfDocumentReceipt(**{**doc,'retrieved_at':_instant(doc['retrieved_at'])})
    except Exception:raise OfflinePdfInputError('pdf_input_refused')from None
    try:output=_encode(inspect_pdf_bytes(data,receipt,observed_at=observed))
    except PdfInspectionInputError:raise OfflinePdfInputError('pdf_inspection_refused')from None
    if len(output)>LIMITS['max_output_bytes']:raise OfflinePdfInputError('pdf_output_refused')
    return output


def main(*,args=None,stdin=None,stdout=None,stderr=None):
    args=sys.argv[1:]if args is None else args;stdin=sys.stdin.buffer if stdin is None else stdin
    stdout=sys.stdout.buffer if stdout is None else stdout;stderr=sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args==['--help']:stderr.write(HELP);return 0
            if args:stderr.write('offline_pdf_report_arguments_refused\n');return 2
            try:output=report_from_envelope(stdin.read(MAX_INPUT_BYTES+1))
            except OfflinePdfInputError:stderr.write('offline_pdf_report_input_refused\n');return 2
            if stdout.write(output)!=len(output):raise OSError
            stdout.flush();return 0
    except Exception:
        try:stderr.write('offline_pdf_report_unavailable\n')
        except Exception:pass
        return 1


if __name__=='__main__':raise SystemExit(main())
