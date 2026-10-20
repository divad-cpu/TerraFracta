"""Plain private reopen/report/held parents retain exact invented entry context."""
from asyncio import CancelledError
from datetime import tzinfo,timedelta
from dataclasses import asdict
import unittest
from tests.test_private_extraction_reopen import context as reopen_context,NOW
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import context as editorial_context,encode,AT
from workers.private_extraction_reopen import (prepare_private_extraction_reopen,
    parse_reopened_private_extraction,PrivateExtractionReopenError)
from workers.private_extraction_report import private_extraction_review_report,PrivateExtractionReportError
from workers.private_extraction_held_proposal import prepare_private_extraction_held_proposal,PrivateExtractionHeldProposalError

class Clock(tzinfo):
    def __init__(self,callback,at=1):self.callback=callback;self.at=at;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==self.at:self.callback()
        return timedelta(0)
    def dst(self,value):return timedelta(0)
def clocked(at,callback):return at.replace(tzinfo=Clock(callback))
def prepare_args(value):
    return dict(current=value.current,current_receipt=value.current_receipt,
        previous=value.previous,previous_receipt=value.previous_receipt,request=value.request,
        operation_id=value.operation_id,maximum_output_tokens=value.maximum_output_tokens,observed_at=value.observed_at)
def parse(raw,expected,at=None):
    return parse_reopened_private_extraction(raw,expected,observed_at=NOW+timedelta(seconds=13) if at is None else at)


