"""New fixed candidate entry; no old result/custody/native replay."""
import base64,json,unittest
from io import BytesIO,StringIO
from unittest.mock import patch
from dataclasses import replace
from tests.test_pdf_extraction_held_proposal import inputs,prepare
from tests.test_offline_pdf_custody_review import envelope as custody_envelope
from workers.private_extraction_held_proposal import _json
from workers.pdf_extraction_held_proposal import PdfExtractionHeldProposalError
import scripts.offline_pdf_held_preparation as m


def envelope():
    v=custody_envelope();v['kind']='private_pdf_held_preparation_input'
    v['context_base64']=base64.b64encode(_json(inputs()[-1])).decode();return v


def invoke(raw=b'',*,args=None,stdin=None,stdout=None):
    out=BytesIO()if stdout is None else stdout;err=StringIO()
    code=m.main(args=[]if args is None else args,stdin=BytesIO(raw)if stdin is None else stdin,stdout=out,stderr=err)
    return code,out.getvalue()if isinstance(out,BytesIO)else b'',err.getvalue()


class OfflinePdfHeldPreparationTests(unittest.TestCase):
    def test_actual_fixed_command_opens_each_original_once_and_keeps_four_exact_parts(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            p=launch(*args,**kwargs);children.append(p);return p
        with patch.object(inspector.subprocess,'Popen',side_effect=start),patch.object(m,'prepare_pdf_extraction_held_proposal',wraps=m.prepare_pdf_extraction_held_proposal)as core:
            code,out,err=invoke(_json(envelope()))
        self.assertEqual((code,err),(0,''));self.assertEqual(core.call_count,1);self.assertEqual(len(children),2)
        self.assertTrue(all(p.poll()is not None and all(getattr(p,k).closed for k in('stdin','stdout','stderr'))for p in children))
        b=json.loads(out);self.assertEqual(set(b),{'payloadJson','selectionJson','provenanceJson','contextJson'})
        p=json.loads(b['provenanceJson']);self.assertEqual(p['kind'],'detached_pdf_extraction_proposal')
        self.assertEqual(json.loads(b['payloadJson'])['kind'],'review_only');self.assertEqual(b['contextJson'],_json(inputs()[-1]).decode())
        from hashlib import sha256
        for key,field in [('payloadJson','payload_sha256'),('selectionJson','selection_sha256'),('contextJson','supplied_context_sha256')]:self.assertEqual(sha256(b[key].encode()).hexdigest(),p[field])
        self.assertNotIn(b'%PDF-',out);self.assertNotIn(b'base64',out);self.assertNotIn(b'PRIVATE_PDF_METADATA_CANARY',out)
        self.assertLessEqual(len(out),m.MAX_OUTPUT_BYTES);self.assertTrue(out.endswith(b'\n'))

    def test_closed_framing_base64_and_expectations_refuse_before_core(self):
        raw=[b'{}',b'[]',b'\xff',b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}']
        for change in [lambda v:v.update(schema_version=True),lambda v:v.update(kind='private_pdf_result_custody_review_input'),lambda v:v.update(path='PRIVATE'),lambda v:v.pop('context_base64'),lambda v:v.pop('expected'),lambda v:v.update(context_base64='YQ==\n'),lambda v:v.update(context_base64=base64.b64encode(b'x'*32769).decode()),lambda v:v['expected'].update(backend='PRIVATE'),lambda v:v['expected']['request'].update(request_sha256='f'*64),lambda v:v.update(observed_at='2026-02-30T00:00:00.000000Z')]:
            v=envelope();change(v);raw.append(_json(v))
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No core'))as core:
            for v in raw:self.assertEqual(invoke(v),(2,b'','offline_pdf_held_preparation_unavailable\n'))
            core.assert_not_called()

    def test_independent_context_and_receipt_mismatch_are_not_approved_or_inferred(self):
        for change in [lambda v:v.update(intent_base64=base64.b64encode(b'{}').decode()),lambda v:v['expected'].update(previous=None),lambda v:v.update(context_base64=base64.b64encode(b'not JSON').decode())]:
            v=envelope();change(v)
            with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
                self.assertEqual(invoke(_json(v)),(2,b'','offline_pdf_held_preparation_unavailable\n'));child.assert_not_called()

    def test_bounded_single_read_and_help_or_foreign_arguments_do_not_read_or_echo(self):
        class Reader:
            def __init__(self,value):self.value=value;self.calls=[]
            def read(self,n):self.calls.append(n);return self.value
        for raw in(b'',b'x'*(m.MAX_INPUT_BYTES+1),'PRIVATE'):
            reader=Reader(raw);self.assertEqual(invoke(stdin=reader),(2,b'','offline_pdf_held_preparation_unavailable\n'));self.assertEqual(reader.calls,[m.MAX_INPUT_BYTES+1])
        class NoRead:
            def read(self,*args):raise AssertionError('No read')
        for args,expected in[(['--help'],0),(['PRIVATE'],2),(['--database','PRIVATE'],2)]:
            code,out,err=invoke(args=args,stdin=NoRead());self.assertEqual((code,out),(expected,b''));self.assertNotIn('PRIVATE',err)
        self.assertEqual((m.MAX_INPUT_BYTES,m.MAX_OUTPUT_BYTES),(524288,262144))

    def test_fixed_curated_and_unexpected_failures_keep_private_diagnostics_out(self):
        raw=_json(envelope())
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=PdfExtractionHeldProposalError('PRIVATE')):
            self.assertEqual(invoke(raw),(2,b'','offline_pdf_held_preparation_unavailable\n'))
        for name in('_decode','prepare_pdf_extraction_held_proposal'):
            with patch.object(m,name,side_effect=RuntimeError('PRIVATE')),patch('workers.error_diagnostics.record_worker_error')as diagnostic:
                self.assertEqual(invoke(raw),(1,b'','offline_pdf_held_preparation_unavailable\n'));diagnostic.assert_called_once_with('collector_worker',directory=None)

    def test_four_part_type_capacity_unicode_and_partial_output_failures_never_retry(self):
        from workers.pdf_extraction_held_proposal import DetachedPdfExtractionProposal
        raw=_json(envelope());parts=DetachedPdfExtractionProposal(b'{}',b'{}',b'{}',b'{}')
        for field,value in [('payload_raw',b'x'*16385),('selection_raw',b'x'*2049),('provenance_raw',b'x'*65537),('context_raw',b'x'*32769),('context_raw',b'\xff'),('payload_raw',bytearray(b'{}'))]:
            with patch.object(m,'prepare_pdf_extraction_held_proposal',return_value=replace(parts,**{field:value})),patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(raw),(1,b'','offline_pdf_held_preparation_unavailable\n'))
        class Sink:
            def __init__(self,short):self.short=short;self.calls=0
            def write(self,v):self.calls+=1;return len(v)-1 if self.short else len(v)
            def flush(self):raise OSError('PRIVATE')
        for short in(True,False):
            sink=Sink(short)
            with patch.object(m,'preparation_from_envelope',return_value=b'{}\n')as core,patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(stdout=sink),(1,b'','offline_pdf_held_preparation_unavailable\n'));self.assertEqual(core.call_count,1);self.assertEqual(sink.calls,1)

if __name__=='__main__':unittest.main()
