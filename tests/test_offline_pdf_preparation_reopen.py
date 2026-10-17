"""Fixed portable PDF preparation command; no backend or native replay."""
import base64,json,unittest
from datetime import timedelta
from io import BytesIO,StringIO
from unittest.mock import patch
from dataclasses import replace
from tests.test_pdf_proposal_custody import inputs
from tests.test_offline_pdf_held_preparation import envelope as held_envelope
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody,ReobservedPdfProposal
from workers.pdf_preparation_packet import prepare_pdf_preparation_packet,PdfPreparationPacketError
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import scripts.offline_pdf_preparation_reopen as m


def invoke(raw=b'',*,args=None,stdin=None,stdout=None):
    out=BytesIO()if stdout is None else stdout;err=StringIO()
    code=m.main(args=[]if args is None else args,stdin=BytesIO(raw)if stdin is None else stdin,stdout=out,stderr=err)
    return code,out.getvalue()if isinstance(out,BytesIO)else b'',err.getvalue()


class OfflinePdfPreparationReopenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=inputs();cls.prepared=prepare_pdf_proposal_custody(**cls.data)
        p=cls.prepared;cls.packet=prepare_pdf_preparation_packet(p)
        v=held_envelope();v.pop('context_base64');v.update(kind='private_pdf_preparation_reopen_input',
            preparation_packet_base64=base64.b64encode(cls.packet).decode(),preparation_intent_base64=base64.b64encode(p.intent.canonical_metadata).decode(),
            checkpoint_at=_stamp(p.observed_at+timedelta(seconds=1)),observed_at=_stamp(p.observed_at+timedelta(days=2)))
        cls.envelope=v;cls.raw=_json(v)

    def test_actual_command_opens_each_original_once_and_preserves_historical_parts(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start),patch.object(m,'reopen_pdf_preparation_packet',wraps=m.reopen_pdf_preparation_packet)as core:code,out,err=invoke(self.raw)
        self.assertEqual((code,err),(0,''));self.assertEqual(core.call_count,1);self.assertEqual(len(children),2)
        self.assertTrue(all(c.poll()is not None and c.stdin.closed and c.stdout.closed and c.stderr.closed for c in children))
        value=json.loads(out);p=self.prepared.parts
        self.assertEqual(value,dict(payloadJson=p.payload_raw.decode(),selectionJson=p.selection_raw.decode(),provenanceJson=p.provenance_raw.decode(),contextJson=p.context_raw.decode()))
        self.assertTrue(out.endswith(b'\n'));self.assertLessEqual(len(out),m.MAX_OUTPUT_BYTES)
        self.assertNotIn(b'base64',out);self.assertNotIn(b'%PDF-',out)

    def test_closed_framing_and_all_external_assertions_refuse_before_core(self):
        cases=[b'{}',b'[]',b'\xff',b'{"kind":"x","kind":"y"}',b'x'*(m.MAX_INPUT_BYTES+1)]
        for key,value in [('kind','private_pdf_held_preparation_input'),('schema_version',True),('preparation_packet_base64','!'),('preparation_intent_base64','!'),('checkpoint_at','PRIVATE'),('path','/PRIVATE')]:cases.append(_json({**self.envelope,key:value}))
        for key in self.envelope:
            v=dict(self.envelope);v.pop(key);cases.append(_json(v))
        with patch.object(m,'reopen_pdf_preparation_packet',side_effect=AssertionError('No core'))as core:
            for raw in cases:self.assertEqual(invoke(raw),(2,b'','offline_pdf_preparation_reopen_unavailable\n'))
            core.assert_not_called()

    def test_refusal_and_unexpected_technical_failure_have_different_exit_codes(self):
        with patch.object(m,'reopen_pdf_preparation_packet',side_effect=PdfPreparationPacketError('PRIVATE')):self.assertEqual(invoke(self.raw),(2,b'','offline_pdf_preparation_reopen_unavailable\n'))
        with patch.object(m,'reopen_pdf_preparation_packet',side_effect=RuntimeError('PRIVATE')),patch('workers.error_diagnostics.record_worker_error')as diag:
            self.assertEqual(invoke(self.raw),(1,b'','offline_pdf_preparation_reopen_unavailable\n'));self.assertTrue(diag.called)

    def test_help_and_argument_refusal_do_not_read_or_open_anything(self):
        class Never:
            def read(self,*args):raise AssertionError('No stdin')
        with patch.object(m,'reopen_pdf_preparation_packet')as core:
            self.assertEqual(invoke(args=['--help'],stdin=Never()),(0,b'',m.HELP))
            self.assertEqual(invoke(args=['/PRIVATE'],stdin=Never()),(2,b'','offline_pdf_preparation_reopen_arguments_refused\n'));core.assert_not_called()

    def test_four_part_encoding_type_limits_and_unicode_fail_privately(self):
        p=self.prepared;r=ReobservedPdfProposal(p.intent,p.parts,p.observed_at,p.observed_at,p.observed_at,p.observed_at)
        for field,value in [('payload_raw',b'x'*16385),('selection_raw',b'x'*2049),('provenance_raw',b'x'*65537),('context_raw',b'x'*32769),('context_raw',b'\xff'),('payload_raw',bytearray(b'{}'))]:
            with patch.object(m,'reopen_pdf_preparation_packet',return_value=replace(r,parts=replace(r.parts,**{field:value}))),patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(self.raw),(1,b'','offline_pdf_preparation_reopen_unavailable\n'))

    def test_input_fault_and_partial_output_are_technical_and_never_retry(self):
        class Fault:
            def read(self,*args):raise OSError('PRIVATE')
        class Sink:
            def __init__(self,short):self.short=short;self.calls=0
            def write(self,raw):self.calls+=1;return len(raw)-1 if self.short else len(raw)
            def flush(self):raise OSError('PRIVATE')
        with patch('workers.error_diagnostics.record_worker_error'):self.assertEqual(invoke(stdin=Fault()),(1,b'','offline_pdf_preparation_reopen_unavailable\n'))
        for short in [True,False]:
            sink=Sink(short)
            with patch.object(m,'preparation_from_envelope',return_value=b'{}\n')as core,patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(stdout=sink),(1,b'','offline_pdf_preparation_reopen_unavailable\n'));self.assertEqual((core.call_count,sink.calls),(1,1))

if __name__=='__main__':unittest.main()
