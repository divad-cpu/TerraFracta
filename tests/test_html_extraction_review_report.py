"""Pure invented receipts; native custody and source truth remain separate."""
import base64,json,unittest
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from unittest.mock import patch

from tests.test_html_extraction_custody import prepared,wire,encoded,cold,READ
from workers.html_extraction_review_report import html_extraction_review_report,HtmlExtractionReviewReportError


def sample():
    selected=prepared();return selected,encoded(wire(selected)),cold(selected)


def report(selected,raw,expected,**changes):
    values=dict(current_receipt=selected.result.current_receipt,previous_receipt=selected.result.previous_receipt,observed_at=READ)
    values.update(changes)
    return html_extraction_review_report(raw,expected,**values)


class HtmlExtractionReviewReportTests(unittest.TestCase):
    def test_full_receipts_project_exact_artifacts_request_and_unverified_proposal(self):
        selected,raw,expected=sample();value=json.loads(report(selected,raw,expected))
        self.assertEqual(value['kind'],'private_html_extraction_review_report')
        self.assertEqual(value['review_state'],'unverified');self.assertEqual(value['proposal']['review_state'],'unverified')
        self.assertEqual(value['artifact']['artifact_id'],expected.artifact_id)
        self.assertEqual(value['artifact']['receipt_sha256'],sha256(raw).hexdigest())
        self.assertEqual(value['artifact']['request_sha256'],selected.result.plan.request.request_sha256)
        self.assertEqual(value['artifact']['output_sha256'],sha256(selected.result.output_raw).hexdigest())
        self.assertEqual(value['artifact']['request_bytes'],len(selected.result.plan.request.body))
        self.assertEqual(value['originals']['current']['artifact_id'],expected.current_expected.artifact_id)
        self.assertEqual(value['originals']['previous']['receipt_sha256'],sha256(selected.result.previous_receipt).hexdigest())
        self.assertEqual(value['inspection']['request']['request_sha256'],value['artifact']['request_sha256'])
        self.assertEqual(value['proposal']['source_version_id'],value['inspection']['current']['source_version_id'])

    def test_adjacent_current_previous_selected_text_is_rederived_from_both_originals(self):
        selected,raw,expected=sample();value=json.loads(report(selected,raw,expected))
        locator=value['proposal']['locator']
        current=next(p for p in value['inspection']['current']['passages'] if p['locator']==locator)
        previous=next(p for p in value['inspection']['previous']['passages'] if p['locator']==locator)
        self.assertNotEqual(current['text'],previous['text']);self.assertNotEqual(current['raw_sha256'],previous['raw_sha256'])
        self.assertEqual(current['locator'],value['proposal']['locator'])
        self.assertEqual(value['inspection']['selection']['state'],'ready')

    def test_no_original_request_output_bodies_or_acceptance_are_projected(self):
        selected,raw,expected=sample();value=json.loads(report(selected,raw,expected));text=json.dumps(value)
        for key in ['raw_base64','metadata_base64','request_base64','output_base64']:
            self.assertNotIn(key,text)
        self.assertNotIn(selected.result.plan.request.body.decode(),text)
        self.assertNotIn(selected.result.output_raw.decode(),text)
        self.assertEqual(value['context']['current_publication'],'not_connected')
        self.assertEqual(value['context']['server_authentication'],'not_established')
        self.assertEqual(value['context']['publication'],'not_authorized')
        self.assertTrue(all(v is False for v in value['limits'].values()))
        self.assertFalse(value['inspection']['limits']['rendered_visibility_verified'])

    def test_corrupt_or_missing_current_or_previous_receipt_withholds_everything(self):
        selected,raw,expected=sample()
        for key in ['current_receipt','previous_receipt']:
            for body in [None,b'{}',b'PRIVATE_CANARY']:
                with self.subTest(key=key),self.assertRaises(HtmlExtractionReviewReportError):report(selected,raw,expected,**{key:body})

    def test_independent_intent_and_result_artifact_cannot_be_reselected(self):
        selected,raw,expected=sample()
        for altered in [replace(expected,artifact_id='70000000-0000-4000-8000-000000000001'),
                        replace(expected,canonical_metadata=b'{}'),replace(expected,current_expected=expected.previous_expected)]:
            with self.assertRaises(HtmlExtractionReviewReportError):report(selected,raw,altered)

    def test_self_consistent_changed_output_does_not_replace_independent_intent(self):
        selected,raw,expected=sample();body=json.loads(raw);output=selected.result.output_raw+b' '
        body['output_base64']=base64.b64encode(output).decode();body['output_bytes']=len(output);body['output_sha256']=sha256(output).hexdigest()
        with self.assertRaises(HtmlExtractionReviewReportError):report(selected,encoded(body),expected)

    def test_observation_preceding_actual_store_and_non_bytes_fail_privately(self):
        selected,raw,expected=sample()
        for operand,changes in [(raw,dict(observed_at=READ-timedelta(seconds=3))),(bytearray(raw),{}),(b'PRIVATE_CANARY /home/private',{})]:
            with self.assertRaises(HtmlExtractionReviewReportError) as error:report(selected,operand,expected,**changes)
            self.assertEqual(str(error.exception),'html_extraction_review_report_unavailable')

    def test_report_capacity_refuses_instead_of_truncating(self):
        selected,raw,expected=sample();normal=report(selected,raw,expected)
        with patch('workers.html_extraction_review_report.MAX_HTML_EXTRACTION_REVIEW_BYTES',len(normal)-1):
            with self.assertRaises(HtmlExtractionReviewReportError):report(selected,raw,expected)
        with patch('workers.html_extraction_review_report.MAX_HTML_EXTRACTION_REVIEW_BYTES',len(normal)):
            self.assertEqual(report(selected,raw,expected),normal)

    def test_canonical_deterministic_json_and_no_process_io(self):
        selected,raw,expected=sample()
        with patch('subprocess.Popen',side_effect=AssertionError('no transport')),patch('builtins.open',side_effect=AssertionError('no file')):
            first=report(selected,raw,expected);second=report(selected,raw,expected)
        self.assertEqual(first,second)
        self.assertEqual(first,json.dumps(json.loads(first),sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode())


if __name__=='__main__':unittest.main()
