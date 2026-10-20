"""Complete plain extraction parents preserve invented entry assertions; no SQL."""
from asyncio import CancelledError
from datetime import tzinfo,timedelta
from dataclasses import asdict
import json
import unittest
from tests.test_passage_extraction_request import document,request as compile_fixture,proposal,NOW as REQUEST_AT
from tests.test_private_extraction_result import fixture,prepare,NOW
from tests.test_private_extraction_postgres import wire
from workers.passage_extraction_request import (FullRequestTokenLimit,ExtractionRequestError,
    bind_full_request_token_limit,parse_extraction_request_proposal)
from workers.model_proposal import ModelProposalError
from workers.private_extraction_result import PrivateExtractionResultError,recheck_private_extraction_result
from workers.private_extraction_postgres import (PrivateExtractionPostgresError,prepare_private_extraction_store,
    private_extraction_read_statement,parse_stored_private_extraction_result)

class Clock(tzinfo):
    def __init__(self,callback):self.callback=callback;self.calls=0
    def utcoffset(self,value):
        self.calls+=1
        if self.calls==1:self.callback()
        return timedelta(0)
    def dst(self,value):return timedelta(0)

def clocked(at,callback):return at.replace(tzinfo=Clock(callback))
def bind(v,compiled,proof,at=REQUEST_AT):
    return bind_full_request_token_limit(compiled,current=v.current,previous=v.previous,
        observed_at=at,maximum_output_tokens=100,proof=proof)
def parse(raw,v,compiled,at=REQUEST_AT):
    return parse_extraction_request_proposal(raw,compiled,current=v.current,previous=v.previous,
        observed_at=at,maximum_output_tokens=100)
def stored():return prepare_private_extraction_store(prepare(fixture()))