class PrivateReadingEntrySnapshotTests(unittest.TestCase):
    def test_invalid_prepare_original_cannot_be_repaired_before_reopen_validation(self):
        expected,_,_=reopen_context();args=prepare_args(expected);owner=expected.current;good=owner.artifact_id
        object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')
        args['observed_at']=clocked(args['observed_at'],lambda:object.__setattr__(owner,'artifact_id',good))
        with self.assertRaises(PrivateExtractionReopenError):prepare_private_extraction_reopen(**args)

    def test_valid_prepare_preserves_canonical_and_owned_both_vintages(self):
        expected,_,_=reopen_context();args=prepare_args(expected);canonical=expected.canonical_input
        def damage():
            object.__setattr__(expected.current,'artifact_id','90000000-0000-4000-8000-000000000001')
            object.__setattr__(expected.previous,'response_raw',b'{}')
        args['observed_at']=clocked(args['observed_at'],damage)
        actual=prepare_private_extraction_reopen(**args)
        self.assertEqual(actual.canonical_input,canonical)
        self.assertIsNot(actual.current,expected.current);self.assertIsNot(actual.previous,expected.previous)

    def test_invalid_reopen_canonical_cannot_be_repaired_for_statement_or_parse(self):
        for mode in ['statement','parse']:
            expected,raw,_=reopen_context();good=expected.canonical_input
            object.__setattr__(expected,'canonical_input',b'{}')
            object.__setattr__(expected,'observed_at',clocked(expected.observed_at,
                lambda:object.__setattr__(expected,'canonical_input',good)))
            with self.subTest(mode=mode):
                with self.assertRaises(PrivateExtractionReopenError):expected.statement() if mode=='statement' else parse(raw,expected)

    def test_statement_uses_checked_operation_after_callback_damage(self):
        expected,_,_=reopen_context();sql=expected.statement()
        object.__setattr__(expected,'observed_at',clocked(expected.observed_at,
            lambda:object.__setattr__(expected,'operation_id','90000000-0000-4000-8000-000000000001')))
        self.assertEqual(expected.statement(),sql)

    def test_complete_receipt_parse_owns_request_before_observation_callback(self):
        expected,raw,_=reopen_context();baseline=parse(raw,expected);before=asdict(baseline)
        at=clocked(NOW+timedelta(seconds=13),lambda:object.__setattr__(expected.current,'artifact_id','90000000-0000-4000-8000-000000000001'))
        actual=parse(raw,expected,at)
        self.assertEqual(asdict(actual),before);self.assertEqual(actual.full_receipt,raw)
        self.assertIsNot(actual.request,expected);self.assertIsNot(actual.request.current,expected.current)

    def test_invalid_report_artifact_cannot_be_repaired_before_complete_recheck(self):
        item=reopened();owner=item.stored;good=owner.artifact_id
        object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')
        object.__setattr__(item,'observed_at',clocked(item.observed_at,lambda:object.__setattr__(owner,'artifact_id',good)))
        with self.assertRaises(PrivateExtractionReportError):private_extraction_review_report(item)

    def test_valid_report_keeps_provenance_and_normalizes_observation_once(self):
        for mode in ['damage','late_fault']:
            item=reopened();baseline=private_extraction_review_report(item)
            def change():
                if mode=='damage':object.__setattr__(item.result.proposal,'review_state','verified')
                else:raise RuntimeError('FICTIONAL_PRIVATE_LATE_CALLBACK')
            clock=Clock(change,at=1 if mode=='damage' else 2)
            object.__setattr__(item,'observed_at',item.observed_at.replace(tzinfo=clock))
            with self.subTest(mode=mode):
                self.assertEqual(private_extraction_review_report(item),baseline)
                self.assertEqual(clock.calls,1)

    def test_detached_held_rejects_invalid_repair_and_preserves_three_exact_parts(self):
        for invalid in [True,False]:
            item=reopened();ctx=encode(editorial_context(item));baseline=prepare_private_extraction_held_proposal(item,ctx,observed_at=AT)
            good=item.stored.artifact_id
            if invalid:object.__setattr__(item.stored,'artifact_id','90000000-0000-4000-8000-000000000001')
            def change():object.__setattr__(item.stored,'artifact_id',good if invalid else '90000000-0000-4000-8000-000000000001')
            at=clocked(AT,change)
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(PrivateExtractionHeldProposalError):prepare_private_extraction_held_proposal(item,ctx,observed_at=at)
                else:
                    actual=prepare_private_extraction_held_proposal(item,ctx,observed_at=at)
                    for field in ['payload_raw','selection_raw','provenance_raw']:self.assertEqual(getattr(actual,field),getattr(baseline,field))
                    self.assertIsNot(actual,baseline)

    def test_unknown_complete_namespaces_refuse_before_clock_hooks(self):
        for port in ['reopen','report','held']:
            calls=[]
            if port=='reopen':
                expected,raw,_=reopen_context();object.__setattr__(expected,'foreign',object())
                object.__setattr__(expected,'observed_at',clocked(expected.observed_at,lambda:calls.append(True)))
                call=lambda:parse(raw,expected);error=PrivateExtractionReopenError
            else:
                item=reopened();ctx=encode(editorial_context(item));object.__setattr__(item.stored,'foreign',object())
                if port=='report':
                    object.__setattr__(item,'observed_at',clocked(item.observed_at,lambda:calls.append(True)))
                    call=lambda:private_extraction_review_report(item);error=PrivateExtractionReportError
                else:call=lambda:prepare_private_extraction_held_proposal(item,ctx,observed_at=clocked(AT,lambda:calls.append(True)));error=PrivateExtractionHeldProposalError
            with self.subTest(port=port):
                with self.assertRaises(error):call()
                self.assertEqual(calls,[])

    def test_three_ports_fix_ordinary_clock_faults_and_preserve_cancellation(self):
        for port in ['reopen','report','held']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if port=='reopen':
                    expected,raw,_=reopen_context();object.__setattr__(expected,'observed_at',clocked(expected.observed_at,fail))
                    call=lambda:parse(raw,expected);error=PrivateExtractionReopenError
                else:
                    item=reopened();ctx=encode(editorial_context(item))
                    if port=='report':
                        object.__setattr__(item,'observed_at',clocked(item.observed_at,fail));call=lambda:private_extraction_review_report(item);error=PrivateExtractionReportError
                    else:call=lambda:prepare_private_extraction_held_proposal(item,ctx,observed_at=clocked(AT,fail));error=PrivateExtractionHeldProposalError
                with self.subTest(port=port,kind=kind.__name__):
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        expected={'reopen':'private_extraction_reopen_unavailable','report':'private_extraction_review_report_unavailable','held':'private_extraction_held_proposal_unavailable'}
                        self.assertEqual(str(caught.exception),expected[port]);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
