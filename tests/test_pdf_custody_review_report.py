"""New supplied custody -> selected report, actual invented originals only."""
import base64
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts.offline_pdf_result_review import _decode
from tests.test_pdf_result_packet import CallbackUtc
from workers.pdf_passage_binding import _stamp
from workers.passage_extraction_request import _canonical
from workers.pdf_result_custody import _intent
import workers.pdf_custody_review_report as m

ARTIFACT='40000000-0000-4000-8000-000000000001'


def values():
    # Existing actual generated, entirely invented packet + separately retained
    # independent assertions. Only a synthetic receipt is assembled here; no DB.
    raw=(Path(__file__).resolve().parents[1]/'fixtures/fictional-pdf-result-review-input.json').read_bytes()
    packet,expected,at=_decode(raw)
    intent=_intent(packet,expected)
    receipt=_canonical(dict(schema_version=1,kind='invented_pdf_result_stored',operation_id=expected.operation_id,
        artifact_id=ARTIFACT,stored_at=_stamp(expected.prepared_at+timedelta(seconds=1)),
        intent_base64=base64.b64encode(intent).decode(),packet_base64=base64.b64encode(packet).decode(),
        intent_sha256=sha256(intent).hexdigest(),packet_sha256=sha256(packet).hexdigest(),
        intent_bytes=len(intent),packet_bytes=len(packet)))
    return receipt,expected,intent,at,json.loads(raw)['expected']


