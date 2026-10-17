"""One private supplied custody CLI, no SQL/store/source/provider selector."""
import base64
from io import BytesIO,StringIO
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_custody_review_report import values
from workers.passage_extraction_request import _canonical
from workers.pdf_passage_binding import _stamp
from workers.pdf_custody_review_report import PdfCustodyReviewReportError
from workers.pdf_extraction_review_report import MAX_PDF_EXTRACTION_REVIEW_BYTES
import scripts.offline_pdf_custody_review as m


def envelope():
    receipt,expected,intent,at,wire=values()
    return dict(schema_version=1,kind='private_pdf_result_custody_review_input',
        custody_receipt_base64=base64.b64encode(receipt).decode(),intent_base64=base64.b64encode(intent).decode(),
        expected=wire,observed_at=_stamp(at))


def invoke(raw=b'',*,args=None,stdin=None,stdout=None):
    out=BytesIO()if stdout is None else stdout;err=StringIO()
    code=m.main(args=[]if args is None else args,stdin=BytesIO(raw)if stdin is None else stdin,stdout=out,stderr=err)
    return code,out.getvalue()if isinstance(out,BytesIO)else b'',err.getvalue()


class OfflinePdfCustodyReviewTests(unittest.TestCase):
    success_input=None
    success_stdout=None
    def test_actual_fixed_stdin_opens_two_originals_once_and_retains_exact_private_report(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        raw=_canonical(envelope())
        with patch.object(inspector.subprocess,'Popen',side_effect=start), \
                patch.object(m,'pdf_custody_review_report',wraps=m.pdf_custody_review_report)as core:
            code,out,err=invoke(raw)
        self.assertEqual((code,err),(0,''));self.assertEqual(core.call_count,1);self.assertEqual(len(children),2)
        self.assertTrue(all(p.poll()is not None and all(getattr(p,k).closed for k in('stdin','stdout','stderr'))for p in children))
        report=json.loads(out)
        self.assertEqual(report['selected_passages'][0]['text'],'CLI_CURRENT_SELECTED')
        self.assertEqual(report['selected_passages'][0]['earlier'][0]['text'],'CLI_PRIOR_SELECTED')
        self.assertEqual(report['context']['storage'],'not_observed');self.assertEqual(report['proposal']['review_state'],'unverified')
        self.assertLessEqual(len(out),m.MAX_OUTPUT_BYTES);self.assertTrue(out.endswith(b'\n'))
        for hidden in (b'%PDF-',b'base64',b'PRIVATE_PDF_METADATA_CANARY',b'"instructions"',b'"artifact_id"'):
            self.assertNotIn(hidden,out)
        type(self).success_input=raw;type(self).success_stdout=out

    def test_closed_json_nested_expected_duplicate_nonfinite_bool_or_unknown_keys_before_core(self):
        invalid=[b'{}',b'[]',b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}',b'\xff']
        changes=[lambda v:v.update(schema_version=True),lambda v:v.update(kind='authenticated_custody'),
            lambda v:v.update(filename='PRIVATE_PATH'),lambda v:v.pop('intent_base64'),lambda v:v.pop('expected'),
            lambda v:v['expected'].update(backend='PRIVATE_DB'),lambda v:v['expected']['current'].update(packet_base64='PRIVATE'),
            lambda v:v['expected']['previous']['document'].update(secret='PRIVATE'),
            lambda v:v['expected']['current']['mapping']['selections'][0].update(page_number=True),
            lambda v:v['expected']['request'].update(maximum_output_tokens=True),
            lambda v:v['expected'].update(output_sha256=True),lambda v:v['expected'].pop('previous')]
        for change in changes:
            value=envelope();change(value);invalid.append(_canonical(value))
        with patch.object(m,'pdf_custody_review_report',side_effect=AssertionError('No core'))as core:
            for raw in invalid:self.assertEqual(invoke(raw),(2,b'','offline_pdf_custody_review_unavailable\n'))
            core.assert_not_called()

    def test_canonical_base64_bounds_exact_utc_and_independent_request_refuse_before_core(self):
        changes=[lambda v:v.update(intent_base64='YQ==\n'),lambda v:v.update(custody_receipt_base64='!!!!'),
            lambda v:v.update(custody_receipt_base64=v['custody_receipt_base64']+'\n'),
            lambda v:v.update(intent_base64=base64.b64encode(b'x'*2049).decode()),
            lambda v:v.update(custody_receipt_base64=base64.b64encode(b'x'*131073).decode()),
            lambda v:v.update(observed_at='2026-02-30T00:00:00.000000Z'),
            lambda v:v.update(observed_at='2026-10-18T09:00:00Z'),
            lambda v:v['expected'].update(prepared_at='2026-10-17T09:00:00.000000+00:00'),
            lambda v:v['expected']['request'].update(request_sha256='f'*64)]
        with patch.object(m,'pdf_custody_review_report',side_effect=AssertionError('No core'))as core:
            for change in changes:
                value=envelope();change(value)
                self.assertEqual(invoke(_canonical(value)),(2,b'','offline_pdf_custody_review_unavailable\n'))
            core.assert_not_called()

    def test_bad_prior_or_independent_intent_packet_time_never_falls_back_or_starts_a_child(self):
        changes=[lambda v:v['expected'].update(previous=None),lambda v:v['expected'].update(previous={}),
            lambda v:v['expected'].update(packet_sha256='f'*64),lambda v:v['expected'].update(output_sha256='e'*64),
            lambda v:v.update(intent_base64=base64.b64encode(b'{}').decode()),
            lambda v:v.update(observed_at=v['expected']['prepared_at']),
            lambda v:v['expected']['previous']['document'].update(content_sha256='f'*64)]
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            for change in changes:
                value=envelope();change(value)
                self.assertEqual(invoke(_canonical(value)),(2,b'','offline_pdf_custody_review_unavailable\n'))
            child.assert_not_called()

    def test_input_read_once_bounded_new_cap_old_result_and_request_caps_unchanged(self):
        import scripts.offline_pdf_result_review as old
        import scripts.offline_pdf_request_context as older
        class Read:
            def __init__(self,value):self.value=value;self.requests=[]
            def read(self,size):self.requests.append(size);return self.value
        with patch.object(m,'pdf_custody_review_report',side_effect=AssertionError('No core'))as core:
            for raw in (b'','PRIVATE_STRING',b'x'*(m.MAX_INPUT_BYTES+1)):
                stream=Read(raw);self.assertEqual(invoke(stdin=stream),(2,b'','offline_pdf_custody_review_unavailable\n'))
                self.assertEqual(stream.requests,[m.MAX_INPUT_BYTES+1])
            core.assert_not_called()
        self.assertEqual(m.MAX_INPUT_BYTES,512*1024);self.assertEqual(old.MAX_INPUT_BYTES,3*1024*1024)
        self.assertEqual(older.MAX_INPUT_BYTES,2*1024*1024);self.assertEqual(m.MAX_OUTPUT_BYTES,384*1024+1)

    def test_help_and_foreign_arguments_never_read_or_echo_private_inputs(self):
        class NoRead:
            def read(self,*args):raise AssertionError('No stdin')
        with patch.object(m,'pdf_custody_review_report',side_effect=AssertionError('No core'))as core:
            for args,code in ((['--help'],0),(['PRIVATE_PATH'],2),(['--url','https://private.invalid'],2),
                              (['--output','/home/PRIVATE_PATH'],2),(['--database','PRIVATE_DB'],2)):
                actual,out,err=invoke(args=args,stdin=NoRead());self.assertEqual((actual,out),(code,b''))
                self.assertNotIn('PRIVATE',err)
                if code==0:self.assertIn('storage remains not_observed',err)
            core.assert_not_called()

    def test_curated_unavailable_two_unexpected_core_or_decoder_one_no_private_leak(self):
        raw=_canonical(envelope())
        with patch.object(m,'pdf_custody_review_report',side_effect=PdfCustodyReviewReportError('PRIVATE_BODY')), \
                patch('workers.error_diagnostics.record_worker_error')as diagnostic:
            self.assertEqual(invoke(raw),(2,b'','offline_pdf_custody_review_unavailable\n'));diagnostic.assert_not_called()
        for target in ('pdf_custody_review_report','_decode'):
            with patch.object(m,target,side_effect=RuntimeError('PRIVATE_BACKEND /home/private')), \
                    patch('workers.error_diagnostics.record_worker_error')as diagnostic:
                self.assertEqual(invoke(raw),(1,b'','offline_pdf_custody_review_unavailable\n'))
                diagnostic.assert_called_once_with('collector_worker',directory=None)

    def test_output_cap_exact_bytes_and_short_write_or_flush_failure_no_retry(self):
        raw=_canonical(envelope())
        with patch.object(m,'pdf_custody_review_report',return_value=b'x'*MAX_PDF_EXTRACTION_REVIEW_BYTES):
            code,out,err=invoke(raw);self.assertEqual((code,err),(0,''));self.assertEqual(len(out),m.MAX_OUTPUT_BYTES)
        for output in (b'',b'x'*(MAX_PDF_EXTRACTION_REVIEW_BYTES+1),'PRIVATE',bytearray(b'{}')):
            with patch.object(m,'pdf_custody_review_report',return_value=output),patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(raw),(1,b'','offline_pdf_custody_review_unavailable\n'))
        class Short:
            def write(self,value):return len(value)-1
            def flush(self):raise AssertionError('No flush after short write')
        class Flush:
            def write(self,value):return len(value)
            def flush(self):raise OSError('PRIVATE_FLUSH')
        for sink in (Short(),Flush()):
            with patch.object(m,'report_from_envelope',return_value=b'{}\n')as core,patch('workers.error_diagnostics.record_worker_error')as diagnostic:
                self.assertEqual(invoke(stdout=sink),(1,b'','offline_pdf_custody_review_unavailable\n'))
                self.assertEqual(core.call_count,1);diagnostic.assert_called_once_with('collector_worker',directory=None)


if __name__=='__main__':unittest.main()
