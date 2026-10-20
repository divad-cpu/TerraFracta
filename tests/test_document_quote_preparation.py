"""Exact in-memory quote preparation; invented originals, no I/O or qualification."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import unittest

from workers.document_quote_preparation import (
    DocumentQuotePreparationError, locate_document_quote, choose_document_quote_span,
)
from workers.document_passage_binding import (
    DocumentByteSpan, PlainDocumentReceipt, DocumentPassageBinding, DocumentSpanMap,
    DocumentPassageError, bind_document_passages,
)


def bound_inputs(raw, spans):
    at = datetime(2026, 10, 20, tzinfo=timezone.utc)
    digest = sha256(raw).hexdigest()
    receipt = PlainDocumentReceipt('fictional-source', 'item', 'original',
                                  'https://example.org/original.txt', digest, at)
    binding = DocumentPassageBinding(receipt.source_key, receipt.item_key,
        receipt.source_version_id, receipt.source_url, digest, 'a' * 64, 'nb', at)
    mapping = DocumentSpanMap('original', digest, 'a' * 64, 'nb', tuple(spans))
    return dict(raw=raw, document=receipt, binding=binding, mapping=mapping,
                observed_at=at + timedelta(seconds=1))


class DocumentQuotePreparationTests(unittest.TestCase):
    def test_all_duplicate_unicode_occurrences_keep_original_byte_positions(self):
        raw = 'Å\r\nx Å'.encode('utf8')
        self.assertEqual(locate_document_quote(raw, 'Å'.encode(), locator='section:one'),
            (DocumentByteSpan('section:one', 0, 2), DocumentByteSpan('section:one', 6, 8)))

    def test_bom_crlf_and_boundary_whitespace_are_not_removed(self):
        raw = b'\xef\xbb\xbf  A\r\nB  '
        self.assertEqual(locate_document_quote(raw, b'  A\r\nB  ', locator='one'),
                         (DocumentByteSpan('one', 3, 11),))
        self.assertEqual(locate_document_quote(raw, b'A\nB', locator='one'), ())
        self.assertEqual(locate_document_quote(raw, b'\xef\xbb\xbf', locator='one'),
                         (DocumentByteSpan('one', 0, 3),))

    def test_overlapping_occurrences_are_candidates_not_silently_dropped(self):
        self.assertEqual(locate_document_quote(b'aaa', b'aa', locator='one'),
            (DocumentByteSpan('one', 0, 2), DocumentByteSpan('one', 1, 3)))

    def test_valid_zero_matches_are_explicit_empty_tuple(self):
        self.assertEqual(locate_document_quote(b'Original', b'absent', locator='one'), ())
        self.assertEqual(locate_document_quote(b'x', b'longer quote', locator='one'), ())

    def test_no_casefold_or_unicode_normalization(self):
        self.assertEqual(locate_document_quote('é'.encode(), 'e\u0301'.encode(), locator='one'), ())
        self.assertEqual(locate_document_quote(b'Original', b'original', locator='one'), ())

    def test_complete_original_and_quote_require_strict_utf8(self):
        for raw, quote in [(b'match\xff', b'match'), (b'original\xff', b'absent'),
                           (b'original', b'\xff'), (b'\xc3', b'x')]:
            with self.subTest(raw=raw), self.assertRaises(DocumentQuotePreparationError):
                locate_document_quote(raw, quote, locator='one')

    def test_exact_builtin_bytes_only_no_subclass_or_foreign_callback(self):
        class SubBytes(bytes):
            def decode(self, *args, **kwargs):
                raise AssertionError('Subclass decoder must not run')
            def find(self, *args, **kwargs):
                raise AssertionError('Subclass matcher must not run')
        for raw, quote in [('raw', b'r'), (b'raw', 'r'), (bytearray(b'raw'), b'r'),
                           (b'raw', memoryview(b'r')), (SubBytes(b'raw'), b'r'),
                           (b'raw', SubBytes(b'r')), (None, b'r'), (b'raw', None)]:
            with self.subTest(raw_type=type(raw)), self.assertRaises(DocumentQuotePreparationError):
                locate_document_quote(raw, quote, locator='one')

    def test_empty_or_whitespace_only_quotes_refuse_but_exact_whitespace_context_survives(self):
        for raw, quote in [(b'', b'a'), (b'raw', b''), (b'  ', b' '),
                           ('\u0085'.encode(), '\u0085'.encode()), (b'\t\r\n', b'\r\n')]:
            with self.subTest(quote=quote), self.assertRaises(DocumentQuotePreparationError):
                locate_document_quote(raw, quote, locator='one')
        self.assertEqual(locate_document_quote(b' A ', b' A ', locator='one'),
                         (DocumentByteSpan('one', 0, 3),))

    def test_locator_uses_existing_exact_plain_contract(self):
        for locator in ['', ' spaced', 'spaced ', 'one\n', 'x' * 201, '\ud800', None, True]:
            with self.subTest(locator=repr(locator)), self.assertRaises(DocumentQuotePreparationError):
                locate_document_quote(b'raw', b'raw', locator=locator)
        self.assertEqual(locate_document_quote(b'raw', b'raw', locator='界' * 200)[0].locator, '界' * 200)

    def test_document_and_quote_exact_byte_limits(self):
        quote = b'a' + b'z' * 8191
        raw = b'p' * (65536 - len(quote)) + quote
        self.assertEqual(locate_document_quote(raw, quote, locator='one'),
                         (DocumentByteSpan('one', 57344, 65536),))
        for source, selected in [(raw + b'x', quote), (b'x' * 8193, b'x' * 8193)]:
            with self.subTest(length=len(source)), self.assertRaises(DocumentQuotePreparationError):
                locate_document_quote(source, selected, locator='one')

    def test_candidate_cap_is_all_or_nothing_even_when_choosing_first(self):
        self.assertEqual(len(locate_document_quote(b'q' * 128, b'q', locator='one')), 128)
        with self.assertRaises(DocumentQuotePreparationError):
            locate_document_quote(b'q' * 129, b'q', locator='one')
        with self.assertRaises(DocumentQuotePreparationError):
            choose_document_quote_span(b'q' * 129, b'q', locator='one', occurrence_number=1)

    def test_occurrence_choice_is_required_exact_one_based_and_bounded(self):
        for number in [True, False, 0, -1, 3, 1.0, '1', None]:
            with self.subTest(number=number), self.assertRaises(DocumentQuotePreparationError):
                choose_document_quote_span(b'a a', b'a', locator='one', occurrence_number=number)
        with self.assertRaises(TypeError):
            choose_document_quote_span(b'a a', b'a', locator='one')
        with self.assertRaises(DocumentQuotePreparationError):
            choose_document_quote_span(b'a', b'b', locator='one', occurrence_number=1)

    def test_explicit_second_quote_composes_with_actual_binder(self):
        raw = 'Å\r\nx Å'.encode()
        selected = choose_document_quote_span(raw, 'Å'.encode(), locator='chosen', occurrence_number=2)
        self.assertIs(type(selected), DocumentByteSpan)
        self.assertEqual(selected, DocumentByteSpan('chosen', 6, 8))
        result = bind_document_passages(**bound_inputs(raw, [selected]))
        self.assertEqual(result.snapshot.passages[0].text, 'Å')
        self.assertEqual(result.spans, (selected,))
        self.assertEqual(result.evidence_state, 'offline_original_document_bytes_bound_only')

    def test_selection_does_not_bypass_independent_source_or_mapping_binding(self):
        raw = b'Original'
        selected = choose_document_quote_span(raw, b'Original', locator='one', occurrence_number=1)
        for field, value in [('document', {'content_sha256': '0' * 64}),
                             ('mapping', {'mapping_sha256': 'b' * 64}),
                             ('binding', {'source_key': 'foreign'})]:
            values = bound_inputs(raw, [selected]); values[field] = replace(values[field], **value)
            with self.subTest(field=field), self.assertRaises(DocumentPassageError):
                bind_document_passages(**values)

    def test_overlapping_choices_still_refuse_at_final_map_gate(self):
        spans = locate_document_quote(b'aaa', b'aa', locator='one')
        with self.assertRaises(DocumentPassageError):
            bind_document_passages(**bound_inputs(b'aaa', [spans[0], replace(spans[1], locator='two')]))

    def test_refusal_does_not_echo_quote_locator_or_source_content(self):
        with self.assertRaises(DocumentQuotePreparationError) as caught:
            locate_document_quote(b'FICTIONAL_PRIVATE_CANARY\xff', b'FICTIONAL_PRIVATE_CANARY',
                                  locator='FICTIONAL_LOCATOR')
        self.assertEqual(str(caught.exception), 'document_quote_preparation_invalid')


if __name__ == '__main__':
    unittest.main()
