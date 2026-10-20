"""Detached parent entry snapshots; invented four-part custody and fake SQL only."""
from asyncio import CancelledError
from dataclasses import asdict
from datetime import tzinfo,timedelta
import unittest
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import context,encode,AT
from tests.test_detached_proposal_custody import fresh_extraction,STORED,LATER
from tests.test_detached_proposal_postgres import wire
from tests.test_feed_postgres_contract import uid
from workers.detached_proposal_custody import (prepare_detached_proposal_custody,
    recheck_prepared_detached_proposal,reobserve_detached_proposal,part_bytes,DetachedProposalCustodyError)
from workers.detached_proposal_postgres import (prepare_detached_proposal_store,
    parse_stored_detached_proposal,parse_reopened_detached_proposal,detached_proposal_read_statement,DetachedProposalPostgresError)

class Clock(tzinfo):
    def __init__(self,callback):self.callback=callback;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==1:self.callback()
        return timedelta(0)
    def dst(self,value):return timedelta(0)
    def __deepcopy__(self,memo):return self
def clocked(at,callback):return at.replace(tzinfo=Clock(callback))
def fixture():
    old=reopened();ctx=encode(context(old));p=prepare_detached_proposal_custody(old,ctx,operation_id=uid(810),observed_at=AT)
    return old,ctx,p

def observe(fresh,p,at=STORED):
    return reobserve_detached_proposal(fresh,p.parts,p.intent,stored_at=at,observed_at=LATER+timedelta(seconds=1))


