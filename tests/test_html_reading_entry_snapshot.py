"""Whole reading-parent snapshots preserve supplied invented originals/identity."""
from asyncio import CancelledError
from datetime import tzinfo,timedelta
import json
import unittest
from tests.test_html_extraction_held_proposal import prepared,wire,encoded,cold,context,AT
from tests.test_html_extraction_review_report import sample,READ
from tests.test_html_preparation_review_report import inputs as preparation_inputs
from tests.test_html_inspection_report import examples,OBSERVED
from workers.html_extraction_held_proposal import prepare_html_extraction_held_proposal,HtmlExtractionHeldProposalError
from workers.html_extraction_review_report import html_extraction_review_report,HtmlExtractionReviewReportError
from workers.html_preparation_review_report import html_preparation_review_report,HtmlPreparationReviewReportError
from workers.html_inspection_report import html_inspection_report,HtmlInspectionReportError


class Clock(tzinfo):
    def __init__(self,callback,at=1):self.callback=callback;self.at=at;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==self.at:self.callback()
        return timedelta(0)
    def dst(self,value):return timedelta(0)


def values(port):
    if port=='held':
        selected=prepared()
        return dict(receipt=encoded(wire(selected)),expected=cold(selected),independent_context=encoded(context(selected)),
            current_receipt=selected.result.current_receipt,previous_receipt=selected.result.previous_receipt,observed_at=AT)
    if port=='inspection':
        current,previous,request=examples()
        return dict(current=current,previous=previous,request=request,maximum_output_tokens=128,observed_at=OBSERVED)
    if port=='extraction':
        selected,raw,expected=sample()
        return dict(receipt=raw,expected=expected,current_receipt=selected.result.current_receipt,
            previous_receipt=selected.result.previous_receipt,observed_at=READ)
    return preparation_inputs()

PORTS={'held':(prepare_html_extraction_held_proposal,HtmlExtractionHeldProposalError,'html_extraction_held_proposal_unavailable'),
       'inspection':(html_inspection_report,HtmlInspectionReportError,'html_inspection_report_unavailable'),
       'extraction':(html_extraction_review_report,HtmlExtractionReviewReportError,'html_extraction_review_report_unavailable'),
       'preparation':(html_preparation_review_report,HtmlPreparationReviewReportError,'html_preparation_review_report_unavailable')}


def invoke(port,v):return PORTS[port][0](**v)


class HtmlReadingEntrySnapshotTests(unittest.TestCase):
    def test_direct_held_invalid_selector_cannot_be_repaired_by_first_clock(self):
        v=values('held');owner=v['expected'];good=owner.artifact_id
        object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')
        clock=Clock(lambda:object.__setattr__(owner,'artifact_id',good));v['observed_at']=v['observed_at'].replace(tzinfo=clock)
        with self.assertRaises(HtmlExtractionHeldProposalError):invoke('held',v)

    def test_valid_held_keeps_all_four_exact_parts_despite_selector_damage(self):
        v=values('held');before=invoke('held',v);owner=v['expected']
        clock=Clock(lambda:object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001'))
        v['observed_at']=v['observed_at'].replace(tzinfo=clock);actual=invoke('held',v)
        for field in ['payload_raw','selection_raw','provenance_raw','context_raw']:
            self.assertEqual(getattr(actual,field),getattr(before,field))

    def test_inspection_invalid_optional_request_cannot_be_repaired(self):
        v=values('inspection');owner=v['request'];good=owner.request_sha256
        object.__setattr__(owner,'request_sha256','0'*64)
        v['observed_at']=v['observed_at'].replace(tzinfo=Clock(lambda:object.__setattr__(owner,'request_sha256',good)))
        with self.assertRaises(HtmlInspectionReportError):invoke('inspection',v)

    def test_inspection_without_request_keeps_original_byte_count_and_digest_together(self):
        v=values('inspection');v['request']=None;v['maximum_output_tokens']=None
        baseline=invoke('inspection',v);owner=v['current'];size=len(owner.raw);digest=owner.document.content_sha256
        v['observed_at']=v['observed_at'].replace(tzinfo=Clock(lambda:object.__setattr__(owner,'raw',b'x')))
        actual=invoke('inspection',v);self.assertEqual(actual,baseline)
        source=json.loads(actual)['current'];self.assertEqual(source['original_bytes'],size);self.assertEqual(source['content_sha256'],digest)

    def test_inspection_with_request_owns_complete_request_and_both_originals(self):
        v=values('inspection');baseline=invoke('inspection',v)
        def damage():
            object.__setattr__(v['current'],'raw',b'x')
            object.__setattr__(v['previous'],'raw',b'y')
            object.__setattr__(v['request'],'body',b'FICTIONAL_PRIVATE_SUBSTITUTION')
        v['observed_at']=v['observed_at'].replace(tzinfo=Clock(damage))
        self.assertEqual(invoke('inspection',v),baseline)

    def test_extraction_report_normalizes_observation_once_before_all_projection(self):
        v=values('extraction');baseline=invoke('extraction',v)
        def late_fault():raise RuntimeError('FICTIONAL_PRIVATE_LATE_CALLBACK')
        clock=Clock(late_fault,at=2);v['observed_at']=v['observed_at'].replace(tzinfo=clock)
        self.assertEqual(invoke('extraction',v),baseline);self.assertEqual(clock.calls,1)

    def test_first_clock_faults_have_exact_fixed_private_errors_on_each_port(self):
        for port in PORTS:
            v=values(port);failure=RuntimeError('FICTIONAL_PRIVATE_CALLBACK')
            def fail():raise failure
            v['observed_at']=v['observed_at'].replace(tzinfo=Clock(fail))
            with self.subTest(port=port):
                with self.assertRaises(PORTS[port][1]) as caught:invoke(port,v)
                self.assertEqual(str(caught.exception),PORTS[port][2]);self.assertIsNone(caught.exception.__cause__)

    def test_preparation_report_retains_complete_historical_view_under_reused_selector_damage(self):
        v=values('preparation');baseline=invoke('preparation',v);owner=v['extraction_expected']
        v['observed_at']=v['observed_at'].replace(tzinfo=Clock(lambda:object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')))
        actual=invoke('preparation',v);self.assertEqual(actual,baseline)
        before=json.loads(baseline);after=json.loads(actual)
        self.assertEqual(after['preparation'],before['preparation'])
        self.assertEqual(after['extraction']['prepared_at'],before['extraction']['prepared_at'])

    def test_unknown_deep_namespace_refuses_before_any_clock(self):
        for port in PORTS:
            v=values(port);calls=[]
            owner=v['current'].mapping if port=='inspection' else v['expected'].current_expected.mapping if port in ['held','extraction'] else v['extraction_expected'].previous_expected.mapping
            object.__setattr__(owner,'foreign',object())
            v['observed_at']=v['observed_at'].replace(tzinfo=Clock(lambda:calls.append(True)))
            with self.subTest(port=port):
                with self.assertRaises(PORTS[port][1]):invoke(port,v)
                self.assertEqual(calls,[])

    def test_four_ports_preserve_exact_operation_cancellation_objects(self):
        for port in PORTS:
            for kind in [KeyboardInterrupt,SystemExit,CancelledError]:
                v=values(port);failure=kind('FICTIONAL_PRIVATE_CANCEL')
                def fail():raise failure
                v['observed_at']=v['observed_at'].replace(tzinfo=Clock(fail))
                with self.subTest(port=port,kind=kind.__name__):
                    with self.assertRaises(kind) as caught:invoke(port,v)
                    self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
