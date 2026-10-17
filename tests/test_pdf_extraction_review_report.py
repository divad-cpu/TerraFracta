"""Actual invented PDF result -> selected review projection, no live source."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_extraction_request import capture, output, NOW
from tests.test_pdf_request_packet_context import reference
from workers.pdf_derivation_packet import prepare_pdf_derivation_packet
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_result_packet import PdfResultPacketExpected, prepare_pdf_result_packet
from workers.pdf_extraction_review_report import (
    PdfExtractionReviewReportError, pdf_extraction_review_report, MAX_PDF_EXTRACTION_REVIEW_BYTES,
)

PREPARED = NOW + timedelta(seconds=1)
LATER = NOW + timedelta(days=1)
OPERATION = 'a1234567-1234-4abc-8abc-123456789012'


def make_result(*, initial=False, two_selected=True):
    now = capture('Current invented selected text.', two_selected=two_selected)
    old = None if initial else capture('Earlier invented selected text.', version=1, seconds=0, two_selected=two_selected)
    current = reference(prepare_pdf_derivation_packet(now, recorded_observed_at=NOW), now, recorded=NOW)
    previous = None if old is None else reference(prepare_pdf_derivation_packet(old, recorded_observed_at=NOW), old, recorded=NOW)
    request = compile_pdf_extraction_request(now, old, observed_at=NOW, maximum_output_tokens=100)
    result = prepare_pdf_result_packet(current, previous, request=request, output_raw=output(now),
        operation_id=OPERATION, prepared_at=PREPARED)
    expected = PdfResultPacketExpected(current.expected, None if previous is None else previous.expected,
        request, result.output_sha256, result.packet_sha256, OPERATION, PREPARED)
    return result, expected


class PdfExtractionReviewReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result, cls.expected = make_result()
        cls.initial, cls.initial_expected = make_result(initial=True)

    def report(self, result=None, expected=None, at=LATER):
        return pdf_extraction_review_report(self.result.raw if result is None else result,
            self.expected if expected is None else expected, reopened_at=at)

    def test_actual_result_reopens_once_per_original_with_reaped_children_and_exact_selected_payload(self):
        import workers.pdf_text_inspection as inspector
        start = inspector.subprocess.Popen; children = []
        def launch(*args, **kwargs):
            child = start(*args, **kwargs); children.append(child); return child
        with patch.object(inspector.subprocess, 'Popen', side_effect=launch):
            raw = self.report()
        self.assertEqual(len(children), 2)
        self.assertTrue(all(p.poll() is not None and all(getattr(p, n).closed for n in ('stdin', 'stdout', 'stderr')) for p in children))
        report = json.loads(raw)
        self.assertEqual(report['review_state'], 'unverified')
        self.assertEqual(report['proposal']['review_state'], 'unverified')
        self.assertEqual(report['artifact']['packet_sha256'], self.result.packet_sha256)
        self.assertEqual(report['artifact']['output_bytes'], len(self.result.output_raw))
        self.assertEqual(report['recorded_observed_at'], '2026-10-17T11:00:00.000000Z')
        self.assertEqual(report['prepared_at'], '2026-10-17T11:00:01.000000Z')
        self.assertEqual(report['reopened_at'], '2026-10-18T11:00:00.000000Z')
        self.assertEqual([p['locator'] for p in report['current']['selected_pages']], ['section-one', 'section-two'])
        group, = report['selected_passages']
        self.assertEqual(group['locators'], ['section-one'])
        self.assertEqual(group['page_numbers'], [1])
        self.assertEqual(group['earlier'][0]['page_number'], 1)
        self.assertEqual(group['earlier'][0]['text'], 'Earlier invented selected text.')
        self.assertEqual(sha256(group['text'].encode()).hexdigest(), group['text_sha256'])
        for absent in (b'PRIVATE_UNSELECTED', b'PRIVATE_PDF_METADATA_CANARY', b'Shared unchanged text.',
                       b'%PDF-', b'"output_base64"', b'"request_base64"', b'"instructions"'):
            self.assertNotIn(absent, raw)
        self.assertEqual(report['context']['storage'], 'not_observed')
        self.assertEqual(report['context']['publication'], 'not_authorized')
        self.assertLessEqual(len(raw), MAX_PDF_EXTRACTION_REVIEW_BYTES)

    def test_explicit_initial_observation_retains_null_prior_and_both_changed_selected_pages(self):
        report = json.loads(self.report(self.initial.raw, self.initial_expected))
        self.assertIsNone(report['previous'])
        self.assertEqual(len(report['selected_passages']), 2)
        self.assertTrue(all(g['earlier'] == [None] for g in report['selected_passages']))
        self.assertEqual(report['selected_passages'][1]['page_numbers'], [2])

    def test_mutated_packet_or_independent_expectation_refuses_without_partial_private_report(self):
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No original work')) as inspect:
            for raw, expected in ((b'PRIVATE_PACKET', self.expected),
                (self.result.raw, replace(self.expected, output_sha256='f' * 64)),
                (self.result.raw, replace(self.expected, operation_id='PRIVATE_OP')),
                (self.result.raw, replace(self.expected, previous=None))):
                with self.assertRaisesRegex(PdfExtractionReviewReportError, '^pdf_extraction_review_report_unavailable$'):
                    self.report(raw, expected)
            inspect.assert_not_called()

    def test_caller_cannot_pass_a_prebuilt_reopened_context_or_proposal(self):
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No original work')) as inspect:
            for raw in (self.result, self.result.context, self.result.proposal, {}, bytearray(self.result.raw)):
                with self.assertRaises(PdfExtractionReviewReportError): self.report(raw)
            inspect.assert_not_called()

    def test_report_limit_refuses_complete_projection_without_truncation(self):
        with patch('workers.pdf_extraction_review_report.MAX_PDF_EXTRACTION_REVIEW_BYTES', 100):
            with self.assertRaisesRegex(PdfExtractionReviewReportError, '^pdf_extraction_review_report_unavailable$'):
                self.report()

    def test_report_uses_cold_reparsed_proposal_not_mutable_preparation_result(self):
        # Repr-hidden in-memory preparation fields are not a reopening input.
        original = self.result.proposal.proposed_assertion
        try:
            object.__setattr__(self.result.proposal, 'proposed_assertion', 'PRIVATE_FORGED_PROPOSAL')
            report = json.loads(self.report())
            self.assertEqual(report['proposal']['proposed_assertion'], original)
            self.assertNotIn('PRIVATE_FORGED_PROPOSAL', json.dumps(report))
        finally:
            object.__setattr__(self.result.proposal, 'proposed_assertion', original)


if __name__ == '__main__': unittest.main()