class DetachedParentEntrySnapshotTests(unittest.TestCase):
    def test_invalid_extraction_receipt_cannot_be_repaired_at_prepare_entry(self):
        old,ctx,_=fixture();good=old.full_receipt;object.__setattr__(old,'full_receipt',b'{}')
        with self.assertRaises(DetachedProposalCustodyError):
            prepare_detached_proposal_custody(old,ctx,operation_id=uid(810),observed_at=clocked(AT,lambda:object.__setattr__(old,'full_receipt',good)))

    def test_valid_prepare_keeps_exact_four_parts_and_owned_extraction(self):
        old,ctx,p=fixture();before=part_bytes(p.parts);intent=p.intent.canonical_metadata
        at=clocked(AT,lambda:object.__setattr__(old,'full_receipt',b'FICTIONAL_PRIVATE_REPLACEMENT'))
        actual=prepare_detached_proposal_custody(old,ctx,operation_id=uid(810),observed_at=at)
        self.assertEqual(part_bytes(actual.parts),before);self.assertEqual(actual.intent.canonical_metadata,intent)
        self.assertIsNot(actual.extraction,old);self.assertIsNot(actual.parts,p.parts);self.assertIsNot(actual.intent,p.intent)

    def test_recheck_owns_parts_intent_and_extraction_before_clock(self):
        for target in ['parts','intent','invalid_extraction']:
            _,_,p=fixture();expected=asdict(p);good=p.extraction.full_receipt
            if target=='invalid_extraction':object.__setattr__(p.extraction,'full_receipt',b'{}')
            def change():
                if target=='parts':object.__setattr__(p.parts,'payload_raw',b'FICTIONAL_PRIVATE_REPLACEMENT')
                elif target=='intent':object.__setattr__(p.intent,'canonical_metadata',b'{}')
                else:object.__setattr__(p.extraction,'full_receipt',good)
            object.__setattr__(p,'observed_at',clocked(p.observed_at,change))
            with self.subTest(target=target):
                if target=='invalid_extraction':
                    with self.assertRaises(DetachedProposalCustodyError):recheck_prepared_detached_proposal(p)
                else:
                    actual=recheck_prepared_detached_proposal(p);self.assertEqual(asdict(actual),expected)
                    self.assertIsNot(actual.parts,p.parts);self.assertIsNot(actual.intent,p.intent);self.assertIsNot(actual.extraction,p.extraction)

    def test_reobservation_retains_history_and_rejects_receipt_repair(self):
        for invalid in [True,False]:
            old,_,p=fixture();fresh=fresh_extraction(old);baseline=asdict(observe(fresh,p));good=fresh.full_receipt
            if invalid:object.__setattr__(fresh,'full_receipt',b'{}')
            def change():
                if invalid:object.__setattr__(fresh,'full_receipt',good)
                else:object.__setattr__(p.parts,'provenance_raw',b'FICTIONAL_PRIVATE_REPLACEMENT')
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DetachedProposalCustodyError):observe(fresh,p,clocked(STORED,change))
                else:
                    actual=observe(fresh,p,clocked(STORED,change));self.assertEqual(asdict(actual),baseline)
                    self.assertEqual(actual.prepared_at,AT);self.assertEqual(actual.stored_at,STORED)
                    self.assertIsNot(actual.parts,p.parts);self.assertIsNot(actual.intent,p.intent);self.assertIsNot(actual.extraction,fresh)

    def test_warm_ack_owns_complete_request_before_nested_clock(self):
        for invalid in [True,False]:
            _,_,p=fixture();store=prepare_detached_proposal_store(p);raw=encode(wire(store));baseline=parse_stored_detached_proposal(raw,store,observed_at=STORED+timedelta(seconds=1))
            good=store.prepared.extraction.full_receipt
            if invalid:object.__setattr__(store.prepared.extraction,'full_receipt',b'{}')
            def change():
                if invalid:object.__setattr__(store.prepared.extraction,'full_receipt',good)
                else:object.__setattr__(store.prepared.parts,'context_raw',b'FICTIONAL_PRIVATE_REPLACEMENT')
            object.__setattr__(store.prepared,'observed_at',clocked(store.prepared.observed_at,change))
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DetachedProposalPostgresError):parse_stored_detached_proposal(raw,store,observed_at=STORED+timedelta(seconds=1))
                else:self.assertEqual(parse_stored_detached_proposal(raw,store,observed_at=STORED+timedelta(seconds=1)),baseline)

    def test_cold_parse_owns_full_fresh_artifact_and_prewrite_intent(self):
        for invalid in [True,False]:
            old,_,p=fixture();store=prepare_detached_proposal_store(p);raw=encode(wire(store));fresh=fresh_extraction(old);at=LATER+timedelta(seconds=1)
            baseline=asdict(parse_reopened_detached_proposal(raw,p.intent,fresh,observed_at=at));good=fresh.full_receipt
            if invalid:object.__setattr__(fresh,'full_receipt',b'{}')
            def change():
                if invalid:object.__setattr__(fresh,'full_receipt',good)
                else:object.__setattr__(fresh.stored,'artifact_id','90000000-0000-4000-8000-000000000001')
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DetachedProposalPostgresError):parse_reopened_detached_proposal(raw,p.intent,fresh,observed_at=clocked(at,change))
                else:
                    actual=parse_reopened_detached_proposal(raw,p.intent,fresh,observed_at=clocked(at,change))
                    self.assertEqual(asdict(actual),baseline);self.assertIsNot(actual.result.intent,p.intent);self.assertIsNot(actual.result.extraction,fresh)

    def test_statement_retains_all_original_operands_after_nested_callback(self):
        _,_,p=fixture();store=prepare_detached_proposal_store(p);sql=store.statement();read=detached_proposal_read_statement(store.prepared.intent)
        object.__setattr__(store.prepared,'observed_at',clocked(store.prepared.observed_at,
            lambda:object.__setattr__(store.prepared.parts,'payload_raw',b'FICTIONAL_PRIVATE_REPLACEMENT')))
        self.assertEqual(store.statement(),sql);self.assertEqual(detached_proposal_read_statement(p.intent),read)

    def test_deep_unknown_namespaces_refuse_before_clock_hooks(self):
        for port in ['prepare','recheck','warm','cold']:
            old,ctx,p=fixture();calls=[]
            if port=='prepare':
                object.__setattr__(old.request,'foreign',object());call=lambda:prepare_detached_proposal_custody(old,ctx,operation_id=uid(810),observed_at=clocked(AT,lambda:calls.append(True)))
            elif port=='recheck':
                object.__setattr__(p.parts,'foreign',object());object.__setattr__(p,'observed_at',clocked(p.observed_at,lambda:calls.append(True)));call=lambda:recheck_prepared_detached_proposal(p)
            else:
                store=prepare_detached_proposal_store(p);raw=encode(wire(store))
                if port=='warm':
                    object.__setattr__(store,'foreign',object());object.__setattr__(store.prepared,'observed_at',clocked(store.prepared.observed_at,lambda:calls.append(True)));call=lambda:parse_stored_detached_proposal(raw,store,observed_at=LATER)
                else:
                    fresh=fresh_extraction(old);object.__setattr__(p.intent,'foreign',object());call=lambda:parse_reopened_detached_proposal(raw,p.intent,fresh,observed_at=clocked(LATER+timedelta(seconds=1),lambda:calls.append(True)))
            with self.subTest(port=port):
                with self.assertRaises(DetachedProposalCustodyError if port in ['prepare','recheck'] else DetachedProposalPostgresError):call()
                self.assertEqual(calls,[])

    def test_four_ports_preserve_fixed_faults_and_exact_cancellation(self):
        for port in ['prepare','reobserve','warm','cold']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                old,ctx,p=fixture();failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if port=='prepare':call=lambda:prepare_detached_proposal_custody(old,ctx,operation_id=uid(810),observed_at=clocked(AT,fail))
                elif port=='reobserve':
                    fresh=fresh_extraction(old);call=lambda:observe(fresh,p,clocked(STORED,fail))
                else:
                    store=prepare_detached_proposal_store(p);raw=encode(wire(store))
                    if port=='warm':
                        object.__setattr__(store.prepared,'observed_at',clocked(store.prepared.observed_at,fail));call=lambda:parse_stored_detached_proposal(raw,store,observed_at=LATER)
                    else:
                        fresh=fresh_extraction(old);call=lambda:parse_reopened_detached_proposal(raw,p.intent,fresh,observed_at=clocked(LATER+timedelta(seconds=1),fail))
                error=DetachedProposalCustodyError if port in ['prepare','reobserve'] else DetachedProposalPostgresError
                with self.subTest(port=port,kind=kind.__name__):
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        expected={'prepare':'detached_proposal_preparation_unavailable','reobserve':'detached_proposal_reobservation_unavailable','warm':'detached_proposal_stored_result_unavailable','cold':'detached_proposal_reopened_result_unavailable'}
                        self.assertEqual(str(caught.exception),expected[port]);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
