"""Focused one-read control flow over real original/request/receipt parsers."""
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_private_extraction_reopen import context,NOW
from tests.test_private_extraction_result import retained
from tests.test_feed_postgres_contract import uid
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER
from workers.private_extraction_reader import read_private_extraction,PrivateExtractionReadError


def inputs():
    request,raw,_=context()
    return dict(current=request.current,current_receipt=request.current_receipt,
        previous=request.previous,previous_receipt=request.previous_receipt,
        operation_id=request.operation_id,maximum_output_tokens=request.maximum_output_tokens),raw


class Port:
    def __init__(self,raw):self.raw=raw;self.calls=[]
    def __call__(self,sql):
        self.calls.append(sql)
        if isinstance(self.raw,Exception):raise self.raw
        if type(self.raw) is WorkerOutput:return self.raw
        return WorkerOutput(self.raw+b'\n'+COMMIT_MARKER+b'\n',b'',0)


def run(values=None,port=None,clock=None):
    default,raw=inputs()
    return read_private_extraction(**(default if values is None else values),query=port or Port(raw),
        utc_now=clock or (lambda:NOW+timedelta(seconds=13)))


class PrivateExtractionReaderTests(unittest.TestCase):
    def test_complete_one_read_regenerates_request_and_returns_private_evidence_without_old_output(self):
        values,raw=inputs();port=Port(raw);result=run(values,port)
        self.assertEqual(result.query_count,1);self.assertEqual(result.reopened.full_receipt,raw)
        self.assertEqual(len(port.calls),1);self.assertIn('repeatable read read only',port.calls[0])
        self.assertIn('select tf_private_extraction.result_receipt(',port.calls[0])
        self.assertNotIn('Changed exact',port.calls[0]);self.assertNotIn('store_result',port.calls[0])
        report=json.loads(result.report_raw);self.assertEqual(report['review_state'],'unverified')
        self.assertEqual(report['selected_passages'][0]['text'],'Changed exact invented passage.')
        self.assertEqual(report['context']['current_publication'],'not_connected')
        self.assertNotIn('Changed exact',repr(result));self.assertNotIn('example.org',repr(result))

    def test_missing_bad_prior_and_either_full_receipt_refuse_before_any_query(self):
        values,raw=inputs()
        for change in [dict(previous=None),dict(previous_receipt=None),dict(previous_receipt=b'{}'),
                dict(current_receipt=b'{}'),dict(current=None),dict(current_receipt=bytearray(values['current_receipt']))]:
            port=Port(raw)
            with self.assertRaises(PrivateExtractionReadError):run({**values,**change},port)
            self.assertEqual(port.calls,[])

    def test_operation_and_token_ceiling_refuse_before_query(self):
        values,raw=inputs()
        for change in [dict(operation_id='PRIVATE_CANARY /home/private'),dict(maximum_output_tokens=True),dict(maximum_output_tokens=0),dict(maximum_output_tokens=1000001)]:
            port=Port(raw)
            with self.assertRaises(PrivateExtractionReadError):run({**values,**change},port)
            self.assertEqual(port.calls,[])

    def test_legitimate_operation_identity_in_other_table_namespace_remains_readable(self):
        from tests.test_private_extraction_result import fixture,prepare
        from tests.test_private_extraction_postgres import wire
        from tests.test_feed_capture_reopen import encode
        from workers.private_extraction_postgres import prepare_private_extraction_store
        v=fixture();v['operation_id']=v['current'].result_request.operation_id
        store=prepare_private_extraction_store(prepare(v));raw=encode(wire(store));port=Port(raw)
        values={k:v[k]for k in ('current','current_receipt','previous','previous_receipt','operation_id','maximum_output_tokens')}
        result=run(values,port)
        self.assertEqual(result.reopened.stored.operation_id,values['current'].result_request.operation_id)
        self.assertEqual(result.query_count,1);self.assertEqual(result.reopened.full_receipt,raw)

    def test_same_selected_text_does_not_read_a_stale_artifact(self):
        values,raw=inputs();current,cr=retained('Original exact invented passage.',31)
        port=Port(raw)
        with self.assertRaises(PrivateExtractionReadError):run({**values,'current':current,'current_receipt':cr},port)
        self.assertEqual(port.calls,[])

    def test_wrong_operation_and_output_receipt_are_not_accepted_as_absence_or_retried(self):
        values,raw=inputs()
        for body in [b'null',b'{}',raw.replace(b'"unverified"',b'"approved"'),raw.replace(b'000000000300',b'000000000399')]:
            port=Port(body)
            with self.assertRaises(PrivateExtractionReadError):run(values,port)
            self.assertEqual(len(port.calls),1)

    def test_exact_worker_output_and_committed_framing_required(self):
        values,raw=inputs();good=raw+b'\n'+COMMIT_MARKER+b'\n'
        for output in [WorkerOutput(raw,b'',0),WorkerOutput(good,b'PRIVATE_BACKEND',0),
                WorkerOutput(good,b'',1),WorkerOutput(good,b'',True),WorkerOutput(bytearray(good),b'',0),
                WorkerOutput(good+b'\n',b'',0),WorkerOutput(b'x'*131073,b'',0)]:
            port=Port(output)
            with self.assertRaises(PrivateExtractionReadError):run(values,port)
            self.assertEqual(len(port.calls),1)
        calls=[]
        def wrong(sql):calls.append(sql);return dict(stdout=good,stderr=b'',returncode=0)
        with self.assertRaises(PrivateExtractionReadError):run(values,wrong)
        self.assertEqual(len(calls),1)

    def test_before_and_after_clock_failures_stop_at_the_exact_dispatch_boundary(self):
        values,raw=inputs();at=NOW+timedelta(seconds=13)
        for ticks,expected_calls in [([None],0),([at.replace(tzinfo=None)],0),([NOW],0),
                ([at,at-timedelta(microseconds=1)],0),([at,at,None],1),([at,at,at-timedelta(microseconds=1)],1)]:
            port=Port(raw);iterator=iter(ticks)
            with self.assertRaises(PrivateExtractionReadError):run(values,port,lambda:next(iterator))
            self.assertEqual(len(port.calls),expected_calls)

    def test_all_callbacks_are_explicit_and_failure_does_not_echo_backend_details(self):
        values,raw=inputs()
        for query in [None,object()]:
            with self.assertRaisesRegex(PrivateExtractionReadError,'^private_extraction_read_unavailable$'):
                read_private_extraction(**values,query=query,utc_now=lambda:NOW+timedelta(seconds=13))
        port=Port(PrivateExtractionReadError('PRIVATE_CANARY /home/private'))
        with self.assertRaisesRegex(PrivateExtractionReadError,'^private_extraction_read_unavailable$'):run(values,port)
        self.assertEqual(len(port.calls),1)

    def test_monotone_observations_are_preserved_without_current_clock_or_timing_claims(self):
        values,raw=inputs();at=NOW+timedelta(seconds=13);ticks=iter([at,at+timedelta(microseconds=1),at+timedelta(microseconds=2)])
        result=run(values,Port(raw),lambda:next(ticks))
        self.assertEqual(result.reopened.observed_at,at+timedelta(microseconds=2))
        self.assertEqual(json.loads(result.report_raw)['observed_at'],'2026-10-15T00:00:33.000002Z')


