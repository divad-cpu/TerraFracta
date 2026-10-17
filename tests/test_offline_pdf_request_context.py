"""New fixed stdin boundary for supplied PDF historical request contexts only."""
import base64
from dataclasses import asdict, replace
from datetime import timedelta
from hashlib import sha256
from io import BytesIO, StringIO
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_passage_comparison import capture, NOW
from tests.test_pdf_request_packet_context import reference
from workers.pdf_derivation_packet import prepare_pdf_derivation_packet, MAX_PACKET_BYTES
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_request_packet_context import PdfRequestPacketContextError
from workers.passage_extraction_request import MAX_REQUEST_BYTES
import scripts.offline_pdf_request_context as m

LATER=NOW+timedelta(days=1)


def stamp(at):return at.isoformat(timespec='microseconds').replace('+00:00','Z')
def encoded(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()


def wire_reference(packet,value):
    ref=reference(packet,value);e=asdict(ref.expected)
    e['recorded_observed_at']=stamp(e['recorded_observed_at'])
    e['document']['retrieved_at']=stamp(e['document']['retrieved_at']);e['binding']['retrieved_at']=stamp(e['binding']['retrieved_at'])
    return dict(packet_base64=base64.b64encode(ref.raw).decode(),expected=e)


def wire_request(request):
    return dict(item_key=request.item_key,body_base64=base64.b64encode(request.body).decode(),
        request_sha256=request.request_sha256,selected_payload_sha256=request.selected_payload_sha256,
        maximum_output_tokens=request.maximum_output_tokens)


def invoke(raw,*,args=None,stdin=None,stdout=None):
    out=BytesIO()if stdout is None else stdout;err=StringIO()
    code=m.main(args=[]if args is None else args,stdin=BytesIO(raw)if stdin is None else stdin,stdout=out,stderr=err)
    return code,out.getvalue()if isinstance(out,BytesIO)else b'',err.getvalue()


class OfflinePdfRequestContextTests(unittest.TestCase):
    success_input=None
    success_stdout=None

    @classmethod
    def setUpClass(cls):
        cls.current=capture(('CLI_CURRENT_SELECTED',None),version=2)
        cls.previous=capture(('CLI_PRIOR_SELECTED',None),version=1,age=2)
        cls.current_packet=prepare_pdf_derivation_packet(cls.current,recorded_observed_at=NOW)
        cls.previous_packet=prepare_pdf_derivation_packet(cls.previous,recorded_observed_at=NOW)
        cls.request=compile_pdf_extraction_request(cls.current,cls.previous,observed_at=NOW,maximum_output_tokens=100)
        cls.initial_request=compile_pdf_extraction_request(cls.current,observed_at=NOW,maximum_output_tokens=100)
        cls.input=dict(schema_version=1,kind='private_pdf_request_context_input',
            current=wire_reference(cls.current_packet,cls.current),previous=wire_reference(cls.previous_packet,cls.previous),
            request=wire_request(cls.request),reopened_at=stamp(LATER),maximum_output_tokens=100)

    def fresh(self):return json.loads(encoded(self.input))

    def test_actual_two_vintage_stdin_core_once_two_children_and_private_metadata_only(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            process=launch(*args,**kwargs);children.append(process);return process
        raw=encoded(self.fresh())
        with patch.object(inspector.subprocess,'Popen',side_effect=start),patch.object(m,'reopen_pdf_request_packet_context',wraps=m.reopen_pdf_request_packet_context)as core:
            code,out,err=invoke(raw)
        self.assertEqual(code,0);self.assertEqual(err,'');self.assertEqual(core.call_count,1);self.assertEqual(len(children),2)
        self.assertTrue(all(p.poll()is not None and all(getattr(p,n).closed for n in('stdin','stdout','stderr'))for p in children))
        report=json.loads(out);self.assertEqual(report['kind'],'private_pdf_request_context_report')
        self.assertEqual(report['scope'],'supplied_unverified_pdf_request_context_rederivation_only')
        self.assertEqual(report['recorded_observed_at'],stamp(NOW));self.assertEqual(report['reopened_at'],stamp(LATER))
        self.assertEqual(report['request']['request_sha256'],self.request.request_sha256)
        self.assertEqual(report['request']['request_bytes'],len(self.request.body));self.assertEqual(report['request']['item_key'],self.current.document.item_key)
        for name,packet in[('current',self.current_packet),('previous',self.previous_packet)]:
            self.assertEqual(report[name]['packet_sha256'],packet.packet_sha256)
            self.assertEqual(report[name]['inspection_sha256'],packet.inspection_sha256)
            self.assertEqual(report[name]['derivation_sha256'],packet.derivation_sha256)
        self.assertTrue(all(v is False for v in report['qualification'].values()))
        for hidden in[b'CLI_CURRENT_SELECTED',b'CLI_PRIOR_SELECTED',b'%PDF',b'example.invalid',b'base64',b'inspection_report',b'raw_packet']:
            self.assertNotIn(hidden,out)
        self.assertLessEqual(len(out),m.MAX_OUTPUT_BYTES);self.assertTrue(out.endswith(b'\n'))
        # Read by the author's separate fixed evidence runner after this scope;
        # ordinary CI tests never choose or write a retained-file destination.
        type(self).success_input=raw;type(self).success_stdout=out

    def test_explicit_initial_observation_has_one_original_and_no_prior_reference(self):
        value=self.fresh();value['previous']=None;value['request']=wire_request(self.initial_request)
        import workers.pdf_text_inspection as inspector
        with patch.object(inspector.subprocess,'Popen',wraps=inspector.subprocess.Popen)as child:
            code,out,err=invoke(encoded(value))
        self.assertEqual((code,err),(0,''));self.assertIsNone(json.loads(out)['previous']);self.assertEqual(child.call_count,1)

    def test_closed_duplicate_nonfinite_extra_bool_and_json_shape_refuse_before_core(self):
        invalid=[b'{}',b'[]',b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}',b'\xff']
        for change in[lambda v:v.update(schema_version=True),lambda v:v.update(kind='public_update'),lambda v:v.update(secret='PRIVATE'),
            lambda v:v['current'].update(path='PRIVATE_PATH'),lambda v:v['current']['expected'].update(authenticated=True),
            lambda v:v['current']['expected']['document'].update(password='PRIVATE'),
            lambda v:v['current']['expected']['mapping']['selections'][0].update(page_number=True),
            lambda v:v['request'].update(evidence_state='approved'),lambda v:v.update(maximum_output_tokens=True),
            lambda v:v['request'].update(maximum_output_tokens=101),lambda v:v.pop('previous')]:
            value=self.fresh();change(value);invalid.append(encoded(value))
        with patch.object(m,'reopen_pdf_request_packet_context',side_effect=AssertionError('No core'))as core:
            for raw in invalid:
                code,out,err=invoke(raw);self.assertEqual((code,out,err),(2,b'','offline_pdf_request_context_unavailable\n'))
            core.assert_not_called()

    def test_exact_utc_base64_and_component_capacity_refuse_before_core(self):
        mutations=[lambda v:v.update(reopened_at='2026-02-30T00:00:00.000000Z'),lambda v:v.update(reopened_at='2026-10-18T09:00:00Z'),
            lambda v:v.update(reopened_at='2026-10-18T09:00:00.000000+00:00'),
            lambda v:v['current']['expected']['binding'].update(retrieved_at='0000-01-01T00:00:00.000000Z'),
            lambda v:v['current'].update(packet_base64=v['current']['packet_base64']+'\n'),
            lambda v:v['current'].update(packet_base64=base64.b64encode(b'x'*(MAX_PACKET_BYTES+1)).decode()),
            lambda v:v['request'].update(body_base64=base64.b64encode(b'x'*(MAX_REQUEST_BYTES+1)).decode()),
            lambda v:v['request'].update(body_base64='YQ==\n'),lambda v:v['request'].update(request_sha256='f'*64)]
        with patch.object(m,'reopen_pdf_request_packet_context',side_effect=AssertionError('No core'))as core:
            for change in mutations:
                value=self.fresh();change(value);code,out,err=invoke(encoded(value));self.assertEqual((code,out),(2,b''));self.assertNotIn('PRIVATE',err)
            core.assert_not_called()

    def test_invalid_previous_and_independent_packet_identity_never_fall_back_before_child(self):
        changes=[lambda v:v.update(previous={}),lambda v:v['previous']['expected'].update(packet_sha256='f'*64),
            lambda v:v['previous']['expected']['document'].update(content_sha256='f'*64),
            lambda v:v['current']['expected']['mapping'].update(mapping_sha256='f'*64),
            lambda v:v['previous']['expected'].update(recorded_observed_at=stamp(NOW+timedelta(microseconds=1))),
            lambda v:v.update(reopened_at=stamp(NOW-timedelta(microseconds=1)))]
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes',side_effect=AssertionError('No child'))as child:
            for change in changes:
                value=self.fresh();change(value);code,out,err=invoke(encoded(value));self.assertEqual((code,out,err),(2,b'','offline_pdf_request_context_unavailable\n'))
            child.assert_not_called()

    def test_input_read_is_bounded_and_oversized_or_nonbytes_returns_no_context(self):
        class Read:
            def __init__(self,value):self.value=value;self.requests=[]
            def read(self,n):self.requests.append(n);return self.value
        with patch.object(m,'reopen_pdf_request_packet_context',side_effect=AssertionError('No core'))as core:
            for value in[b'x'*(m.MAX_INPUT_BYTES+1),'PRIVATE_STRING',b'']:
                stream=Read(value);code,out,err=invoke(b'',stdin=stream);self.assertEqual((code,out),(2,b''));self.assertEqual(stream.requests,[m.MAX_INPUT_BYTES+1])
            core.assert_not_called()
        self.assertEqual(m.MAX_INPUT_BYTES,2097152);self.assertEqual(m.MAX_OUTPUT_BYTES,16384)

    def test_help_and_forbidden_filename_url_password_arguments_never_read_input(self):
        class NoRead:
            def read(self,*_):raise AssertionError('No input')
        for args,expected in[(['--help'],0),(['PRIVATE_PATH'],2),(['--url','https://private.invalid'],2),(['--password','PRIVATE_PASSWORD'],2)]:
            code,out,err=invoke(b'',args=args,stdin=NoRead());self.assertEqual((code,out),(expected,b''));self.assertNotIn('PRIVATE',err)
            if expected==0:self.assertIn('not a source-quality verdict',err)

    def test_core_refusal_is_not_source_quality_and_unexpected_fault_has_only_fixed_diagnostic(self):
        raw=encoded(self.fresh())
        with patch.object(m,'reopen_pdf_request_packet_context',side_effect=PdfRequestPacketContextError('PRIVATE_SOURCE_CANARY')),patch('workers.error_diagnostics.record_worker_error')as diag:
            self.assertEqual(invoke(raw),(2,b'','offline_pdf_request_context_unavailable\n'));diag.assert_not_called()
        with patch.object(m,'reopen_pdf_request_packet_context',side_effect=RuntimeError('PRIVATE_SOURCE_CANARY /home/private')),patch('workers.error_diagnostics.record_worker_error')as diag:
            self.assertEqual(invoke(raw),(1,b'','offline_pdf_request_context_unavailable\n'));diag.assert_called_once_with('collector_worker',directory=None)
            with self.assertRaises(m.OfflinePdfRequestContextTechnicalError)as caught:m.report_from_envelope(raw)
            self.assertEqual(str(caught.exception),'pdf_request_context_unavailable');self.assertIsNone(caught.exception.__cause__)

    def test_short_output_flush_and_input_faults_preserve_static_error_without_retry(self):
        class Short:
            def write(self,raw):return len(raw)-1
            def flush(self):raise AssertionError('No flush')
        class Flush:
            def write(self,raw):return len(raw)
            def flush(self):raise OSError('PRIVATE_FLUSH')
        class Input:
            def read(self,n):raise OSError('PRIVATE_READ')
        for output in[Short(),Flush()]:
            with patch.object(m,'report_from_envelope',return_value=b'{"unverified":true}\n')as report,patch('workers.error_diagnostics.record_worker_error')as diag:
                self.assertEqual(invoke(b'{}',stdout=output),(1,b'','offline_pdf_request_context_unavailable\n'));self.assertEqual(report.call_count,1);diag.assert_called_once_with('collector_worker',directory=None)
        with patch('workers.error_diagnostics.record_worker_error')as diag:
            self.assertEqual(invoke(b'',stdin=Input()),(1,b'','offline_pdf_request_context_unavailable\n'));diag.assert_called_once_with('collector_worker',directory=None)


class OfflinePdfRequestContextDecoderFaultTests(unittest.TestCase):
    def test_unexpected_decoder_fault_is_technical_not_a_supplied_context_refusal(self):
        # Resource-free: this class does not inherit the invented PDF setup.
        with patch.object(m,'_decode',side_effect=RuntimeError('PRIVATE_DECODER /home/private')),patch('workers.error_diagnostics.record_worker_error')as diagnostic:
            self.assertEqual(invoke(b'{}'),(1,b'','offline_pdf_request_context_unavailable\n'))
            diagnostic.assert_called_once_with('collector_worker',directory=None)
            with self.assertRaises(m.OfflinePdfRequestContextTechnicalError)as caught:m.report_from_envelope(b'{}')
            self.assertEqual(str(caught.exception),'pdf_request_context_unavailable');self.assertIsNone(caught.exception.__cause__)
        with patch.object(m,'_decode',side_effect=ValueError('PRIVATE_INPUT')),patch('workers.error_diagnostics.record_worker_error')as diagnostic:
            self.assertEqual(invoke(b'{}'),(2,b'','offline_pdf_request_context_unavailable\n'));diagnostic.assert_not_called()
