"""Explicit selection closes metadata-to-full-receipt races without trust gains."""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from tests.test_private_extraction_inventory import fixture as inventory_fixture
from tests.test_private_extraction_result import fixture,prepare,NOW
from tests.test_private_extraction_postgres import wire
from tests.test_feed_capture_reopen import encode
from tests.test_feed_postgres_contract import uid
from workers.private_extraction_postgres import prepare_private_extraction_store
from workers.private_extraction_selection import read_selected_private_extraction,PrivateExtractionSelectionError
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER


def framed(raw):return WorkerOutput(raw+b'\n'+COMMIT_MARKER+b'\n',b'',0)


def context(*,multiple=False):
    expected,value=inventory_fixture();full={};rows=[]
    for index in range(2 if multiple else 1):
        v=fixture();v['operation_id']=uid(300+index)
        if index:
            output=json.loads(v['output_raw']);output['proposed_assertion']='Another unverified invented assertion.';v['output_raw']=encode(output)
        # Test storage factory assigns distinct generated private artifact IDs.
        body={**wire(prepare_private_extraction_store(prepare(v))),'artifact_id':uid(400+index)}
        full[v['operation_id']]=encode(body)
        rows.append(dict(operation_id=body['operation_id'],artifact_id=body['artifact_id'],prepared_at=body['input']['prepared_at'],
            stored_at=body['stored_at'],output_sha256=body['input']['output_sha256']))
    return expected,{**value,'candidates':rows},full


class Port:
    def __init__(self,raw):self.raw=raw;self.calls=[]
    def __call__(self,sql):
        self.calls.append(sql)
        if isinstance(self.raw,BaseException):raise self.raw
        return framed(self.raw)


def run(expected,value,port,*,operation_id=uid(300),clock=None):
    return read_selected_private_extraction(framed(encode(value)),expected,operation_id=operation_id,
        query=port,utc_now=clock or (lambda:NOW+timedelta(seconds=15)))


