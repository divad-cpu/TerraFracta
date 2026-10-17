"""One-read orchestration uses real complete original/private/preparation bytes."""
import json,unittest
from dataclasses import replace
from datetime import timedelta
from tests.test_detached_proposal_postgres import wire
from tests.test_detached_proposal_custody import fresh_extraction,LATER
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import encode,context,AT
from tests.test_feed_postgres_contract import uid
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER
from workers.detached_proposal_custody import prepare_detached_proposal_custody,DetachedPreparationIntent
from workers.detached_proposal_postgres import prepare_detached_proposal_store
from workers.detached_proposal_reader import read_detached_proposal,DetachedProposalReadError


class Port:
    def __init__(self,value):self.value=value;self.calls=[]
    def __call__(self,sql):
        self.calls.append(sql)
        if isinstance(self.value,Exception):raise self.value
        return self.value


class DetachedProposalReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        old=reopened();prepared=prepare_detached_proposal_custody(old,encode(context(old)),operation_id=uid(810),observed_at=AT)
        cls.intent=prepared.intent;cls.raw=encode(wire(prepare_detached_proposal_store(prepared)));cls.fresh=fresh_extraction(old)
        cls.good=WorkerOutput(cls.raw+b'\n'+COMMIT_MARKER+b'\n',b'',0);cls.at=LATER+timedelta(seconds=1)
    def run_read(self,port,*,extraction=None,intent=None,clock=None):
        return read_detached_proposal(self.fresh if extraction is None else extraction,self.intent if intent is None else intent,query=port,utc_now=clock or (lambda:self.at))
    def test_one_fixed_read_reopens_four_parts_without_old_context_or_parts(self):
        port=Port(self.good);result=self.run_read(port)
        self.assertEqual(result.query_count,1);self.assertEqual(result.reopened.full_receipt,self.raw)
        self.assertEqual(result.reopened.result.prepared_at,AT);self.assertEqual(result.reopened.result.extraction.observed_at,LATER)
        self.assertEqual(len(port.calls),1);self.assertIn('repeatable read read only',port.calls[0]);self.assertIn('tf_detached_proposal.preparation_receipt(',port.calls[0])
        self.assertNotIn('store_preparation',port.calls[0]);self.assertNotIn('Changed exact',port.calls[0]);self.assertNotIn('Changed exact',repr(result))
        self.assertIn('not_current_qualification_or_held_capture',result.evidence_state)
    def test_artifact_intent_identity_mismatch_and_invalid_originals_hold_before_query(self):
        for key,value in [('extraction_operation_id',uid(999)),('extraction_artifact_id',uid(999)),('extraction_request_sha256','f'*64),('extraction_output_sha256','f'*64)]:
            metadata=json.loads(self.intent.canonical_metadata);metadata[key]=value;port=Port(self.good)
            with self.assertRaises(DetachedProposalReadError):self.run_read(port,intent=DetachedPreparationIntent(encode(metadata)))
            self.assertEqual(port.calls,[])
        for extraction in [replace(self.fresh,full_receipt=b'{}'),replace(self.fresh,full_receipt=bytearray(self.fresh.full_receipt)),replace(self.fresh,request=None)]:
            port=Port(self.good)
            with self.assertRaises(DetachedProposalReadError):self.run_read(port,extraction=extraction)
            self.assertEqual(port.calls,[])
    def test_intent_primitive_closed_types_and_original_timestamp_hold_before_dispatch(self):
        for raw in [bytearray(self.intent.canonical_metadata),b'{}',b' '*4097]:
            port=Port(self.good)
            with self.assertRaises(DetachedProposalReadError):self.run_read(port,intent=DetachedPreparationIntent(raw))
            self.assertEqual(port.calls,[])
        meta=json.loads(self.intent.canonical_metadata);meta['prepared_at']='2027-01-01T00:00:00.000000Z';port=Port(self.good)
        with self.assertRaises(DetachedProposalReadError):self.run_read(port,intent=DetachedPreparationIntent(encode(meta)))
        self.assertEqual(port.calls,[])
    def test_missing_marker_uncommitted_malformed_and_private_backend_errors_return_no_partial_result_or_retry(self):
        for value in [WorkerOutput(self.raw,b'',0),WorkerOutput(self.good.stdout,b'PRIVATE_CANARY',0),WorkerOutput(self.good.stdout,b'',1),
                WorkerOutput(self.good.stdout,b'',True),WorkerOutput(bytearray(self.good.stdout),b'',0),WorkerOutput(self.good.stdout+b'\n',b'',0),
                WorkerOutput(b'x'*131073,b'',0),dict(stdout=self.good.stdout,stderr=b'',returncode=0),RuntimeError('PRIVATE_CANARY'),
                WorkerOutput(b'null\n'+COMMIT_MARKER+b'\n',b'',0)]:
            port=Port(value)
            with self.assertRaisesRegex(DetachedProposalReadError,'^detached_proposal_read_unavailable$'):self.run_read(port)
            self.assertEqual(len(port.calls),1)
    def test_every_four_part_mutation_and_foreign_receipt_refuses_whole_after_one_read(self):
        for key in ('payload_base64','selection_base64','provenance_base64','context_base64','operation_id'):
            v=json.loads(self.raw);v[key]=uid(999) if key=='operation_id' else 'e30=';port=Port(WorkerOutput(encode(v)+b'\n'+COMMIT_MARKER+b'\n',b'',0))
            with self.assertRaises(DetachedProposalReadError):self.run_read(port)
            self.assertEqual(len(port.calls),1)
    def test_clock_errors_before_and_after_dispatch_have_precise_query_counts(self):
        at=self.at
        for ticks,count in [([None],0),([at.replace(tzinfo=None)],0),([LATER-timedelta(microseconds=1)],0),
                ([at,at-timedelta(microseconds=1)],0),([at,at,None],1),([at,at,at-timedelta(microseconds=1)],1)]:
            clock=iter(ticks);port=Port(self.good)
            with self.assertRaises(DetachedProposalReadError):self.run_read(port,clock=lambda:next(clock))
            self.assertEqual(len(port.calls),count)
    def test_distinct_monotone_observations_are_preserved(self):
        ticks=iter([self.at,self.at+timedelta(microseconds=1),self.at+timedelta(microseconds=2)])
        result=self.run_read(Port(self.good),clock=lambda:next(ticks))
        self.assertEqual(result.reopened.observed_at,self.at+timedelta(microseconds=2));self.assertEqual(result.reopened.result.prepared_at,AT)
    def test_preparation_newer_than_fresh_artifact_holds_before_dispatch_even_with_later_wall_clock(self):
        from workers.feed_postgres_contract import _time
        metadata=json.loads(self.intent.canonical_metadata)
        metadata['prepared_at']=_time(LATER+timedelta(microseconds=1));port=Port(self.good)
        with self.assertRaisesRegex(DetachedProposalReadError,'^detached_proposal_read_unavailable$'):
            self.run_read(port,intent=DetachedPreparationIntent(encode(metadata)))
        self.assertEqual(port.calls,[])

    def test_callbacks_and_exact_object_types_are_required_before_any_dispatch(self):
        for extraction,intent,query,clock in [(None,self.intent,Port(self.good),lambda:self.at),(self.fresh,None,Port(self.good),lambda:self.at),
                (self.fresh,self.intent,None,lambda:self.at),(self.fresh,self.intent,Port(self.good),None)]:
            with self.assertRaises(DetachedProposalReadError):read_detached_proposal(extraction,intent,query=query,utc_now=clock)
            if type(query) is Port:self.assertEqual(query.calls,[])

if __name__=='__main__':unittest.main()
