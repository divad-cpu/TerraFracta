"""Closed stdin/report behavior, expected holds and technical diagnostics."""
import base64
from dataclasses import asdict
from io import BytesIO,StringIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.offline_pdf_report import main,report_from_envelope,OfflinePdfInputError,MAX_INPUT_BYTES
from tests.helpers.pdf_fixture import pdf_bytes
from tests.test_pdf_text_inspection import NOW,receipt
from workers.pdf_text_inspection import PdfInspectionError


def envelope(raw=None):
    raw=pdf_bytes()if raw is None else raw;doc=asdict(receipt(raw));doc['retrieved_at']='2026-10-17T08:59:00.000000Z'
    return dict(schema_version=1,kind='private_pdf_inspection_input',raw_base64=base64.b64encode(raw).decode('ascii'),document=doc,observed_at='2026-10-17T09:00:00.000000Z')
def encoded(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def invoke(raw,args=None):
    out=BytesIO();err=StringIO();result=main(args=[]if args is None else args,stdin=BytesIO(raw),stdout=out,stderr=err)
    return result,out.getvalue(),err.getvalue()


class OfflinePdfReportTests(unittest.TestCase):
    def test_real_stdin_engine_produces_only_a_private_generated_report(self):
        value=envelope();code,out,err=invoke(encoded(value));report=json.loads(out)
        self.assertEqual(code,0);self.assertEqual(err,'');self.assertEqual(report['kind'],'private_pdf_text_inspection')
        self.assertEqual(report['pages'][0]['text'],'Invented native paragraph.');self.assertNotIn('raw_base64',report)
        self.assertLessEqual(len(out),131072);self.assertTrue(out.endswith(b'\n'))

    def test_duplicate_unknown_noncanonical_and_oversized_envelopes_refuse_without_child(self):
        bad=[]
        for change in[lambda v:v.update(schema_version=True),lambda v:v.update(secret='PRIVATE_INPUT'),
                       lambda v:v['document'].update(password='PRIVATE_INPUT'),lambda v:v.update(observed_at='2026-10-17T09:00:00Z'),
                       lambda v:v.update(raw_base64='YQ==\n'),lambda v:v['document'].update(content_sha256='f'*64)]:
            v=envelope();change(v);bad.append(encoded(v))
        bad.extend([b'{}',b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}',b'x'*(MAX_INPUT_BYTES+1)])
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            for raw in bad:
                with self.subTest(size=len(raw)):
                    code,out,err=invoke(raw);self.assertEqual(code,2);self.assertEqual(out,b'');self.assertEqual(err,'offline_pdf_report_input_refused\n')
            child.assert_not_called()

    def test_document_parse_hold_is_a_report_not_a_false_technical_error(self):
        code,out,err=invoke(encoded(envelope(b'%PDF-invalid')))
        self.assertEqual(code,0);self.assertEqual(err,'');report=json.loads(out)
        self.assertEqual(report['state'],'held');self.assertEqual(report['reason_code'],'pdf_parse_unavailable');self.assertEqual(report['pages'],[])

    def test_process_failure_is_a_generic_technical_error_not_invalid_input(self):
        with patch('scripts.offline_pdf_report.inspect_pdf_bytes',side_effect=PdfInspectionError('PRIVATE_FAILURE')), \
             patch('workers.error_diagnostics.record_worker_error')as diagnostic:
            code,out,err=invoke(encoded(envelope()))
        self.assertEqual(code,1);self.assertEqual(out,b'');self.assertEqual(err,'offline_pdf_report_unavailable\n')
        diagnostic.assert_called_once_with('collector_worker',directory=None)

    def test_help_and_forbidden_path_password_arguments_do_not_read_stdin(self):
        class NoRead:
            def read(self,*_):raise AssertionError('No input')
        for args,code in[(['--help'],0),(['PRIVATE_PATH'],2),(['--password','PRIVATE_PASSWORD'],2)]:
            out=BytesIO();err=StringIO();self.assertEqual(main(args=args,stdin=NoRead(),stdout=out,stderr=err),code)
            self.assertEqual(out.getvalue(),b'');self.assertNotIn('PRIVATE',err.getvalue())

    def test_incomplete_output_is_reported_without_exception_body(self):
        class ShortWrite:
            def write(self,body):return len(body)-1
            def flush(self):raise AssertionError('Must not flush incomplete output')
        err=StringIO()
        with patch('workers.error_diagnostics.record_worker_error')as diagnostic:
            self.assertEqual(main(args=[],stdin=BytesIO(encoded(envelope())),stdout=ShortWrite(),stderr=err),1)
        self.assertEqual(err.getvalue(),'offline_pdf_report_unavailable\n');diagnostic.assert_called_once_with('collector_worker',directory=None)
