"""Private one-read callback ownership on invented memory-only transport."""
from asyncio import CancelledError
from datetime import timedelta,tzinfo
import unittest
from tests.test_private_extraction_reader import inputs,Port,NOW
from workers.private_extraction_reader import read_private_extraction,PrivateExtractionReadError
from workers.restricted_private_extraction_reader import read_restricted_private_extraction
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER
AT=NOW+timedelta(seconds=13)
def invoke(values,query,clock,restricted=False):
    return (read_restricted_private_extraction if restricted else read_private_extraction)(**values,query=query,utc_now=clock)
class PrivateReaderEntrySnapshotTests(unittest.TestCase):
    def test_invalid_initial_original_cannot_be_repaired_by_first_tick(self):
        values,raw=inputs();owner=values['previous'];good=owner.artifact_id
        object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001');calls=[];port=Port(raw)
        def clock():
            if not calls:object.__setattr__(owner,'artifact_id',good)
            calls.append(True);return AT
        with self.assertRaises(PrivateExtractionReadError):invoke(values,port,clock)
        self.assertEqual(port.calls,[])
    def test_valid_complete_pair_survives_callback_damage(self):
        values,raw=inputs();baseline=invoke(values,Port(raw),lambda:AT);calls=[]
        def clock():
            if not calls:
                object.__setattr__(values['current'],'response_raw',b'{}')
                object.__setattr__(values['previous'],'artifact_id','90000000-0000-4000-8000-000000000001')
            calls.append(True);return AT
        result=invoke(values,Port(raw),clock)
        self.assertEqual(result.report_raw,baseline.report_raw);self.assertEqual(result.reopened.full_receipt,raw)
        self.assertIsNot(result.reopened.result.current,values['current']);self.assertEqual(len(calls),3)
    def test_invalid_output_cannot_be_repaired_by_post_read_tick(self):
        values,raw=inputs();out=WorkerOutput(raw+b'\n'+COMMIT_MARKER+b'\n',b'',1);port=Port(out);calls=[]
        def clock():
            calls.append(True)
            if len(calls)==3:object.__setattr__(out,'returncode',0)
            return AT
        with self.assertRaises(PrivateExtractionReadError):invoke(values,port,clock)
        self.assertEqual(len(port.calls),1)
    def test_valid_output_survives_post_read_damage_through_restricted_route(self):
        values,raw=inputs();out=WorkerOutput(raw+b'\n'+COMMIT_MARKER+b'\n',b'',0);port=Port(out);calls=[]
        def clock():
            calls.append(True)
            if len(calls)==3:
                object.__setattr__(out,'returncode',1);object.__setattr__(out,'stdout',b'PRIVATE_CANARY')
            return AT
        result=invoke(values,port,clock,restricted=True)
        self.assertEqual(result.reopened.full_receipt,raw);self.assertEqual((len(port.calls),len(calls)),(1,3))
        self.assertIn('select tf_feed_runtime.private_result_receipt(',port.calls[0])
    def test_unknown_namespaces_refuse_before_clock_or_foreign_output_hook(self):
        values,raw=inputs();object.__setattr__(values['current'],'foreign',object());ticks=[];port=Port(raw)
        def clock():ticks.append(True);return AT
        with self.assertRaises(PrivateExtractionReadError):invoke(values,port,clock)
        self.assertEqual((ticks,port.calls),([],[]))
        values,raw=inputs();ticks=[];queries=[]
        class Foreign:
            @property
            def stdout(self):raise AssertionError('foreign getter')
        def query(sql):queries.append(sql);return Foreign()
        with self.assertRaises(PrivateExtractionReadError):invoke(values,query,clock)
        self.assertEqual((len(ticks),len(queries)),(2,1))
    def test_each_clock_result_is_normalized_once(self):
        values,raw=inputs();ticks=[]
        class Zone(tzinfo):
            calls=0
            def utcoffset(self,value):self.calls+=1;return timedelta(0)
            def dst(self,value):return timedelta(0)
        zone=Zone();instant=AT.replace(tzinfo=zone)
        def clock():ticks.append(True);return instant
        result=invoke(values,Port(raw),clock)
        self.assertEqual(result.query_count,1);self.assertEqual((len(ticks),zone.calls),(3,3))
    def test_snapshot_faults_are_fixed_and_cancellation_identity_survives(self):
        for fault in [RuntimeError('PRIVATE_CANARY'),KeyboardInterrupt(),SystemExit(9),CancelledError()]:
            values,raw=inputs()
            class Zone(tzinfo):
                def utcoffset(self,value):raise fault
                def dst(self,value):return timedelta(0)
            object.__setattr__(values['current'],'observed_at',values['current'].observed_at.replace(tzinfo=Zone()));port=Port(raw)
            with self.subTest(fault=type(fault).__name__):
                with self.assertRaises(PrivateExtractionReadError if isinstance(fault,Exception) else type(fault)) as found:
                    invoke(values,port,lambda:AT)
                if isinstance(fault,Exception):self.assertEqual(str(found.exception),'private_extraction_read_unavailable')
                else:self.assertIs(found.exception,fault)
                self.assertEqual(port.calls,[])
