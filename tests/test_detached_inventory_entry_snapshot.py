"""Whole inventory/report entry ownership; invented metadata and SQL strings only."""
from asyncio import CancelledError
from copy import deepcopy
from dataclasses import asdict
from datetime import tzinfo,timedelta
import json,unittest
from tests.test_detached_proposal_inventory import fixture,wire,AT,SERVER,END
from tests.test_private_extraction_held_proposal import encode
from workers.detached_proposal_inventory import (prepare_detached_proposal_inventory,
    parse_detached_proposal_inventory,DetachedProposalInventoryError)
from workers.detached_proposal_choices_report import detached_proposal_choices_report,DetachedProposalChoicesReportError
from workers.feed_postgres_contract import _time

class Clock(tzinfo):
    def __init__(self,callback=lambda:None):self.callback=callback;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==1:self.callback()
        return timedelta(0)
    def dst(self,value):return timedelta(0)
    def __deepcopy__(self,memo):return self

def clocked(at,callback):return at.replace(tzinfo=Clock(callback))

class DetachedInventoryEntrySnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.seed=fixture()
    def setup(self):
        item=deepcopy(self.seed);request=prepare_detached_proposal_inventory(item.result.extraction,observed_at=AT)
        return item,request,encode(wire(request,item))

    def test_initial_invalid_scope_cannot_be_repaired_by_recheck_clock(self):
        for port in ('statement','parse','report'):
            item,request,raw=self.setup();good=request.canonical_scope;object.__setattr__(request,'canonical_scope',b'{}')
            object.__setattr__(request,'observed_at',clocked(AT,lambda:object.__setattr__(request,'canonical_scope',good)))
            with self.subTest(port=port):
                with self.assertRaises(DetachedProposalChoicesReportError if port=='report' else DetachedProposalInventoryError):
                    if port=='statement':request.statement()
                    elif port=='parse':parse_detached_proposal_inventory(raw,request,observed_at=END)
                    else:detached_proposal_choices_report(raw,request,observed_at=END)

    def test_prepare_captures_complete_artifact_before_first_callback(self):
        for invalid in (True,False):
            item,request,_=self.setup();extraction=item.result.extraction;good=extraction.full_receipt
            if invalid:object.__setattr__(extraction,'full_receipt',b'{}')
            def change():object.__setattr__(extraction,'full_receipt',good if invalid else b'FICTIONAL_PRIVATE_REPLACEMENT')
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DetachedProposalInventoryError):prepare_detached_proposal_inventory(extraction,observed_at=clocked(AT,change))
                else:
                    actual=prepare_detached_proposal_inventory(extraction,observed_at=clocked(AT,change))
                    self.assertEqual(asdict(actual),asdict(request));self.assertIsNot(actual.extraction,extraction)

    def test_parse_keeps_owned_scope_artifact_and_historical_metadata(self):
        for target in ('scope','artifact'):
            _,request,raw=self.setup();baseline=asdict(parse_detached_proposal_inventory(raw,request,observed_at=END))
            def change():
                if target=='scope':object.__setattr__(request,'canonical_scope',b'{}')
                else:object.__setattr__(request.extraction.stored,'artifact_id','90000000-0000-4000-8000-000000000001')
            object.__setattr__(request,'observed_at',clocked(AT,change))
            with self.subTest(target=target):
                actual=parse_detached_proposal_inventory(raw,request,observed_at=END)
                self.assertEqual(asdict(actual),baseline);self.assertIsNot(actual.request,request);self.assertIsNot(actual.request.extraction,request.extraction)
                self.assertIn('independent_intent_required',actual.evidence_state)

    def test_statement_uses_owned_original_scope_and_exact_sql(self):
        _,request,_=self.setup();baseline=request.statement()
        object.__setattr__(request,'observed_at',clocked(AT,lambda:object.__setattr__(request,'canonical_scope',b'{}')))
        self.assertEqual(request.statement(),baseline)
        self.assertIn('limit 51',baseline);self.assertIn('read only',baseline);self.assertNotIn('insert ',baseline)

    def test_report_owns_context_and_normalizes_actual_observation_once(self):
        _,request,raw=self.setup();baseline=detached_proposal_choices_report(raw,request,observed_at=END)
        object.__setattr__(request,'observed_at',clocked(AT,lambda:object.__setattr__(request,'canonical_scope',b'{}')))
        count=Clock();actual=detached_proposal_choices_report(raw,request,observed_at=END.replace(tzinfo=count))
        self.assertEqual(actual,baseline);self.assertEqual(count.calls,1)
        value=json.loads(actual);self.assertEqual(value['inventory_observed_at'],_time(SERVER));self.assertEqual(value['report_observed_at'],_time(END))
        self.assertNotEqual(value['inventory_observed_at'],value['report_observed_at'])
        self.assertEqual(value['review_state'],'historical_metadata_only');self.assertNotIn('selected',value)

    def test_report_does_not_reinvoke_late_faulting_caller_clock(self):
        _,request,raw=self.setup();baseline=detached_proposal_choices_report(raw,request,observed_at=END)
        class OnceClock(Clock):
            def utcoffset(self,value):
                self.calls+=1
                if self.calls>1:raise RuntimeError('FICTIONAL_PRIVATE_LATE_CLOCK')
                return timedelta(0)
        at=END.replace(tzinfo=OnceClock())
        self.assertEqual(detached_proposal_choices_report(raw,request,observed_at=at),baseline)

    def test_deep_unknown_namespace_refuses_before_hooks(self):
        for port in ('prepare','statement','parse','report'):
            item,request,raw=self.setup();calls=[]
            if port=='prepare':object.__setattr__(item.result.extraction.request,'foreign',object())
            else:object.__setattr__(request.extraction.request,'foreign',object())
            at=clocked(AT if port=='prepare' else END,lambda:calls.append(True))
            if port=='statement':object.__setattr__(request,'observed_at',at)
            with self.subTest(port=port):
                with self.assertRaises(DetachedProposalChoicesReportError if port=='report' else DetachedProposalInventoryError):
                    if port=='prepare':prepare_detached_proposal_inventory(item.result.extraction,observed_at=at)
                    elif port=='statement':request.statement()
                    elif port=='parse':parse_detached_proposal_inventory(raw,request,observed_at=at)
                    else:detached_proposal_choices_report(raw,request,observed_at=at)
                self.assertEqual(calls,[])

    def test_exact_limits_fixed_faults_and_cancellation_are_preserved(self):
        item,request,_=self.setup()
        for count in (0,50):
            raw=encode(wire(request,item,count=count));self.assertEqual(len(parse_detached_proposal_inventory(raw,request,observed_at=END).candidates),count)
        with self.assertRaises(DetachedProposalInventoryError):parse_detached_proposal_inventory(encode(wire(request,item,count=51)),request,observed_at=END)
        for port in ('prepare','parse','report'):
            for kind in (RuntimeError,KeyboardInterrupt,SystemExit,CancelledError):
                item,request,raw=self.setup();failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                at=clocked(AT if port=='prepare' else END,fail)
                with self.subTest(port=port,kind=kind.__name__):
                    error=DetachedProposalChoicesReportError if port=='report' else DetachedProposalInventoryError
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:
                        if port=='prepare':prepare_detached_proposal_inventory(item.result.extraction,observed_at=at)
                        elif port=='parse':parse_detached_proposal_inventory(raw,request,observed_at=at)
                        else:detached_proposal_choices_report(raw,request,observed_at=at)
                    if kind is RuntimeError:
                        self.assertEqual(str(caught.exception),'detached_proposal_choices_unavailable' if port=='report' else 'detached_proposal_inventory_unavailable')
                        self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)

if __name__=='__main__':unittest.main()
