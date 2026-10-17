"""One fixed six-part command; synthetic custody does not authenticate storage."""
import base64,json,unittest
from dataclasses import replace
from io import BytesIO,StringIO
from pathlib import Path
from unittest.mock import patch
from tests.test_pdf_appended_issue_review import fixture
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import scripts.offline_pdf_whole_issue_review as m

b64=lambda v:base64.b64encode(v).decode('ascii')
def envelope(values):
    wire=json.loads((Path(__file__).resolve().parents[1]/'fixtures/fictional-pdf-result-review-input.json').read_bytes())['expected']
    e=values['expected']
    stored=dict(schema_version=1,kind='private_stored_pdf_preparation_input',custody_receipt_base64=b64(values['receipt']),intent_base64=b64(values['intent_raw']),expected=wire,
        observed_at=_stamp(values['observed_at']),preparation_receipt_base64=b64(values['raw']),preparation_intent_base64=b64(e.intent.canonical_metadata),preparation_artifact_id=e.artifact_id,preparation_stored_at=_stamp(e.stored_at))
    return dict(schema_version=1,kind='private_pdf_whole_issue_review_input',stored_preparation_input_base64=b64(_json(stored)),baseline_base64=b64(values['baseline_raw']),context_base64=b64(values['context_raw']))
def invoke(raw=b'',*,args=None,stdin=None,stdout=None):
    out=BytesIO()if stdout is None else stdout;err=StringIO()
    code=m.main(args=[]if args is None else args,stdin=BytesIO(raw)if stdin is None else stdin,stdout=out,stderr=err)
    return code,out.getvalue()if isinstance(out,BytesIO)else b'',err.getvalue()

class OfflinePdfWholeIssueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values,_=fixture();cls.value=envelope(cls.values);cls.raw=_json(cls.value)
    def test_actual_fixed_command_opens_originals_once_and_retains_all_six_parts(self):
        import workers.pdf_text_inspection as inspection
        children=[];start=inspection.subprocess.Popen
        def launch(*args,**kwargs):
            child=start(*args,**kwargs);children.append(child);return child
        with patch.object(inspection.subprocess,'Popen',side_effect=launch),patch.object(m,'prepare_pdf_appended_issue_review',wraps=m.prepare_pdf_appended_issue_review)as core:
            code,out,err=invoke(self.raw)
        self.assertEqual((code,err),(0,''));self.assertEqual((core.call_count,len(children)),(1,2));self.assertTrue(all(c.poll()is not None and all(getattr(c,k).closed for k in('stdin','stdout','stderr'))for c in children))
        value=json.loads(out);self.assertEqual(tuple(sorted(value)),tuple(sorted(m.PART_NAMES)));self.assertEqual(value['baselineJson'],self.values['baseline_raw'].decode());self.assertEqual(value['contextJson'],self.values['context_raw'].decode())
        old=json.loads(value['baselineJson']);proposal=json.loads(value['proposalJson']);self.assertEqual(proposal['snapshot']['claims'][:-1],old['snapshot']['claims']);self.assertEqual(len(proposal['snapshot']['claims']),3)
        self.assertLessEqual(len(out),m.MAX_OUTPUT_BYTES);self.assertTrue(out.endswith(b'\n'));self.assertNotIn(b'%PDF-',out);self.assertNotIn(b'base64',out)
        type(self).actual_input=self.raw;type(self).actual_output=out
    def test_closed_frames_duplicate_nonfinite_limits_and_nested_unknowns_refuse_before_composition(self):
        wrong=[b'{}',b'[]',b'\xff',b'{"x":NaN}',b'{"kind":1,"kind":2}',b'x'*(m.MAX_INPUT_BYTES+1)]
        for key,value in [('schema_version',True),('kind','private_stored_pdf_preparation_input'),('path','PRIVATE'),('stored_preparation_input_base64','!'),('baseline_base64',b64(b'{"x":1,"x":2}')),('context_base64',b64(b'[]')),('baseline_base64',b64(b'x'*(24576+1))),('context_base64',b64(b'x'*(32768+1)))]:wrong.append(_json(self.value|{key:value}))
        for key in self.value:v=dict(self.value);del v[key];wrong.append(_json(v))
        stored=json.loads(base64.b64decode(self.value['stored_preparation_input_base64']));stored['expected']['authenticated']=True;wrong.append(_json(self.value|dict(stored_preparation_input_base64=b64(_json(stored)))))
        with patch.object(m,'prepare_pdf_appended_issue_review')as core,patch('subprocess.Popen')as child:
            for raw in wrong:self.assertEqual(invoke(raw),(2,b'',m.CODE+'\n'))
            core.assert_not_called();child.assert_not_called()
    def test_independent_preparation_identity_and_stored_time_are_not_adopted_from_receipt(self):
        for key,value in [('preparation_artifact_id','b2000000-0000-4000-8000-000000000099'),('preparation_stored_at','2026-10-18T09:00:03.000000Z')]:
            stored=json.loads(base64.b64decode(self.value['stored_preparation_input_base64']));stored[key]=value
            with patch('subprocess.Popen',side_effect=AssertionError('No child'))as child:
                self.assertEqual(invoke(_json(self.value|dict(stored_preparation_input_base64=b64(_json(stored))))),(2,b'',m.CODE+'\n'));child.assert_not_called()
    def test_help_or_arguments_never_read_or_compose(self):
        class Never:
            def read(self,*args):raise AssertionError('No input')
        with patch.object(m,'prepare_pdf_appended_issue_review')as core:
            self.assertEqual(invoke(args=['--help'],stdin=Never()),(0,b'',m.HELP));self.assertEqual(invoke(args=['PRIVATE'],stdin=Never()),(2,b'','offline_pdf_whole_issue_review_arguments_refused\n'));core.assert_not_called()
    def test_curated_refusal_and_unexpected_failure_keep_private_details_out(self):
        with patch.object(m,'prepare_pdf_appended_issue_review',side_effect=m.PdfAppendedIssueReviewError('PRIVATE')):self.assertEqual(invoke(self.raw),(2,b'',m.CODE+'\n'))
        with patch.object(m,'prepare_pdf_appended_issue_review',side_effect=RuntimeError('PRIVATE')),patch('workers.error_diagnostics.record_worker_error')as diag:
            self.assertEqual(invoke(self.raw),(1,b'',m.CODE+'\n'));diag.assert_called_once_with('collector_worker',directory=None)
    def test_invalid_return_unicode_and_total_output_budget_withhold_every_part(self):
        with patch.object(m,'prepare_pdf_appended_issue_review',return_value=object()),patch('workers.error_diagnostics.record_worker_error'):
            self.assertEqual(invoke(self.raw),(1,b'',m.CODE+'\n'))
        for parts in [(b'\xff',)*6,(b'x'*65536,)*6]:
            with patch.object(m,'prepare_pdf_appended_issue_review',return_value=object()),patch.object(m,'pdf_composition_parts',return_value=parts),patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(self.raw),(1,b'',m.CODE+'\n'))
    def test_bounded_read_and_partial_write_or_flush_failure_do_not_retry(self):
        class Input:
            def __init__(self):self.seen=[]
            def read(self,n):self.seen.append(n);return b'{}'
        source=Input();self.assertEqual(invoke(stdin=source),(2,b'',m.CODE+'\n'));self.assertEqual(source.seen,[m.MAX_INPUT_BYTES+1])
        class Sink:
            def __init__(self,short):self.short=short;self.calls=0
            def write(self,raw):self.calls+=1;return len(raw)-1 if self.short else len(raw)
            def flush(self):raise OSError('PRIVATE')
        for short in(True,False):
            sink=Sink(short)
            with patch.object(m,'composition_from_envelope',return_value=b'{}\n')as core,patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(stdout=sink),(1,b'',m.CODE+'\n'));self.assertEqual((core.call_count,sink.calls),(1,1))

if __name__=='__main__':unittest.main()
