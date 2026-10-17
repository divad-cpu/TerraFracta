"""Choice projection contains metadata, never full source/context/candidate text."""
from dataclasses import replace
import json,unittest
from unittest.mock import patch
from tests.test_detached_proposal_report import fixture
from tests.test_detached_proposal_inventory import wire,AT,END
from tests.test_private_extraction_held_proposal import encode
from workers.detached_proposal_inventory import prepare_detached_proposal_inventory
from workers.detached_proposal_choices_report import detached_proposal_choices_report,DetachedProposalChoicesReportError


class DetachedProposalChoicesReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.item=fixture();cls.expected=prepare_detached_proposal_inventory(cls.item.result.extraction,observed_at=AT)
        cls.raw=encode(wire(cls.expected,cls.item,count=2))
    def report(self,raw=None,expected=None):return detached_proposal_choices_report(self.raw if raw is None else raw,self.expected if expected is None else expected,observed_at=END)
    def test_two_historical_choices_preserve_exact_metadata_and_scope_without_private_text(self):
        raw=self.report();r=json.loads(raw);self.assertEqual(len(r['candidates']),2);self.assertEqual(r['review_state'],'historical_metadata_only')
        self.assertEqual(r['lookup_scope_json'].encode(),self.expected.canonical_scope)
        self.assertEqual(r['candidates'][0]['metadata_intent_json'].encode(),self.item.result.intent.canonical_metadata)
        self.assertNotIn(b'Changed exact',raw);self.assertNotIn(b'Original exact',raw);self.assertNotIn(b'proposed_assertion',raw);self.assertNotIn(b'publisher',raw)
        self.assertEqual(raw,json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
    def test_empty_and_fifty_choices_are_bounded_and_never_choose_automatically(self):
        for count in (0,50):
            value=json.loads(self.report(encode(wire(self.expected,self.item,count=count))))
            self.assertEqual(len(value['candidates']),count);self.assertNotIn('selected',value)
        with self.assertRaises(DetachedProposalChoicesReportError):self.report(encode(wire(self.expected,self.item,count=51)))
    def test_broken_inventory_or_full_artifact_refuses_without_partial_private_projection(self):
        for raw,expected in [(b'{}',self.expected),(bytearray(self.raw),self.expected),
                (self.raw,replace(self.expected,extraction=replace(self.expected.extraction,full_receipt=b'{}')))]:
            with self.assertRaisesRegex(DetachedProposalChoicesReportError,'^detached_proposal_choices_unavailable$'):self.report(raw,expected)
    def test_exact_capacity_and_one_byte_lower_refusal_preserve_whole_projection(self):
        raw=self.report()
        with patch('workers.detached_proposal_choices_report.MAX_CHOICES_REPORT_BYTES',len(raw)):self.assertEqual(self.report(),raw)
        with patch('workers.detached_proposal_choices_report.MAX_CHOICES_REPORT_BYTES',len(raw)-1):
            with self.assertRaises(DetachedProposalChoicesReportError):self.report()

if __name__=='__main__':unittest.main()
