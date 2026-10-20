"""Owned read-only feed inventory requests; invented protocol and SQL strings."""
from asyncio import CancelledError
from copy import deepcopy
from dataclasses import asdict
from datetime import tzinfo,timedelta
import unittest
from unittest.mock import patch
from tests.test_feed_collection_inventory import SCOPE,CUT,AT,payload,raw,row,event
from workers.feed_collection_inventory import (prepare_inventory_request,parse_collection_inventory_page,FeedInventoryError)

class Clock(tzinfo):
    def __init__(self,fn=lambda:None):self.fn=fn;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==1:self.fn()
        return timedelta(0)
    def dst(self,value):return timedelta(0)
    def __deepcopy__(self,memo):return self

def request_with_cut():return prepare_inventory_request(deepcopy(SCOPE),item_limit=2,cut=deepcopy(CUT))
def nested_clock(request,fn):object.__setattr__(request.cut,'page_stored_at',request.cut.page_stored_at.replace(tzinfo=Clock(fn)))
def read(body,request,at=None):return parse_collection_inventory_page(body,request,observed_at=AT+timedelta(seconds=11) if at is None else at)

class FeedInventoryEntrySnapshotTests(unittest.TestCase):
    def test_initial_invalid_statement_binding_cannot_be_repaired_by_cut_clock(self):
        for repair in (False,True):
            request=request_with_cut();good=request.canonical_input;object.__setattr__(request,'canonical_input',b'{}')
            if repair:nested_clock(request,lambda:object.__setattr__(request,'canonical_input',good))
            with self.subTest(repair=repair):
                with self.assertRaises(FeedInventoryError):request.statement()

    def test_parse_rejects_initial_bad_binding_despite_nested_cut_repair(self):
        for repair in (False,True):
            request=request_with_cut();body=raw(payload(request));good=request.canonical_input;object.__setattr__(request,'canonical_input',b'{}')
            if repair:nested_clock(request,lambda:object.__setattr__(request,'canonical_input',good))
            with self.subTest(repair=repair):
                with self.assertRaises(FeedInventoryError):read(body,request)

    def test_prepare_owns_scope_and_cut_before_time_validation(self):
        for target in ('scope','cut'):
            scope=deepcopy(SCOPE);cut=deepcopy(CUT);baseline=prepare_inventory_request(deepcopy(scope),item_limit=2,cut=deepcopy(cut))
            def change():
                if target=='scope':object.__setattr__(scope,'initial_url','https://example.org/changed.xml')
                else:object.__setattr__(cut,'stream_revision',65)
            object.__setattr__(cut,'page_stored_at',cut.page_stored_at.replace(tzinfo=Clock(change)))
            with self.subTest(target=target):
                actual=prepare_inventory_request(scope,item_limit=2,cut=cut)
                self.assertEqual(asdict(actual),asdict(baseline));self.assertIsNot(actual.scope,scope);self.assertIsNot(actual.cut,cut)
                self.assertEqual(actual.statement(),baseline.statement())

    def test_statement_uses_checked_original_scope_and_cut_after_callback(self):
        request=request_with_cut();baseline=request.statement()
        nested_clock(request,lambda:object.__setattr__(request,'canonical_input',b'{}'))
        self.assertEqual(request.statement(),baseline)
        self.assertIn('repeatable read read only',baseline);self.assertNotIn('insert ',baseline)

    def test_parse_owns_expected_before_explicit_observation_and_returns_detached_scope(self):
        for target in ('scope','cut','canonical'):
            request=request_with_cut();body=raw(payload(request));baseline=asdict(read(body,request))
            def change():
                if target=='scope':object.__setattr__(request.scope,'initial_url','https://example.org/changed.xml')
                elif target=='cut':object.__setattr__(request.cut,'page_id','70000000-0000-4000-8000-000000009999')
                else:object.__setattr__(request,'canonical_input',b'{}')
            at=(AT+timedelta(seconds=11)).replace(tzinfo=Clock(change))
            with self.subTest(target=target):
                actual=read(body,request,at);self.assertEqual(asdict(actual),baseline);self.assertIsNot(actual.scope,request.scope)

    def test_foreign_consumed_namespaces_refuse_before_any_clock(self):
        for port in ('prepare','statement','parse'):
            request=request_with_cut();body=raw(payload(request));calls=[]
            object.__setattr__(request.scope,'foreign',object());nested_clock(request,lambda:calls.append(True))
            with self.subTest(port=port):
                with self.assertRaises(FeedInventoryError):
                    if port=='prepare':prepare_inventory_request(request.scope,item_limit=2,cut=request.cut)
                    elif port=='statement':request.statement()
                    else:read(body,request)
                self.assertEqual(calls,[])

    def test_faults_are_fixed_and_cancellation_identity_survives(self):
        for port in ('prepare','statement','parse'):
            for kind in (RuntimeError,KeyboardInterrupt,SystemExit,CancelledError):
                request=request_with_cut();body=raw(payload(request));fault=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise fault
                nested_clock(request,fail)
                with self.subTest(port=port,kind=kind.__name__):
                    with self.assertRaises(FeedInventoryError if kind is RuntimeError else kind) as caught:
                        if port=='prepare':prepare_inventory_request(request.scope,item_limit=2,cut=request.cut)
                        elif port=='statement':request.statement()
                        else:read(body,request)
                    if kind is RuntimeError:
                        self.assertNotIn('FICTIONAL_PRIVATE',str(caught.exception));self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,fault)

    def test_caps_and_current_outcomes_preserve_same_cut_without_global_snapshot_claim(self):
        request=request_with_cut();first=row();first['outcomes']=[event(first['item_id'])]
        old=read(raw(payload(request,[first],more=False)),request)
        first['outcomes'].append(event(first['item_id'],2,'processed',101,3))
        later=read(raw(payload(request,[first],more=False)),request)
        self.assertEqual(old.cut,later.cut);self.assertEqual(old.rows[0].processing_state,'failed');self.assertEqual(later.rows[0].processing_state,'processed')
        self.assertEqual(later.rows[0].outcome_revision,2);self.assertNotIn('global',later.evidence_state)
        for limit in (0,True,21):
            with self.assertRaises(FeedInventoryError):prepare_inventory_request(deepcopy(SCOPE),item_limit=limit)
        with patch('workers.feed_collection_inventory.MAX_INVENTORY_STATEMENT',len(request.statement().encode())-1):
            with self.assertRaises(FeedInventoryError):request.statement()

if __name__=='__main__':unittest.main()
