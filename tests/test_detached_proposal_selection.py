"""Explicit independent intent must match catalogue and one complete new read."""
from dataclasses import replace
from datetime import timedelta
import json,unittest
from tests.test_detached_proposal_inventory import wire,AT,SERVER,END
from tests.test_detached_proposal_report import fixture
from tests.test_private_extraction_held_proposal import encode
from tests.test_feed_postgres_contract import uid
from tests.test_detached_proposal_reader import Port
from workers.detached_proposal_custody import DetachedPreparationIntent
from workers.detached_proposal_inventory import prepare_detached_proposal_inventory
from workers.detached_proposal_selection import read_selected_detached_proposal,DetachedProposalSelectionError
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER,_time

def output(raw):return WorkerOutput(raw+b'\n'+COMMIT_MARKER+b'\n',b'',0)


class DetachedProposalSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.item=fixture();cls.request=prepare_detached_proposal_inventory(cls.item.result.extraction,observed_at=AT)
        cls.catalogue=wire(cls.request,cls.item);cls.good=output(cls.item.full_receipt)
    def read(self,port,*,catalogue=None,intent=None,clock=None):
        return read_selected_detached_proposal(output(encode(self.catalogue if catalogue is None else catalogue)),self.request,
            intent=self.item.result.intent if intent is None else intent,query=port,utc_now=clock or (lambda:END))
    def test_explicit_retained_intent_matches_metadata_member_and_all_newly_read_parts(self):
        port=Port(self.good);result=self.read(port)
        self.assertEqual(len(port.calls),1);self.assertEqual(result.read.reopened.full_receipt,self.item.full_receipt)
        self.assertEqual(result.candidate.intent,self.item.result.intent);self.assertEqual(result.candidate.artifact_id,self.item.stored.artifact_id)
        self.assertIn('still_unverified',result.evidence_state);self.assertNotIn('Changed exact',repr(result))
    def test_missing_explicit_intent_unknown_member_and_different_prewrite_fingerprint_do_not_read(self):
        port=Port(self.good)
        with self.assertRaises(DetachedProposalSelectionError):read_selected_detached_proposal(output(encode(self.catalogue)),self.request,intent=None,query=port,utc_now=lambda:END)
        self.assertEqual(port.calls,[])
        for key,value in [('operation_id',uid(999)),('context_raw_sha256','f'*64)]:
            m=json.loads(self.item.result.intent.canonical_metadata);m[key]=value;port=Port(self.good)
            with self.assertRaises(DetachedProposalSelectionError):self.read(port,intent=DetachedPreparationIntent(encode(m)))
            self.assertEqual(port.calls,[])
        empty={**self.catalogue,'candidates':[]};port=Port(self.good)
        with self.assertRaises(DetachedProposalSelectionError):self.read(port,catalogue=empty)
        self.assertEqual(port.calls,[])
    def test_stale_full_artifact_observation_holds_before_selected_read(self):
        v=json.loads(encode(self.catalogue));v['candidates'][0]['stored_at']=_time(self.item.result.extraction.observed_at+timedelta(microseconds=1));port=Port(self.good)
        with self.assertRaises(DetachedProposalSelectionError):self.read(port,catalogue=v)
        self.assertEqual(port.calls,[])
    def test_stored_artifact_or_timestamp_disagreement_after_full_read_refuses_whole(self):
        for key,value in [('artifact_id',uid(999)),('stored_at',_time(self.item.stored.stored_at+timedelta(microseconds=1)))]:
            v=json.loads(encode(self.catalogue));v['candidates'][0][key]=value;port=Port(self.good)
            with self.assertRaises(DetachedProposalSelectionError):self.read(port,catalogue=v)
            self.assertEqual(len(port.calls),1)
    def test_inventory_and_full_read_worker_framing_or_backend_failure_never_retry(self):
        port=Port(self.good)
        with self.assertRaises(DetachedProposalSelectionError):read_selected_detached_proposal(WorkerOutput(encode(self.catalogue),b'',0),self.request,intent=self.item.result.intent,query=port,utc_now=lambda:END)
        self.assertEqual(port.calls,[])
        for value in (WorkerOutput(self.item.full_receipt,b'',0),RuntimeError('PRIVATE_CANARY')):
            port=Port(value)
            with self.assertRaisesRegex(DetachedProposalSelectionError,'^detached_proposal_selection_unavailable$'):self.read(port)
            self.assertEqual(len(port.calls),1)
    def test_inventory_and_reader_share_monotone_clock_with_no_default_transport(self):
        ticks=iter([END,END+timedelta(microseconds=1),END+timedelta(microseconds=2),END+timedelta(microseconds=3)])
        result=self.read(Port(self.good),clock=lambda:next(ticks));self.assertEqual(result.read.reopened.observed_at,END+timedelta(microseconds=3))
        for ticks,count in [([None],0),([END,END-timedelta(microseconds=1)],0),([END,END,END,END-timedelta(microseconds=1)],1)]:
            iterator=iter(ticks);port=Port(self.good)
            with self.assertRaises(DetachedProposalSelectionError):self.read(port,clock=lambda:next(iterator))
            self.assertEqual(len(port.calls),count)

if __name__=='__main__':unittest.main()
