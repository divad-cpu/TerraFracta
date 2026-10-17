"""Cold private output recovery under independent original/request context."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_private_extraction_result import fixture,prepare,NOW
from tests.test_private_extraction_postgres import wire
from tests.test_private_extraction_reobservation import fresh_contexts
from tests.test_feed_capture_reopen import encode
from tests.test_feed_postgres_contract import uid
from workers.private_extraction_postgres import prepare_private_extraction_store
from workers.private_extraction_reopen import (prepare_private_extraction_reopen,
    parse_reopened_private_extraction,PrivateExtractionReopenError)


def context():
    values=fixture();stored=prepare_private_extraction_store(prepare(values));raw=encode(wire(stored))
    fresh=fresh_contexts(values)
    expected=prepare_private_extraction_reopen(fresh['current'],fresh['current_receipt'],fresh['previous'],fresh['previous_receipt'],
        request=fresh['request'],operation_id=fresh['operation_id'],maximum_output_tokens=100,observed_at=fresh['observed_at'])
    return expected,raw,stored


class PrivateExtractionReopenTests(unittest.TestCase):
    def test_newly_read_output_is_reparsed_without_original_response_object(self):
        expected,raw,old=context();sql=expected.statement()
        self.assertIn('repeatable read read only',sql)
        self.assertIn('select tf_private_extraction.result_receipt(',sql)
        self.assertNotIn(old.result.output_raw.decode(),sql)
        result=parse_reopened_private_extraction(raw,expected,observed_at=NOW+timedelta(seconds=13))
        self.assertEqual(result.result.output_raw,old.result.output_raw)
        self.assertEqual(result.result.request.body,old.result.request.body)
        self.assertEqual(result.result.proposal.review_state,'unverified')
        self.assertEqual(result.result.prepared_at,old.result.prepared_at)
        self.assertGreater(result.result.observed_at,old.result.observed_at)
        self.assertEqual(result.store_request.canonical_metadata,old.canonical_metadata)
        self.assertEqual(result.full_receipt,raw)
        self.assertNotIn('Changed exact',repr(result))

    def test_independent_operation_request_document_and_ceiling_cannot_be_replaced_by_echo(self):
        expected,raw,_=context()
        for bad in [replace(expected,operation_id=uid(99)),replace(expected,maximum_output_tokens=101),
                replace(expected,request=replace(expected.request,request_sha256='f'*64)),
                replace(expected,current_receipt=b'{}'),replace(expected,previous=None),
                replace(expected,canonical_input=b'{}')]:
            with self.assertRaises(PrivateExtractionReopenError):bad.statement()
            with self.assertRaises(PrivateExtractionReopenError):parse_reopened_private_extraction(raw,bad,observed_at=NOW+timedelta(seconds=13))

    def test_complete_actual_request_bytes_and_both_stored_document_references_are_required(self):
        expected,raw,_=context();value=json.loads(raw)
        for mutate in [lambda v:v.update(request_base64=base64.b64encode(b'{}').decode()),
                lambda v:v['input']['current_document'].update(artifact_id=uid(99)),
                lambda v:v['input']['previous_document'].update(content_sha256='f'*64),
                lambda v:v['input']['proposal'].update(review_state='approved'),
                lambda v:v.update(operation_id=uid(99)),lambda v:v.update(extra=True),
                lambda v:v.update(schema_version=True)]:
            bad=deepcopy(value);mutate(bad)
            with self.assertRaises(PrivateExtractionReopenError):parse_reopened_private_extraction(encode(bad),expected,observed_at=NOW+timedelta(seconds=13))

    def test_output_base64_bound_utf8_proposal_and_digest_failure_never_fall_back(self):
        expected,raw,_=context();value=json.loads(raw)
        for output in ['!',None,'',value['output_base64']+'\n',base64.b64encode(b'x'*8193).decode(),
                base64.b64encode(b'\xff').decode(),base64.b64encode(b'{}').decode()]:
            with self.assertRaises(PrivateExtractionReopenError):parse_reopened_private_extraction(encode({**value,'output_base64':output}),expected,observed_at=NOW+timedelta(seconds=13))
        changed=deepcopy(value);changed['input']['output_sha256']='f'*64
        with self.assertRaises(PrivateExtractionReopenError):parse_reopened_private_extraction(encode(changed),expected,observed_at=NOW+timedelta(seconds=13))

    def test_historical_intent_and_current_observation_have_separate_bounds(self):
        expected,raw,_=context();value=json.loads(raw)
        for at in [None,NOW+timedelta(seconds=11),(NOW+timedelta(seconds=13)).replace(tzinfo=None)]:
            with self.assertRaises(PrivateExtractionReopenError):parse_reopened_private_extraction(raw,expected,observed_at=at)
        for prepared in ['2026-10-15T00:00:00.000000Z','2026-10-15T00:00:50.000000Z','invalid']:
            changed=deepcopy(value);changed['input']['prepared_at']=prepared
            with self.assertRaises(PrivateExtractionReopenError):parse_reopened_private_extraction(encode(changed),expected,observed_at=NOW+timedelta(seconds=13))

    def test_distinct_source_versions_cannot_alias_one_stored_document_identity(self):
        from tests.test_reopened_document_change import paired
        from workers.reopened_document_change import prepare_reopened_document_change
        from workers.passage_extraction_request import compile_extraction_request
        (current,cr),(previous,pr)=paired('Changed')
        pair=prepare_reopened_document_change(current,cr,previous,pr,observed_at=NOW)
        request=compile_extraction_request(pair.current,pair.previous,observed_at=NOW,maximum_output_tokens=100)
        with self.assertRaises(PrivateExtractionReopenError):
            prepare_private_extraction_reopen(current,cr,previous,pr,request=request,operation_id=uid(600),maximum_output_tokens=100,observed_at=NOW)

    def test_raw_and_canonical_bytes_are_closed_before_hooks_and_private_refusal_is_fixed(self):
        expected,raw,_=context();calls=[]
        class Hook(bytes):
            def decode(self,*args,**kwargs):calls.append(True);return raw.decode()
        for bad in [Hook(raw),bytearray(raw),b'x'*131073,b'{"x":1,"x":2}',b'PRIVATE_CANARY /home/private']:
            with self.assertRaisesRegex(PrivateExtractionReopenError,'^private_extraction_reopen_unavailable$'):
                parse_reopened_private_extraction(bad,expected,observed_at=NOW+timedelta(seconds=13))
        with self.assertRaises(PrivateExtractionReopenError):replace(expected,canonical_input=Hook(expected.canonical_input)).statement()
        self.assertEqual(calls,[])


if __name__=='__main__':unittest.main()