class PrivateExtractionSelectionTests(unittest.TestCase):
    def test_explicit_member_full_receipt_and_report_match_all_selected_metadata(self):
        expected,value,full=context();port=Port(full[uid(300)]);result=run(expected,value,port)
        self.assertEqual(len(port.calls),1);self.assertEqual(result.candidate.operation_id,uid(300))
        self.assertEqual(result.read.reopened.full_receipt,full[uid(300)])
        self.assertEqual(result.candidate.artifact_id,result.read.reopened.stored.artifact_id)
        self.assertEqual(result.candidate.output_sha256,sha256(result.read.reopened.result.output_raw).hexdigest())
        self.assertEqual(json.loads(result.read.report_raw)['review_state'],'unverified')
        self.assertNotIn('Changed exact',repr(result));self.assertNotIn('example.org',repr(result))

    def test_operation_is_required_and_single_or_multiple_rows_never_choose_it(self):
        expected,value,full=context(multiple=True);port=Port(full[uid(300)])
        with self.assertRaises(TypeError):read_selected_private_extraction(framed(encode(value)),expected,query=port,utc_now=lambda:NOW+timedelta(seconds=15))
        self.assertEqual(port.calls,[])
        for operation in [None,uid(999),'PRIVATE_CANARY /home/private']:
            with self.assertRaises(PrivateExtractionSelectionError):run(expected,value,port,operation_id=operation)
        self.assertEqual(port.calls,[])

    def test_explicit_second_candidate_is_not_replaced_with_first(self):
        expected,value,full=context(multiple=True);port=Port(full[uid(301)])
        result=run(expected,value,port,operation_id=uid(301))
        self.assertEqual(result.candidate.operation_id,uid(301));self.assertEqual(result.read.reopened.full_receipt,full[uid(301)])
        self.assertIn(uid(301),port.calls[0]);self.assertNotIn(uid(300),port.calls[0])

    def test_zero_and_nonmember_operation_hold_before_artifact_query(self):
        expected,value,full=context();port=Port(full[uid(300)])
        with self.assertRaises(PrivateExtractionSelectionError):run(expected,{**value,'candidates':[]},port)
        with self.assertRaises(PrivateExtractionSelectionError):run(expected,value,port,operation_id=uid(999))
        self.assertEqual(port.calls,[])

    def test_changed_artifact_hash_preparation_or_storage_time_holds_after_exact_one_read(self):
        expected,value,full=context()
        for changes in [dict(artifact_id=uid(999)),dict(output_sha256='f'*64),
                dict(prepared_at='2026-10-15T00:00:19.000000Z'),dict(stored_at='2026-10-15T00:00:22.000000Z')]:
            bad=deepcopy(value);bad['candidates'][0].update(changes);port=Port(full[uid(300)])
            with self.assertRaisesRegex(PrivateExtractionSelectionError,'^private_extraction_selection_unavailable$'):run(expected,bad,port)
            self.assertEqual(len(port.calls),1)

    def test_missing_commit_errors_or_nonexact_inventory_output_hold_before_query(self):
        expected,value,full=context();good=framed(encode(value));calls=[]
        class Hook(bytes):
            def decode(self,*args,**kwargs):calls.append('decode');return '{}'
        for output in [WorkerOutput(encode(value),b'',0),WorkerOutput(good.stdout,b'PRIVATE',0),
                WorkerOutput(good.stdout,b'',True),WorkerOutput(Hook(good.stdout),b'',0),
                dict(stdout=good.stdout,stderr=b'',returncode=0)]:
            port=Port(full[uid(300)])
            with self.assertRaises(PrivateExtractionSelectionError):read_selected_private_extraction(output,expected,operation_id=uid(300),query=port,utc_now=lambda:NOW+timedelta(seconds=15))
            self.assertEqual(port.calls,[])
        self.assertEqual(calls,[])

    def test_wrong_full_artifact_or_backend_error_never_returns_partial_report_or_retries(self):
        expected,value,full=context(multiple=True)
        for raw in [full[uid(301)],b'{}',RuntimeError('PRIVATE_BACKEND /home/private')]:
            port=Port(raw)
            with self.assertRaisesRegex(PrivateExtractionSelectionError,'^private_extraction_selection_unavailable$'):run(expected,value,port)
            self.assertEqual(len(port.calls),1)

    def test_shared_monotone_clock_spans_inventory_and_artifact_dispatch(self):
        expected,value,full=context();at=NOW+timedelta(seconds=15)
        for ticks,count in [([None],0),([at,at-timedelta(microseconds=1)],0),([at,at,at,None],1)]:
            port=Port(full[uid(300)]);clock=iter(ticks)
            with self.assertRaises(PrivateExtractionSelectionError):run(expected,value,port,clock=lambda:next(clock))
            self.assertEqual(len(port.calls),count)
        clock=iter([at+timedelta(microseconds=i)for i in range(4)])
        result=run(expected,value,Port(full[uid(300)]),clock=lambda:next(clock))
        self.assertEqual(result.read.reopened.observed_at,at+timedelta(microseconds=3))

    def test_process_interrupt_is_not_relabelled_as_a_private_absence(self):
        expected,value,full=context();port=Port(KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):run(expected,value,port)
        self.assertEqual(len(port.calls),1)

    def test_mutated_inventory_scope_is_not_replaced_by_valid_full_artifact(self):
        expected,value,full=context();bad=deepcopy(value);bad['scope']['current_document']['artifact_id']=uid(999)
        port=Port(full[uid(300)])
        with self.assertRaises(PrivateExtractionSelectionError):run(expected,bad,port)
        self.assertEqual(port.calls,[])


class PrivateExtractionSelectionScopeTests(unittest.TestCase):
    def test_extra_target_argument_refuses_before_resource_construction(self):
        from unittest.mock import patch
        from scripts import rehearse_private_extraction_selection as module
        with patch.object(module.sys,'argv',['trial','existing']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def test_case_failure_still_stops_owned_resources_and_verifies_bound_source(self):
        from contextlib import ExitStack
        from unittest.mock import Mock,patch
        from scripts import rehearse_private_extraction_selection as module
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with ExitStack() as stack:
            stack.enter_context(patch.object(module.sys,'argv',['trial']))
            stack.enter_context(patch.object(module,'FreshFeedPostgres',return_value=trial))
            for name in ('freeze_all','freeze_change','freeze_reference','freeze_private','freeze_restore','freeze_worker','freeze_inventory','freeze_selection'):
                stack.enter_context(patch.object(module,name))
            stack.enter_context(patch.object(module,'cases',side_effect=RuntimeError('invented')))
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_PRIVATE_SELECTION','inspect'])


if __name__=='__main__':unittest.main()
