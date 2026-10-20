"""Original/read-only metadata parent entry snapshots; invented receipts only."""
from asyncio import CancelledError
from copy import deepcopy
from dataclasses import asdict
from datetime import tzinfo,timedelta
import unittest
from tests.test_document_result_reopen import fixture as document_fixture
from tests.test_stored_document_reference import fixture as reference_fixture
from tests.test_feed_capture_reopen import encode
from workers.document_result_reopen import (prepare_document_reopen,parse_reopened_document,
    confirm_reopened_document_result,DocumentReopenError)
from workers.stored_document_reference import (stored_document_reference_statement,
    parse_stored_document_reference,StoredDocumentReferenceError)

class Clock(tzinfo):
    def __init__(self,fn=lambda:None):self.fn=fn;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==1:self.fn()
        return timedelta(0)
    def dst(self,value):return timedelta(0)
    def __deepcopy__(self,memo):return self

def clocked(at,fn):return at.replace(tzinfo=Clock(fn))
def prepare(request,at):
    return prepare_document_reopen(request.feed,request.page_receipt,request.history_raw,
        binding=request.binding,mapping=request.mapping,association=request.association,observed_at=at)

class OriginalReferenceEntrySnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.document_seed=document_fixture();cls.reference_seed=reference_fixture()
    def document(self):return deepcopy(self.document_seed)
    def reference(self,present=True):
        request,value,at=deepcopy(self.reference_seed)
        if not present:value['reference']=None
        return request,value,at

    def test_prepare_owns_consumed_graph_before_observation_callback(self):
        for invalid in (True,False):
            _,request,_,_,_=self.document();baseline=asdict(request);good=request.association.document_content_sha256
            if invalid:object.__setattr__(request.association,'document_content_sha256','f'*64)
            def change():
                if invalid:object.__setattr__(request.association,'document_content_sha256',good)
                else:object.__setattr__(request.binding,'source_url','https://example.org/changed')
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DocumentReopenError):prepare(request,clocked(request.observed_at,change))
                else:
                    actual=prepare(request,clocked(request.observed_at,change));self.assertEqual(asdict(actual),baseline)
                    self.assertIsNot(actual.feed,request.feed);self.assertIsNot(actual.binding,request.binding)

    def test_statement_refuses_repaired_binding_and_preserves_valid_original_sql(self):
        for invalid in (True,False):
            _,request,_,_,_=self.document();good=request.canonical_input;sql=request.statement()
            if invalid:object.__setattr__(request,'canonical_input',b'{}')
            object.__setattr__(request,'observed_at',clocked(request.observed_at,
                lambda:object.__setattr__(request,'canonical_input',good if invalid else b'{}')))
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DocumentReopenError):request.statement()
                else:self.assertEqual(request.statement(),sql)

    def test_parse_cannot_admit_initial_binding_repaired_by_explicit_clock(self):
        for repair in (False,True):
            _,request,value,_,at=self.document();good=request.canonical_input;object.__setattr__(request,'canonical_input',b'{}')
            if repair:at=clocked(at,lambda:object.__setattr__(request,'canonical_input',good))
            with self.subTest(repair=repair):
                with self.assertRaises(DocumentReopenError):parse_reopened_document(encode(value),request,observed_at=at)

    def test_parse_returns_owned_original_context_after_valid_mapping_damage(self):
        _,request,value,_,at=self.document();body=encode(value);baseline=asdict(parse_reopened_document(body,request,observed_at=at))
        actual=parse_reopened_document(body,request,observed_at=clocked(at,
            lambda:object.__setattr__(request.mapping.spans[0],'start',-1)))
        self.assertEqual(asdict(actual),baseline);self.assertIsNot(actual.request,request);self.assertIsNot(actual.request.mapping,request.mapping)

    def test_complete_result_confirmation_captures_receipt_and_reopened_graph(self):
        for invalid in (True,False):
            _,request,value,stored,at=self.document();reopened=parse_reopened_document(encode(value),request,observed_at=at)
            baseline=asdict(confirm_reopened_document_result(encode(stored),reopened,observed_at=at));good=reopened.artifact_id
            if invalid:object.__setattr__(reopened,'artifact_id','70000000-0000-4000-8000-000000009999')
            def change():object.__setattr__(reopened,'artifact_id',good if invalid else '70000000-0000-4000-8000-000000009999')
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(DocumentReopenError):confirm_reopened_document_result(encode(stored),reopened,observed_at=clocked(at,change))
                else:self.assertEqual(asdict(confirm_reopened_document_result(encode(stored),reopened,observed_at=clocked(at,change))),baseline)

    def test_present_and_absent_reference_reject_repair_and_keep_owned_occurrence(self):
        for present in (True,False):
            for invalid in (True,False):
                request,value,at=self.reference(present);body=encode(value);baseline=asdict(parse_stored_document_reference(body,request,observed_at=at));good=request.canonical_input
                if invalid:object.__setattr__(request,'canonical_input',b'{}')
                def change():
                    if invalid:object.__setattr__(request,'canonical_input',good)
                    else:object.__setattr__(request,'item_id','70000000-0000-4000-8000-000000009999')
                with self.subTest(present=present,invalid=invalid):
                    if invalid:
                        with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(body,request,observed_at=clocked(at,change))
                    else:
                        actual=parse_stored_document_reference(body,request,observed_at=clocked(at,change));self.assertEqual(asdict(actual),baseline)
                        self.assertIsNot(actual.request,request);self.assertIsNot(actual.request.inventory_request,request.inventory_request)

    def test_fixed_reference_route_and_historical_absence_stay_separate(self):
        request,value,at=self.reference(False);sql=stored_document_reference_statement(request)
        self.assertEqual(sql,request.statement().replace('select tf_feed_reopen.original(','select tf_feed_runtime.document_reference(',1))
        actual=parse_stored_document_reference(encode(value),request,observed_at=at)
        self.assertIsNone(actual.reference);self.assertEqual(actual.request.item_id,request.item_id)
        self.assertEqual(actual.evidence_state,'invented_single_occurrence_document_reference_only')

    def test_consumed_unknown_namespaces_and_foreign_raw_refuse_before_hooks(self):
        for port in ('prepare','statement','parse','confirm','reference'):
            _,request,value,stored,at=self.document();calls=[];clock=lambda:calls.append(True)
            if port=='confirm':
                reopened=parse_reopened_document(encode(value),request,observed_at=at);object.__setattr__(reopened.result_request.mapping.spans[0],'foreign',object())
                call=lambda:confirm_reopened_document_result(encode(stored),reopened,observed_at=clocked(at,clock))
            elif port=='reference':
                ref,v,t=self.reference();object.__setattr__(ref.inventory_request.scope,'foreign',object());call=lambda:parse_stored_document_reference(encode(v),ref,observed_at=clocked(t,clock))
            else:
                object.__setattr__(request.mapping.spans[0],'foreign',object())
                if port=='prepare':call=lambda:prepare(request,clocked(request.observed_at,clock))
                elif port=='statement':
                    object.__setattr__(request,'observed_at',clocked(request.observed_at,clock));call=request.statement
                else:call=lambda:parse_reopened_document(encode(value),request,observed_at=clocked(at,clock))
            with self.subTest(port=port):
                with self.assertRaises(StoredDocumentReferenceError if port=='reference' else DocumentReopenError):call()
                self.assertEqual(calls,[])
        for port in ('parse','confirm','reference'):
            _,request,value,stored,at=self.document();calls=[]
            if port=='reference':
                ref,_,t=self.reference();call=lambda:parse_stored_document_reference(bytearray(b'{}'),ref,observed_at=clocked(t,lambda:calls.append(True)))
            elif port=='parse':call=lambda:parse_reopened_document(bytearray(b'{}'),request,observed_at=clocked(at,lambda:calls.append(True)))
            else:
                reopened=parse_reopened_document(encode(value),request,observed_at=at);call=lambda:confirm_reopened_document_result(bytearray(b'{}'),reopened,observed_at=clocked(at,lambda:calls.append(True)))
            with self.subTest(foreign_raw_port=port):
                with self.assertRaises(StoredDocumentReferenceError if port=='reference' else DocumentReopenError):call()
                self.assertEqual(calls,[])

    def test_callback_faults_are_fixed_and_baseexceptions_keep_identity(self):
        for port in ('prepare','statement','parse','confirm','reference'):
            for kind in (RuntimeError,KeyboardInterrupt,SystemExit,CancelledError):
                _,request,value,stored,at=self.document();fault=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise fault
                if port=='prepare':call=lambda:prepare(request,clocked(request.observed_at,fail))
                elif port=='statement':
                    object.__setattr__(request,'observed_at',clocked(request.observed_at,fail));call=request.statement
                elif port=='parse':call=lambda:parse_reopened_document(encode(value),request,observed_at=clocked(at,fail))
                elif port=='confirm':
                    reopened=parse_reopened_document(encode(value),request,observed_at=at);call=lambda:confirm_reopened_document_result(encode(stored),reopened,observed_at=clocked(at,fail))
                else:
                    ref,v,t=self.reference();call=lambda:parse_stored_document_reference(encode(v),ref,observed_at=clocked(t,fail))
                with self.subTest(port=port,kind=kind.__name__):
                    error=StoredDocumentReferenceError if port=='reference' else DocumentReopenError
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:self.assertNotIn('FICTIONAL_PRIVATE',str(caught.exception));self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,fault)

if __name__=='__main__':unittest.main()