class PrivateExtractionReaderScopeTests(unittest.TestCase):
    def test_extra_target_argument_refuses_before_resource_construction(self):
        from unittest.mock import patch
        from scripts import rehearse_private_extraction_reader as module
        with patch.object(module.sys,'argv',['trial','existing']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def _failure(self, *, freezing=False, stop_failure=False):
        from contextlib import ExitStack
        from unittest.mock import Mock,patch
        from scripts import rehearse_private_extraction_reader as module
        trial=Mock();trial.identity='owned';events=[]
        def stop():
            events.append('stop')
            if stop_failure:raise RuntimeError('stop')
        trial.stop.side_effect=stop;trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=lambda label:events.append(label)
        trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with ExitStack() as stack:
            stack.enter_context(patch.object(module.sys,'argv',['trial']))
            stack.enter_context(patch.object(module,'FreshFeedPostgres',return_value=trial))
            for name in ('freeze_all','freeze_change','freeze_reference','freeze_private','freeze_restore','freeze_worker'):
                stack.enter_context(patch.object(module,name,side_effect=RuntimeError('freeze') if freezing and name=='freeze_worker' else None))
            stack.enter_context(patch.object(module,'cases',side_effect=RuntimeError('invented')))
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events[:3],['stop','initializer','FINAL_PRIVATE_WORKER'])
        if freezing:trial.create.assert_not_called()
        return events

    def test_case_failure_still_stops_both_owned_resources_and_verifies_source_bytes(self):
        self.assertEqual(self._failure(),['stop','initializer','FINAL_PRIVATE_WORKER','inspect'])

    def test_freeze_failure_before_creation_and_stop_failure_still_verify_sources(self):
        self._failure(freezing=True)
        self.assertEqual(self._failure(stop_failure=True),['stop','initializer','FINAL_PRIVATE_WORKER'])


if __name__=='__main__':unittest.main()
