"""New route-only composition tests; unchanged old suites are not invoked."""
from datetime import timedelta
import json,unittest
from unittest.mock import patch
from tests.test_private_extraction_reader import inputs,Port
from tests.test_private_extraction_reopen import NOW
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER
from workers import restricted_private_extraction_reader as module


class RestrictedPrivateExtractionReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values,cls.raw=inputs();cls.at=NOW+timedelta(seconds=13)
    def run_reader(self,change=None,port=None,clock=None):
        return module.read_restricted_private_extraction(**{**self.values,**(change or{})},query=port or Port(self.raw),utc_now=clock or(lambda:self.at))
    def test_complete_pair_and_full_unknown_output_use_only_fixed_restricted_route(self):
        port=Port(self.raw);result=self.run_reader(port=port)
        self.assertEqual(len(port.calls),1);self.assertEqual(result.query_count,1);self.assertEqual(result.reopened.full_receipt,self.raw)
        self.assertIn('select tf_feed_runtime.private_result_receipt(',port.calls[0]);self.assertNotIn('tf_private_extraction.',port.calls[0]);self.assertIn('repeatable read read only',port.calls[0]);self.assertNotIn('Changed exact',port.calls[0])
        report=json.loads(result.report_raw);self.assertEqual(report['review_state'],'unverified');self.assertEqual(report['context']['current_publication'],'not_connected');self.assertNotIn('Changed exact',repr(result))
    def test_both_originals_and_complete_receipts_required_before_transport(self):
        for change in [dict(previous=None),dict(current=None),dict(previous_receipt=b'{}'),dict(current_receipt=bytearray(self.values['current_receipt']))]:
            port=Port(self.raw)
            with self.assertRaises(module.RestrictedPrivateExtractionReadError):self.run_reader(change,port)
            self.assertEqual(port.calls,[])
    def test_operation_exact_type_and_full_request_ceiling_are_not_authority(self):
        hooks=[]
        class Hook(str):
            def __eq__(self,other):hooks.append(True);return True
        for change in [dict(operation_id=Hook(self.values['operation_id'])),dict(operation_id='PRIVATE_CANARY /home/private'),dict(maximum_output_tokens=True),dict(maximum_output_tokens=0)]:
            port=Port(self.raw)
            with self.assertRaises(module.RestrictedPrivateExtractionReadError):self.run_reader(change,port)
            self.assertEqual(port.calls,[])
        self.assertEqual(hooks,[])
    def test_uncommitted_or_denied_delivery_is_whole_generic_refusal_without_retry(self):
        for output in [WorkerOutput(self.raw,b'',0),WorkerOutput(b'',b'invented_private_reader_unavailable',3),WorkerOutput(self.raw+b'\n'+COMMIT_MARKER+b'\n',b'PRIVATE_BACKEND',0)]:
            port=Port(output)
            with self.assertRaisesRegex(module.RestrictedPrivateExtractionReadError,'^restricted_private_extraction_read_unavailable$'):self.run_reader(port=port)
            self.assertEqual(len(port.calls),1)
    def test_native_full_output_still_requires_unchanged_source_request_and_unverified_parser(self):
        for raw in [b'{}',self.raw.replace(b'"unverified"',b'"approved"'),self.raw.replace(b'000000000300',b'000000000399')]:
            port=Port(raw)
            with self.assertRaises(module.RestrictedPrivateExtractionReadError):self.run_reader(port=port)
            self.assertEqual(len(port.calls),1)
    def test_upstream_arbitrary_statement_or_str_hook_never_reaches_query(self):
        hooks=[]
        class Hook(str):
            def __eq__(self,other):hooks.append(True);return True
        for sql in ['select arbitrary_source_literal()',Hook(module._statement(self.values['operation_id'],restricted=False))]:
            port=Port(self.raw)
            def wrong(*args,**kw):return kw['query'](sql)
            with patch.object(module,'read_private_extraction',side_effect=wrong),self.assertRaises(module.RestrictedPrivateExtractionReadError):self.run_reader(port=port)
            self.assertEqual(port.calls,[])
        self.assertEqual(hooks,[])
    def test_original_clock_boundary_is_preserved_before_and_after_single_query(self):
        for ticks,count in [([None],0),([self.at,self.at-timedelta(microseconds=1)],0),([self.at,self.at,None],1)]:
            port=Port(self.raw);iterator=iter(ticks)
            with self.assertRaises(module.RestrictedPrivateExtractionReadError):self.run_reader(port=port,clock=lambda:next(iterator))
            self.assertEqual(len(port.calls),count)
    def test_callbacks_explicit_and_backend_details_remain_private(self):
        for query,clock in [(None,lambda:self.at),(Port(self.raw),None)]:
            with self.assertRaisesRegex(module.RestrictedPrivateExtractionReadError,'^restricted_private_extraction_read_unavailable$'):module.read_restricted_private_extraction(**self.values,query=query,utc_now=clock)
        port=Port(RuntimeError('PRIVATE_CANARY /home/private'))
        with self.assertRaisesRegex(module.RestrictedPrivateExtractionReadError,'^restricted_private_extraction_read_unavailable$'):self.run_reader(port=port)
        self.assertEqual(len(port.calls),1)
    def test_valid_cross_table_operation_alias_remains_compatible(self):
        from tests.test_private_extraction_result import fixture,prepare
        from tests.test_private_extraction_postgres import wire
        from tests.test_feed_capture_reopen import encode
        from workers.private_extraction_postgres import prepare_private_extraction_store
        values=fixture();values['operation_id']=values['current'].result_request.operation_id;raw=encode(wire(prepare_private_extraction_store(prepare(values))))
        arguments={k:values[k]for k in('current','current_receipt','previous','previous_receipt','operation_id','maximum_output_tokens')};port=Port(raw)
        result=module.read_restricted_private_extraction(**arguments,query=port,utc_now=lambda:self.at)
        self.assertEqual(result.reopened.stored.operation_id,values['current'].result_request.operation_id);self.assertEqual(len(port.calls),1)

if __name__=='__main__':unittest.main()
