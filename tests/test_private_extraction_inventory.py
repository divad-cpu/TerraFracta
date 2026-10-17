"""Exact-pair metadata lookup, not full-result/dispatch/permission evidence."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import base64
import json
import unittest
from tests.test_private_extraction_reopen import context,NOW
from tests.test_feed_capture_reopen import encode
from tests.test_feed_postgres_contract import uid
from workers.private_extraction_inventory import (prepare_private_extraction_inventory,
    parse_private_extraction_inventory,PrivateExtractionInventoryError)
from workers.feed_postgres_contract import _time


def fixture():
    source,_,_=context()
    expected=prepare_private_extraction_inventory(source.current,source.current_receipt,source.previous,source.previous_receipt,
        maximum_output_tokens=100,observed_at=NOW+timedelta(seconds=13))
    row=dict(operation_id=uid(300),artifact_id=uid(400),prepared_at=_time(NOW),stored_at=_time(NOW+timedelta(seconds=1)),output_sha256='a'*64)
    value=dict(schema_version=1,kind='invented_private_extraction_inventory',scope=json.loads(expected.canonical_scope),
        principal='tf_feed_lab_owner',observed_at=_time(NOW+timedelta(seconds=14)),candidates=[row])
    return expected,value


def parse(raw,expected):return parse_private_extraction_inventory(raw,expected,observed_at=NOW+timedelta(seconds=15))


class PrivateExtractionInventoryTests(unittest.TestCase):
    def test_fixed_read_rechecks_exact_request_and_both_full_originals_without_ddl_write_or_new_route(self):
        expected,value=fixture();sql=expected.statement()
        self.assertIn('repeatable read read only',sql);self.assertIn('from tf_private_extraction.results',sql)
        self.assertIn('limit 51',sql);self.assertIn(base64.b64encode(expected.request.body).decode(),sql)
        self.assertIn(expected.current.result_request.operation_id,sql);self.assertIn(expected.previous.result_request.operation_id,sql)
        self.assertNotIn('store_result',sql);self.assertNotIn('create ',sql.lower());self.assertNotIn('insert ',sql.lower())
        self.assertNotIn('Changed exact',repr(expected));self.assertNotIn('example.org',repr(expected))

    def test_zero_one_and_multiple_matches_are_metadata_with_explicit_choice_still_required(self):
        expected,value=fixture()
        for rows in [[],value['candidates'],[value['candidates'][0],{**value['candidates'][0],'operation_id':uid(301),'artifact_id':uid(401)}]]:
            result=parse(encode({**value,'candidates':rows}),expected)
            self.assertEqual(len(result.candidates),len(rows));self.assertNotIn('selected',result.__dataclass_fields__)
            self.assertIn('explicit_choice_required',result.evidence_state)
            self.assertTrue(all('not_full_artifact_or_dispatch_authority' in row.evidence_state for row in result.candidates))

    def test_scope_principal_schema_and_unknown_fields_cannot_be_replaced_by_echo(self):
        expected,value=fixture()
        for mutate in [lambda v:v.update(schema_version=True),lambda v:v.update(principal='postgres'),
                lambda v:v.update(extra='PRIVATE'),lambda v:v['scope'].update(request_sha256='f'*64),
                lambda v:v['scope']['current_document'].update(artifact_id=uid(99)),lambda v:v.update(kind='approved'),
                lambda v:v['candidates'][0].update(output_raw='PRIVATE')]:
            body=deepcopy(value);mutate(body)
            with self.assertRaises(PrivateExtractionInventoryError):parse(encode(body),expected)

    def test_mutated_full_receipts_originals_and_request_refuse_before_statement_or_response_admission(self):
        expected,value=fixture()
        for bad in [replace(expected,previous=None),replace(expected,current_receipt=b'{}'),replace(expected,previous_receipt=None),
                replace(expected,request=replace(expected.request,body=b'{}')),replace(expected,canonical_scope=bytearray(expected.canonical_scope)),
                replace(expected,canonical_scope=b'{}'),replace(expected,maximum_output_tokens=True)]:
            with self.assertRaises(PrivateExtractionInventoryError):bad.statement()
            with self.assertRaises(PrivateExtractionInventoryError):parse(encode(value),bad)

    def test_duplicates_order_invalid_hash_or_timestamp_refuse_entire_inventory(self):
        expected,value=fixture();first=value['candidates'][0]
        for rows in [[first,first],[first,{**first,'operation_id':uid(299),'artifact_id':uid(401)}],
                [first,{**first,'operation_id':uid(301)}],[{**first,'output_sha256':'not-a-hash'}],
                [{**first,'prepared_at':_time(NOW+timedelta(seconds=2))}],
                [{**first,'stored_at':_time(NOW+timedelta(seconds=16))}],
                [{**first,'prepared_at':_time(NOW-timedelta(seconds=20))}]]:
            with self.assertRaises(PrivateExtractionInventoryError):parse(encode({**value,'candidates':rows}),expected)

    def test_exact_fifty_candidate_lab_cap_and_one_over_refusal_without_partial_results(self):
        expected,value=fixture();row=value['candidates'][0]
        rows=[{**row,'operation_id':uid(300+i),'artifact_id':uid(400+i)} for i in range(51)]
        self.assertEqual(len(parse(encode({**value,'candidates':rows[:50]}),expected).candidates),50)
        with self.assertRaises(PrivateExtractionInventoryError):parse(encode({**value,'candidates':rows}),expected)

    def test_exact_bytes_and_closed_json_required_before_decoder_hooks(self):
        expected,value=fixture();raw=encode(value);calls=[]
        class Hook(bytes):
            def decode(self,*args,**kwargs):calls.append('decode');return raw.decode()
        for bad in [Hook(raw),bytearray(raw),memoryview(raw),b'x'*32769,b'{"x":1,"x":2}',b'PRIVATE_CANARY /home/private']:
            with self.assertRaisesRegex(PrivateExtractionInventoryError,'^private_extraction_inventory_unavailable$'):parse(bad,expected)
        self.assertEqual(calls,[])
        self.assertEqual(len(parse(raw+b' '*(32768-len(raw)),expected).candidates),1)

    def test_closed_request_body_and_metadata_types_refuse_before_equality_hooks(self):
        from workers.passage_extraction_request import OfflineExtractionRequest
        expected,value=fixture();calls=[]
        class LyingBytes(bytes):
            def __eq__(self,other):calls.append('bytes equality');return True
            def decode(self,*args,**kwargs):calls.append('bytes decode');return '{}'
        class LyingStr(str):
            def __eq__(self,other):calls.append('string equality');return True
        class LyingInt(int):
            def __eq__(self,other):calls.append('integer equality');return True
        class Child(OfflineExtractionRequest):pass
        requests=[replace(expected.request,body=raw)for raw in
            [LyingBytes(b'{}'),bytearray(expected.request.body),memoryview(expected.request.body)]]
        requests.extend([replace(expected.request,request_sha256=LyingStr('f'*64)),
            replace(expected.request,maximum_output_tokens=LyingInt(100)),
            Child(**expected.request.__dict__)])
        for request in requests:
            bad=replace(expected,request=request)
            with self.assertRaises(PrivateExtractionInventoryError):bad.statement()
            with self.assertRaises(PrivateExtractionInventoryError):parse(encode(value),bad)
        self.assertEqual(calls,[])

    def test_native_observation_is_separate_bounded_utc_not_current_clock_or_renewed_rights(self):
        expected,value=fixture()
        for at in [None,NOW+timedelta(seconds=12),(NOW+timedelta(seconds=15)).replace(tzinfo=None)]:
            with self.assertRaises(PrivateExtractionInventoryError):parse_private_extraction_inventory(encode(value),expected,observed_at=at)
        for observed in [_time(NOW+timedelta(seconds=12)),_time(NOW+timedelta(seconds=16)),'2026-10-15T00:00:34Z']:
            with self.assertRaises(PrivateExtractionInventoryError):parse(encode({**value,'observed_at':observed}),expected)

    def test_changed_output_ceiling_changes_exact_request_scope_and_old_inventory_cannot_fit(self):
        expected,value=fixture()
        other=prepare_private_extraction_inventory(expected.current,expected.current_receipt,expected.previous,expected.previous_receipt,
            maximum_output_tokens=101,observed_at=expected.observed_at)
        self.assertNotEqual(other.request.body,expected.request.body);self.assertNotEqual(other.canonical_scope,expected.canonical_scope)
        with self.assertRaises(PrivateExtractionInventoryError):parse(encode(value),other)
        self.assertEqual(parse(encode({**value,'scope':json.loads(other.canonical_scope),'candidates':[]}),other).candidates,())

    def test_same_request_bytes_with_different_explicit_prior_document_cannot_reuse_old_scope(self):
        from tests.test_private_extraction_result import retained
        expected,value=fixture();previous,receipt=retained('Original exact invented passage.',29)
        other=prepare_private_extraction_inventory(expected.current,expected.current_receipt,previous,receipt,
            maximum_output_tokens=100,observed_at=expected.observed_at)
        self.assertEqual(other.request.body,expected.request.body)
        self.assertNotEqual(other.canonical_scope,expected.canonical_scope)
        self.assertIn(previous.result_request.operation_id,other.statement())
        with self.assertRaises(PrivateExtractionInventoryError):parse(encode(value),other)

    def test_separate_table_identity_namespaces_remain_legal_candidates(self):
        expected,value=fixture();value['candidates'][0]['operation_id']=expected.current.result_request.operation_id
        value['candidates'][0]['artifact_id']=expected.previous.artifact_id
        self.assertEqual(len(parse(encode(value),expected).candidates),1)

    def test_full_compiler_request_is_never_truncated_to_build_the_lookup(self):
        from tests.test_private_extraction_capacity import original
        current,cr=original(large=True,version=31);previous,pr=original(large=False,version=30)
        expected=prepare_private_extraction_inventory(current,cr,previous,pr,maximum_output_tokens=100,observed_at=NOW+timedelta(seconds=13))
        self.assertGreater(len(expected.request.body),80000)
        statement=expected.statement();self.assertLessEqual(len(statement.encode()),294912)
        self.assertIn(base64.b64encode(expected.request.body).decode(),statement)


class PrivateExtractionInventoryScopeTests(unittest.TestCase):
    def test_extra_target_argument_refuses_before_resource_construction(self):
        from unittest.mock import patch
        from scripts import rehearse_private_extraction_inventory as module
        with patch.object(module.sys,'argv',['trial','existing']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def test_failure_still_stops_owned_resources_and_checks_exact_sources(self):
        from contextlib import ExitStack
        from unittest.mock import Mock,patch
        from scripts import rehearse_private_extraction_inventory as module
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with ExitStack() as stack:
            stack.enter_context(patch.object(module.sys,'argv',['trial']))
            stack.enter_context(patch.object(module,'FreshFeedPostgres',return_value=trial))
            for name in ('freeze_all','freeze_change','freeze_reference','freeze_private','freeze_restore','freeze_worker','freeze_inventory'):
                stack.enter_context(patch.object(module,name))
            stack.enter_context(patch.object(module,'cases',side_effect=RuntimeError('invented')))
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_PRIVATE_INVENTORY','inspect'])


if __name__=='__main__':unittest.main()
