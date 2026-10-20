"""Detached one-read ownership; fictional complete parts and memory-only ports."""
from asyncio import CancelledError
from copy import deepcopy
from datetime import timedelta,tzinfo
import unittest
from tests import test_detached_proposal_reader as fixture_module
from tests.test_detached_proposal_reader import Port
from workers.detached_proposal_reader import read_detached_proposal,DetachedProposalReadError
from workers.bounded_worker_process import WorkerOutput

def fixture():
    fixture_module.DetachedProposalReaderTests.setUpClass()
    cls=fixture_module.DetachedProposalReaderTests
    return deepcopy(cls.fresh),deepcopy(cls.intent),cls.raw,cls.at,cls.good

def invoke(extraction,intent,query,clock):
    return read_detached_proposal(extraction,intent,query=query,utc_now=clock)

class DetachedReaderEntrySnapshotTests(unittest.TestCase):
    def test_valid_intent_and_extraction_survive_first_injected_tick_damage(self):
        extraction,intent,raw,at,good=fixture();expected=invoke(extraction,intent,Port(good),lambda:at);ticks=[]
        def clock():
            if not ticks:
                object.__setattr__(intent,'canonical_metadata',b'{}')
                object.__setattr__(extraction,'full_receipt',b'{}')
            ticks.append(True);return at
        port=Port(good);actual=invoke(extraction,intent,port,clock)
        self.assertEqual(actual,expected);self.assertEqual((len(port.calls),len(ticks)),(1,3))
        self.assertIsNot(actual.reopened.result.intent,intent)
    def test_invalid_output_cannot_be_repaired_during_post_read_tick(self):
        extraction,intent,raw,at,good=fixture();bad=WorkerOutput(good.stdout,b'',1);ticks=[];port=Port(bad)
        def clock():
            ticks.append(True)
            if len(ticks)==3:object.__setattr__(bad,'returncode',0)
            return at
        with self.assertRaises(DetachedProposalReadError):invoke(extraction,intent,port,clock)
        self.assertEqual(len(port.calls),1)
    def test_valid_output_is_owned_before_post_read_tick(self):
        extraction,intent,raw,at,good=fixture();original=good.stdout;ticks=[];port=Port(good)
        def clock():
            ticks.append(True)
            if len(ticks)==3:
                object.__setattr__(good,'stdout',b'PRIVATE_CANARY');object.__setattr__(good,'stderr',b'PRIVATE_BACKEND')
            return at
        actual=invoke(extraction,intent,port,clock)
        self.assertEqual(actual.reopened.full_receipt,raw);self.assertEqual((len(port.calls),len(ticks)),(1,3))
    def test_unknown_initial_namespace_refuses_before_any_callback(self):
        extraction,intent,raw,at,good=fixture();object.__setattr__(intent,'foreign',object());ticks=[];port=Port(good)
        def clock():ticks.append(True);return at
        with self.assertRaises(DetachedProposalReadError):invoke(extraction,intent,port,clock)
        self.assertEqual((ticks,port.calls),([],[]))
    def test_foreign_output_refuses_before_post_read_tick_without_getters(self):
        extraction,intent,raw,at,good=fixture();ticks=[];queries=[]
        class Foreign:
            @property
            def stdout(self):raise AssertionError('Foreign getter')
        def clock():ticks.append(True);return at
        def query(statement):queries.append(statement);return Foreign()
        with self.assertRaises(DetachedProposalReadError):invoke(extraction,intent,query,clock)
        self.assertEqual((len(queries),len(ticks)),(1,2))
    def test_each_actual_injected_utc_result_is_normalized_once(self):
        extraction,intent,raw,at,good=fixture();ticks=[]
        class Zone(tzinfo):
            calls=0
            def utcoffset(self,value):self.calls+=1;return timedelta(0)
            def dst(self,value):return timedelta(0)
        zone=Zone();instant=at.replace(tzinfo=zone)
        def clock():ticks.append(True);return instant
        actual=invoke(extraction,intent,Port(good),clock)
        self.assertEqual(actual.query_count,1);self.assertEqual((len(ticks),zone.calls),(3,3))
    def test_snapshot_time_fault_is_curated_and_exact_cancellations_survive(self):
        for fault in [RuntimeError('PRIVATE_CANARY'),KeyboardInterrupt(),SystemExit(9),CancelledError()]:
            extraction,intent,raw,at,good=fixture()
            class Zone(tzinfo):
                def utcoffset(self,value):raise fault
                def dst(self,value):return timedelta(0)
            object.__setattr__(extraction,'observed_at',extraction.observed_at.replace(tzinfo=Zone()));port=Port(good)
            with self.subTest(fault=type(fault).__name__):
                with self.assertRaises(DetachedProposalReadError if isinstance(fault,Exception) else type(fault)) as found:
                    invoke(extraction,intent,port,lambda:at)
                if isinstance(fault,Exception):self.assertEqual(str(found.exception),'detached_proposal_read_unavailable')
                else:self.assertIs(found.exception,fault)
                self.assertEqual(port.calls,[])