class PlainPrivateEntrySnapshotTests(unittest.TestCase):
    def test_invalid_request_and_proof_cannot_be_repaired_during_regeneration(self):
        for mode in ['bind','parse','proof']:
            v=document();compiled=compile_fixture(v);raw=proposal(v)
            proof=FullRequestTokenLimit(v.item_key,compiled.request_sha256,200)
            owner=proof if mode=='proof' else compiled;field='maximum_input_tokens' if mode=='proof' else 'request_sha256';good=getattr(owner,field)
            object.__setattr__(owner,field,0 if mode=='proof' else '0'*64)
            at=clocked(REQUEST_AT,lambda:object.__setattr__(owner,field,good))
            with self.subTest(mode=mode):
                with self.assertRaises(ExtractionRequestError):
                    parse(raw,v,compiled,at) if mode=='parse' else bind(v,compiled,proof,at)

    def test_valid_request_proof_and_raw_survive_callback_damage(self):
        for mode in ['bind','parse']:
            v=document();compiled=compile_fixture(v);raw=proposal(v);proof=FullRequestTokenLimit(v.item_key,compiled.request_sha256,200)
            expected=parse(raw,v,compiled) if mode=='parse' else bind(v,compiled,proof)
            def damage():
                object.__setattr__(compiled,'body',b'FICTIONAL_PRIVATE_REPLACEMENT')
                object.__setattr__(compiled,'selected_payload_sha256','0'*64)
                object.__setattr__(proof,'maximum_input_tokens',999)
            at=clocked(REQUEST_AT,damage)
            with self.subTest(mode=mode):self.assertEqual(parse(raw,v,compiled,at) if mode=='parse' else bind(v,compiled,proof,at),expected)

    def test_each_invalid_reopened_original_artifact_cannot_be_repaired(self):
        for side in ['current','previous']:
            values=fixture();owner=values[side];good=owner.artifact_id
            object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')
            values['observed_at']=clocked(values['observed_at'],lambda:object.__setattr__(owner,'artifact_id',good))
            with self.subTest(side=side):
                with self.assertRaises(PrivateExtractionResultError):prepare(values)

    def test_valid_complete_private_pair_keeps_canonical_output_and_owned_records(self):
        values=fixture();expected=prepare(values);canonical=expected.canonical_input
        def damage():
            object.__setattr__(values['previous'],'response_raw',b'{}')
            object.__setattr__(values['request'],'body',b'{}')
        values['observed_at']=clocked(values['observed_at'],damage)
        actual=prepare(values);self.assertEqual(actual.canonical_input,canonical)
        self.assertEqual(actual.output_raw,expected.output_raw)
        self.assertIsNot(actual.current,values['current']);self.assertIsNot(actual.previous,values['previous'])
        self.assertIsNot(actual.current.result_request,values['current'].result_request)

    def test_recheck_captures_canonical_request_and_proposal_before_clock(self):
        for invalid in [False,True]:
            value=prepare(fixture());canonical=value.canonical_input
            if invalid:object.__setattr__(value,'canonical_input',b'{}')
            def change():
                if invalid:object.__setattr__(value,'canonical_input',canonical)
                else:
                    object.__setattr__(value.proposal,'review_state','verified')
                    object.__setattr__(value.request,'body',b'{}')
            object.__setattr__(value,'observed_at',clocked(value.observed_at,change))
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(PrivateExtractionResultError):recheck_private_extraction_result(value)
                else:
                    actual=recheck_private_extraction_result(value);self.assertEqual(actual.canonical_input,canonical)
                    self.assertEqual(actual.proposal.review_state,'unverified');self.assertIsNot(actual.proposal,value.proposal)

    def test_invalid_outer_store_metadata_cannot_be_repaired_for_any_consumer(self):
        for mode in ['write','read','parse']:
            value=stored();raw=json.dumps(wire(value)).encode();good=value.canonical_metadata
            object.__setattr__(value,'canonical_metadata',b'{}')
            object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,
                lambda:object.__setattr__(value,'canonical_metadata',good)))
            with self.subTest(mode=mode):
                with self.assertRaises(PrivateExtractionPostgresError):
                    if mode=='write':value.statement()
                    elif mode=='read':private_extraction_read_statement(value)
                    else:parse_stored_private_extraction_result(raw,value,observed_at=NOW+timedelta(seconds=2))

    def test_write_and_read_sql_consume_owned_checked_result(self):
        for mode in ['write','read']:
            value=stored();expected=value.statement() if mode=='write' else private_extraction_read_statement(value)
            def damage():
                object.__setattr__(value,'canonical_metadata',b'{}')
                object.__setattr__(value.result,'operation_id','90000000-0000-4000-8000-000000000001')
            object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,damage))
            with self.subTest(mode=mode):self.assertEqual(value.statement() if mode=='write' else private_extraction_read_statement(value),expected)

    def test_receipt_parse_preserves_expected_request_before_observation_callback(self):
        value=stored();raw=json.dumps(wire(value)).encode();at=NOW+timedelta(seconds=2)
        baseline=parse_stored_private_extraction_result(raw,value,observed_at=at)
        actual=parse_stored_private_extraction_result(raw,value,observed_at=clocked(at,
            lambda:object.__setattr__(value.result.request,'body',b'FICTIONAL_PRIVATE_REPLACEMENT')))
        self.assertEqual(asdict(actual),asdict(baseline))

    def test_unknown_namespaces_and_foreign_raw_refuse_before_utc_hooks(self):
        for port in ['request','raw','private','store']:
            calls=[]
            if port in ['request','raw']:
                v=document();compiled=compile_fixture(v);raw=proposal(v)
                if port=='request':object.__setattr__(compiled,'foreign',object())
                else:
                    class OtherBytes(bytes):
                        def decode(self,*args,**kwargs):raise AssertionError('Foreign decoder must not run')
                    raw=OtherBytes(raw)
                call=lambda:parse(raw,v,compiled,clocked(REQUEST_AT,lambda:calls.append(True)));error=ModelProposalError if port=='raw' else ExtractionRequestError
            elif port=='private':
                values=fixture();object.__setattr__(values['previous'],'foreign',object())
                values['observed_at']=clocked(values['observed_at'],lambda:calls.append(True));call=lambda:prepare(values);error=PrivateExtractionResultError
            else:
                value=stored();object.__setattr__(value,'foreign',object())
                object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,lambda:calls.append(True)))
                call=value.statement;error=PrivateExtractionPostgresError
            with self.subTest(port=port):
                with self.assertRaises(error):call()
                self.assertEqual(calls,[])

    def test_fixed_snapshot_fault_and_exact_cancellation_at_three_parent_ports(self):
        for port in ['request','private','store']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if port=='request':
                    v=document();compiled=compile_fixture(v);proof=FullRequestTokenLimit(v.item_key,compiled.request_sha256,200)
                    call=lambda:bind(v,compiled,proof,clocked(REQUEST_AT,fail));error=ExtractionRequestError
                elif port=='private':
                    values=fixture();values['observed_at']=clocked(values['observed_at'],fail)
                    call=lambda:prepare(values);error=PrivateExtractionResultError
                else:
                    value=stored();object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,fail));call=value.statement;error=PrivateExtractionPostgresError
                with self.subTest(port=port,kind=kind.__name__):
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        allowed={'request':{'extraction_request_binding_mismatch','extraction_full_token_binding_mismatch'},'private':{'private_extraction_result_unavailable'},'store':{'private_extraction_store_input_unavailable'}}
                        self.assertIn(str(caught.exception),allowed[port]);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