class PdfCustodyReviewReportTests(unittest.TestCase):
    @contextmanager
    def actual(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start), \
                patch.object(m,'reopen_pdf_result_custody',wraps=m.reopen_pdf_result_custody)as opener, \
                patch.object(m,'_project_reopened_result',wraps=m._project_reopened_result)as projection:
            try:yield children,opener,projection
            finally:
                for child in children:
                    self.assertIsNotNone(child.poll())
                    self.assertTrue(all(getattr(child,k).closed for k in ('stdin','stdout','stderr')))

    def refusal(self,action):
        with self.assertRaisesRegex(m.PdfCustodyReviewReportError,'^pdf_custody_review_report_unavailable$')as caught:action()
        self.assertIsNone(caught.exception.__cause__)

    def test_actual_custody_report_opens_each_original_once_and_keeps_storage_not_observed(self):
        receipt,expected,intent,at,_=values()
        with self.actual()as(children,opener,projection):
            raw=m.pdf_custody_review_report(receipt,expected,intent_raw=intent,observed_at=at)
        self.assertEqual(len(children),2);self.assertEqual(opener.call_count,1);self.assertEqual(projection.call_count,1)
        report=json.loads(raw)
        self.assertEqual(report['kind'],'private_pdf_extraction_review_report')
        self.assertEqual(report['scope'],'supplied_pdf_result_rederivation_only')
        self.assertEqual(report['review_state'],'unverified');self.assertEqual(report['proposal']['review_state'],'unverified')
        self.assertEqual(report['artifact']['packet_sha256'],expected.packet_sha256)
        self.assertEqual(report['artifact']['operation_id'],expected.operation_id)
        self.assertEqual(report['prepared_at'],_stamp(expected.prepared_at));self.assertEqual(report['reopened_at'],_stamp(at))
        self.assertEqual(report['selected_passages'][0]['text'],'CLI_CURRENT_SELECTED')
        self.assertEqual(report['selected_passages'][0]['earlier'][0]['text'],'CLI_PRIOR_SELECTED')
        self.assertEqual(report['context']['storage'],'not_observed');self.assertEqual(report['context']['publication'],'not_authorized')
        for hidden in (b'%PDF-',b'base64',b'PRIVATE_PDF_METADATA_CANARY',b'"instructions"',b'"artifact_id"',b'"stored_at"'):
            self.assertNotIn(hidden,raw)
        self.assertLessEqual(len(raw),384*1024)

    def test_independent_expectations_intent_receipt_and_times_refuse_before_any_child(self):
        receipt,expected,intent,at,_=values()
        bad=[(receipt,None,intent,at),(receipt,replace(expected,previous=None),intent,at),
            (receipt,replace(expected,output_sha256='f'*64),intent,at),(receipt,replace(expected,packet_sha256='f'*64),intent,at),
            (receipt,replace(expected,operation_id='PRIVATE_OP'),intent,at),(receipt,expected,b'{}',at),
            (receipt,expected,b'',at),(receipt,expected,None,at),(receipt,expected,intent,expected.prepared_at),
            (b'{}',expected,intent,at),(b'[]',expected,intent,at),(b'{"x":NaN}',expected,intent,at),
            (b'{"x":1,"x":1}',expected,intent,at),(b'\xff',expected,intent,at),
            (bytearray(receipt),expected,intent,at),(b'x'*131073,expected,intent,at)]
        foreign=replace(expected,previous=replace(expected.previous,document=replace(expected.previous.document,content_sha256='e'*64)))
        bad.append((receipt,foreign,intent,at))
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            for raw,assertion,i,clock in bad:
                with self.subTest(type=type(raw).__name__):
                    self.refusal(lambda:m.pdf_custody_review_report(raw,assertion,intent_raw=i,observed_at=clock))
            child.assert_not_called()

    def test_initially_denied_assertion_cannot_be_repaired_by_observation_callback(self):
        receipt,expected,intent,at,_=values();good=expected.output_sha256
        object.__setattr__(expected,'output_sha256','f'*64)
        clock=CallbackUtc(lambda:object.__setattr__(expected,'output_sha256',good))
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            self.refusal(lambda:m.pdf_custody_review_report(receipt,expected,intent_raw=intent,observed_at=at.replace(tzinfo=clock)))
            child.assert_not_called()
        self.assertGreater(clock.calls,0)

    def test_valid_expectations_are_captured_before_later_clock_mutates_request_and_previous(self):
        receipt,expected,intent,at,_=values();request_sha=expected.request.request_sha256
        def mutate():
            object.__setattr__(expected,'output_sha256','f'*64)
            object.__setattr__(expected.request,'body',b'PRIVATE_MUTATED_REQUEST')
            object.__setattr__(expected.previous.mapping.selections[0],'page_number',999)
        clock=CallbackUtc(mutate)
        with self.actual()as(children,opener,projection):
            raw=m.pdf_custody_review_report(receipt,expected,intent_raw=intent,observed_at=at.replace(tzinfo=clock))
        self.assertEqual(len(children),2);self.assertEqual(opener.call_count,1);self.assertEqual(projection.call_count,1)
        report=json.loads(raw);self.assertEqual(report['request']['request_sha256'],request_sha)
        self.assertEqual(report['selected_passages'][0]['earlier'][0]['page_number'],1)
        self.assertNotIn(b'PRIVATE_MUTATED',raw)

    def test_unknown_expected_namespace_and_prebuilt_objects_refuse_without_callback_or_child(self):
        receipt,expected,intent,at,_=values();calls=[]
        object.__setattr__(expected,'authenticated','PRIVATE_EXTRA')
        clock=CallbackUtc(lambda:calls.append(True))
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            self.refusal(lambda:m.pdf_custody_review_report(receipt,expected,intent_raw=intent,observed_at=at.replace(tzinfo=clock)))
            for raw in (expected,SimpleNamespace(result='PRIVATE_PROPOSAL'),{},bytearray(receipt)):
                self.refusal(lambda:m.pdf_custody_review_report(raw,expected,intent_raw=intent,observed_at=at))
            child.assert_not_called()
        self.assertEqual(calls,[])

    def test_unexpected_opener_or_projection_error_is_fixed_private_without_partial_report(self):
        receipt,expected,intent,at,_=values()
        with patch.object(m,'reopen_pdf_result_custody',side_effect=RuntimeError('PRIVATE_CUSTODY_ERROR')):
            self.refusal(lambda:m.pdf_custody_review_report(receipt,expected,intent_raw=intent,observed_at=at))
        with patch.object(m,'reopen_pdf_result_custody',return_value=SimpleNamespace(result=object())), \
                patch.object(m,'_project_reopened_result',side_effect=RuntimeError('PRIVATE_PROJECTION_ERROR')):
            self.refusal(lambda:m.pdf_custody_review_report(receipt,expected,intent_raw=intent,observed_at=at))


if __name__=='__main__':unittest.main()
