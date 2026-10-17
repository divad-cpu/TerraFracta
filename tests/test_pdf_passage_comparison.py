"""Actual invented PDF vintages, with source and selected text kept separate."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.helpers.pdf_fixture import pdf_bytes
from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import PdfPassageBinding, PdfPageSelection, PdfPageSelectionMap
from workers.pdf_passage_comparison import PdfPassageCapture, compare_pdf_passages, PdfComparisonError

NOW = datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc)
RECIPE = 'a' * 64


def capture(texts=('Selected original.', 'Other original.'), *, version=1, age=1, selections=None, raw=None):
    raw = pdf_bytes(texts) if raw is None else raw
    digest = sha256(raw).hexdigest()
    document = PdfDocumentReceipt('invented-pdf', 'one-item',
        f'12345678-1234-4abc-8abc-{version:012d}', 'https://example.invalid/invented.pdf',
        digest, NOW - timedelta(seconds=age))
    binding = PdfPassageBinding(document.source_key, document.item_key, document.source_version_id,
        document.source_url, digest, RECIPE, 'en', document.retrieved_at)
    if selections is None:
        selections = (PdfPageSelection('selected-page', 1, sha256(texts[0].encode()).hexdigest()),)
    mapping = PdfPageSelectionMap(document.source_version_id, digest, RECIPE, 'en', selections)
    return PdfPassageCapture(raw, document, binding, mapping)


class PdfPassageComparisonTests(unittest.TestCase):
    def test_first_observation_rebinds_actual_original_and_selects_only_explicit_page(self):
        result = compare_pdf_passages(capture(), observed_at=NOW)
        self.assertIsNone(result.previous)
        self.assertIsNone(result.source_bytes_changed)
        self.assertEqual(result.selection.state, 'ready')
        body = json.loads(result.selection.payload)
        self.assertEqual([p['text'] for p in body['passages']], ['Selected original.'])
        self.assertNotIn('Other original.', result.selection.payload.decode())
        self.assertEqual(body['content_sha256'], result.current.document.content_sha256)
        self.assertEqual(result.current.spans[0].derived_start_utf8, 0)
        self.assertEqual(result.current.spans[0].derived_end_utf8, len('Selected original.'))

    def test_complete_identical_vintage_needs_no_model_work(self):
        original = capture()
        result = compare_pdf_passages(original, original, observed_at=NOW)
        self.assertFalse(result.source_bytes_changed)
        self.assertEqual(result.selection.state, 'no_model_work')
        self.assertEqual(result.selection.reason_code, 'passages_unchanged')
        self.assertIsNone(result.selection.payload)

    def test_changed_unselected_page_preserves_original_hash_change_without_repeated_payload(self):
        before = capture(age=2)
        now = capture(('Selected original.', 'Other changed.'), version=2)
        result = compare_pdf_passages(now, before, observed_at=NOW)
        self.assertTrue(result.source_bytes_changed)
        self.assertNotEqual(result.current.document.content_sha256, result.previous.document.content_sha256)
        self.assertEqual(result.selection.state, 'no_model_work')
        self.assertEqual(result.selection.reason_code, 'source_changed_passages_unchanged')
        self.assertIsNone(result.selection.payload)

    def test_changed_selected_page_keeps_both_full_receipts_and_only_new_derived_text(self):
        result = compare_pdf_passages(capture(('Selected changed.', 'Other original.'), version=2),
                                      capture(age=2), observed_at=NOW)
        self.assertEqual(result.selection.state, 'ready')
        payload = result.selection.payload.decode()
        self.assertIn('Selected changed.', payload)
        self.assertNotIn('Selected original.', payload)
        self.assertEqual(result.change.current, result.current.snapshot)
        self.assertEqual(result.change.previous, result.previous.snapshot)
        self.assertNotEqual(result.current.inspection_report_sha256, result.previous.inspection_report_sha256)

    def test_physical_page_relocation_or_new_locator_under_same_recipe_is_refused(self):
        before = capture(age=2)
        for selection in (PdfPageSelection('selected-page', 2, sha256(b'Other original.').hexdigest()),
                          PdfPageSelection('renamed-page', 1, sha256(b'Selected original.').hexdigest())):
            with self.subTest(selection=selection):
                now = capture(version=2, selections=(selection,))
                with self.assertRaisesRegex(PdfComparisonError, '^pdf_comparison_unavailable$'):
                    compare_pdf_passages(now, before, observed_at=NOW)

    def test_invalid_previous_is_not_retried_as_first_observation(self):
        now = capture(version=2)
        before = capture(age=2)
        wrong = replace(before, binding=replace(before.binding, content_sha256='f' * 64))
        with self.assertRaisesRegex(PdfComparisonError, '^pdf_comparison_unavailable$'):
            compare_pdf_passages(now, wrong, observed_at=NOW)
        with patch('workers.pdf_passage_comparison.bind_pdf_passages') as bind:
            for previous in ({}, now.document, object()):
                with self.assertRaises(PdfComparisonError):
                    compare_pdf_passages(now, previous, observed_at=NOW)
            bind.assert_not_called()

    def test_url_identity_and_retrieval_order_changes_remain_unavailable(self):
        before = capture(age=2)
        now = capture(version=2)
        redirected = replace(now, document=replace(now.document, source_url='https://example.invalid/other.pdf'),
            binding=replace(now.binding, source_url='https://example.invalid/other.pdf'))
        older = replace(now, document=replace(now.document, retrieved_at=NOW - timedelta(seconds=3)),
            binding=replace(now.binding, retrieved_at=NOW - timedelta(seconds=3)))
        for current in (redirected, older):
            with self.subTest(current=current.document.source_version_id):
                with self.assertRaises(PdfComparisonError):
                    compare_pdf_passages(current, before, observed_at=NOW)

    def test_recipe_language_and_version_conflicts_do_not_widen_existing_selection_gates(self):
        before = capture(age=2)
        now = capture(('Selected changed.', 'Other original.'), version=2)
        wrong_recipe = replace(now, binding=replace(now.binding, mapping_sha256='b' * 64),
            mapping=replace(now.mapping, mapping_sha256='b' * 64))
        wrong_language = replace(now, binding=replace(now.binding, language_code='no'),
            mapping=replace(now.mapping, language_code='no'))
        reused_version = replace(now, document=replace(now.document, source_version_id=before.document.source_version_id),
            binding=replace(now.binding, source_version_id=before.document.source_version_id),
            mapping=replace(now.mapping, source_version_id=before.document.source_version_id))
        for current in (wrong_recipe, wrong_language, reused_version):
            with self.subTest(current=current.document.source_version_id):
                with self.assertRaises(PdfComparisonError):
                    compare_pdf_passages(current, before, observed_at=NOW)

    def test_empty_explicit_selection_is_held_and_never_defaults_to_all_pages(self):
        result = compare_pdf_passages(capture(selections=()), observed_at=NOW)
        self.assertEqual(result.current.snapshot.passages, ())
        self.assertEqual(result.selection.state, 'held')
        self.assertEqual(result.selection.reason_code, 'no_passages_supplied')
        self.assertIsNone(result.selection.payload)

    def test_whole_parse_hold_in_either_vintage_refuses_without_partial_change(self):
        valid = capture()
        invalid = capture(raw=b'%PDF-invalid')
        for current, previous in ((invalid, None), (valid, invalid)):
            with self.subTest(previous=previous is not None):
                with self.assertRaisesRegex(PdfComparisonError, '^pdf_comparison_unavailable$'):
                    compare_pdf_passages(current, previous, observed_at=NOW)

    def test_previous_nested_selection_is_captured_before_current_worker_callback(self):
        from workers.pdf_text_inspection import inspect_pdf_bytes as real_inspect
        before = capture(age=2, selections=(PdfPageSelection('selected-page', 2,
            sha256(b'Other original.').hexdigest()),))
        now = capture(version=2)
        calls = []
        def inspector(*args, **kwargs):
            calls.append(True)
            if len(calls) == 1:
                object.__setattr__(before.mapping, 'selections', now.mapping.selections)
            return real_inspect(*args, **kwargs)
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=inspector):
            with self.assertRaisesRegex(PdfComparisonError, '^pdf_comparison_unavailable$'):
                compare_pdf_passages(now, before, observed_at=NOW)
        self.assertEqual(len(calls), 2)

    def test_error_does_not_echo_source_text_parser_details_or_address(self):
        private = capture(texts=('PRIVATE_TEXT_CANARY', None), raw=b'PRIVATE_RAW_CANARY')
        try:
            compare_pdf_passages(private, observed_at=NOW)
        except PdfComparisonError as error:
            self.assertEqual(str(error), 'pdf_comparison_unavailable')
            self.assertIsNone(error.__cause__)
        else:
            self.fail('Invalid private original must refuse')
