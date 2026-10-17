"""Passive exact historical preparation report over complete admitted custody."""
from dataclasses import replace
from hashlib import sha256
import json,unittest
from datetime import timedelta
from unittest.mock import patch
from tests.test_detached_proposal_postgres import wire
from tests.test_detached_proposal_custody import fresh_extraction,LATER
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import context,encode,AT
from tests.test_feed_postgres_contract import uid
from workers.detached_proposal_custody import prepare_detached_proposal_custody,part_bytes
from workers.detached_proposal_postgres import prepare_detached_proposal_store,parse_reopened_detached_proposal
from workers.detached_proposal_report import detached_proposal_review_report,DetachedProposalReportError


def fixture():
    old=reopened();prepared=prepare_detached_proposal_custody(old,encode(context(old)),operation_id=uid(810),observed_at=AT)
    raw=encode(wire(prepare_detached_proposal_store(prepared)));fresh=fresh_extraction(old)
    return parse_reopened_detached_proposal(raw,prepared.intent,fresh,observed_at=LATER+timedelta(seconds=1))


class DetachedProposalReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.item=fixture()
    def test_report_preserves_four_exact_strings_original_context_spelling_and_full_extraction_review(self):
        raw=detached_proposal_review_report(self.item);r=json.loads(raw);parts=self.item.result.parts
        self.assertEqual(tuple(r['parts'][k].encode() for k in ('payload_json','selection_json','provenance_json','context_json')),part_bytes(parts))
        self.assertEqual(r['intent_json'].encode(),self.item.result.intent.canonical_metadata)
        self.assertEqual(r['preparation']['full_receipt_sha256'],sha256(self.item.full_receipt).hexdigest())
        self.assertEqual(r['extraction_report']['selected_passages'][0]['text'],'Changed exact invented passage.')
        self.assertEqual(r['extraction_report']['selected_passages'][0]['earlier'][0]['text'],'Original exact invented passage.')
        self.assertNotEqual(parts.context_raw,json.dumps(json.loads(parts.context_raw),sort_keys=True,separators=(',',':')).encode())
        self.assertEqual(r['review_state'],'unverified');self.assertIn('not_current_qualification_or_held_capture',r['evidence_state'])
        self.assertEqual(raw,json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
    def test_historical_times_remain_distinct_from_fresh_full_artifact_and_report_observations(self):
        r=json.loads(detached_proposal_review_report(self.item))
        self.assertEqual(r['preparation']['prepared_at'],'2026-10-15T00:00:50.000000Z')
        self.assertLess(r['preparation']['historical_artifact_observed_at'],r['preparation']['prepared_at'])
        self.assertLess(r['preparation']['stored_at'],r['extraction_report']['observed_at'])
        self.assertLess(r['extraction_report']['observed_at'],r['observed_at'])
    def test_mutated_typed_pointer_is_reconstructed_from_admitted_bytes(self):
        item=replace(self.item,stored=replace(self.item.stored,artifact_id=uid(999)),evidence_state='PRIVATE_CANARY')
        self.assertEqual(detached_proposal_review_report(item),detached_proposal_review_report(self.item))
    def test_broken_full_preparation_or_original_private_artifact_refuses_whole(self):
        for item in [None,replace(self.item,full_receipt=b'{}'),replace(self.item,full_receipt=bytearray(self.item.full_receipt)),
                replace(self.item,result=replace(self.item.result,extraction=replace(self.item.result.extraction,full_receipt=b'{}')))]:
            with self.assertRaisesRegex(DetachedProposalReportError,'^detached_proposal_report_unavailable$'):detached_proposal_review_report(item)
    def test_report_capacity_refuses_without_truncating_or_exporting_partial_private_text(self):
        raw=detached_proposal_review_report(self.item)
        with patch('workers.detached_proposal_report.MAX_DETACHED_REPORT_BYTES',len(raw)):
            self.assertEqual(detached_proposal_review_report(self.item),raw)
        with patch('workers.detached_proposal_report.MAX_DETACHED_REPORT_BYTES',len(raw)-1):
            with self.assertRaisesRegex(DetachedProposalReportError,'^detached_proposal_report_unavailable$'):detached_proposal_review_report(self.item)

if __name__=='__main__':unittest.main()
