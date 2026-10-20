"""Original plain-byte assertions survive caller UTC callbacks; no I/O."""
from datetime import datetime, timedelta, timezone, tzinfo
from hashlib import sha256
import unittest

from workers.document_passage_binding import (
    PlainDocumentReceipt, DocumentPassageBinding, DocumentByteSpan, DocumentSpanMap,
    DocumentPassageError, bind_document_passages,
)

AT = datetime(2026, 10, 20, tzinfo=timezone.utc)


class CallbackUtc(tzinfo):
    def __init__(self, callback, offset=timedelta(0)):
        self.callback, self.offset, self.calls = callback, offset, 0

    def utcoffset(self, value):
        self.calls += 1
        if self.calls == 1:
            self.callback()
        return self.offset

    def dst(self, value):
        return timedelta(0)


def supplied():
    raw = b'First\nSecond'
    digest = sha256(raw).hexdigest()
    document = PlainDocumentReceipt('fictional-source', 'item', 'version',
        'https://example.org/original.txt', digest, AT)
    binding = DocumentPassageBinding(document.source_key, document.item_key,
        document.source_version_id, document.source_url, digest, 'a' * 64, 'en', AT)
    mapping = DocumentSpanMap('version', digest, 'a' * 64, 'en', (DocumentByteSpan('first', 0, 5),))
    return dict(raw=raw, document=document, binding=binding, mapping=mapping,
                observed_at=AT + timedelta(seconds=1))


def clocked(values, callback):
    clock = CallbackUtc(callback)
    values['observed_at'] = values['observed_at'].replace(tzinfo=clock)
    return clock


class PlainDocumentEntrySnapshotTests(unittest.TestCase):
    def test_invalid_entry_hash_cannot_be_repaired_by_clock(self):
        values = supplied()
        for key in ('document', 'binding', 'mapping'):
            object.__setattr__(values[key], 'content_sha256', '0' * 64)
        def repair():
            for key in ('document', 'binding', 'mapping'):
                object.__setattr__(values[key], 'content_sha256', sha256(values['raw']).hexdigest())
        clocked(values, repair)
        with self.assertRaises(DocumentPassageError):
            bind_document_passages(**values)

    def test_valid_entry_survives_clock_mutation_of_original_receipt(self):
        values = supplied()
        clocked(values, lambda: object.__setattr__(values['document'], 'source_key', 'foreign'))
        result = bind_document_passages(**values)
        self.assertEqual(result.document.source_key, 'fictional-source')
        self.assertEqual(result.snapshot.source_key, 'fictional-source')
        self.assertEqual(values['document'].source_key, 'foreign')

    def test_clock_cannot_replace_selected_original_span(self):
        values = supplied()
        clocked(values, lambda: object.__setattr__(values['mapping'], 'spans',
            (DocumentByteSpan('second', 6, 12),)))
        result = bind_document_passages(**values)
        self.assertEqual([(p.locator, p.text) for p in result.snapshot.passages], [('first', 'First')])
        self.assertEqual([(s.locator, s.start, s.end) for s in result.spans], [('first', 0, 5)])

    def test_clock_cannot_relabel_supplied_language_assertions(self):
        values = supplied()
        def relabel():
            for key in ('binding', 'mapping'):
                object.__setattr__(values[key], 'language_code', 'no')
        clocked(values, relabel)
        self.assertEqual(bind_document_passages(**values).snapshot.language_code, 'en')

    def test_returned_receipt_and_spans_do_not_alias_caller_records(self):
        values = supplied()
        result = bind_document_passages(**values)
        document, span = result.document, result.spans[0]
        object.__setattr__(values['document'], 'source_key', 'changed-after-return')
        object.__setattr__(values['mapping'].spans[0], 'start', 1)
        self.assertEqual(document.source_key, 'fictional-source')
        self.assertEqual(span.start, 0)
        self.assertIsNot(document, values['document'])
        self.assertIsNot(span, values['mapping'].spans[0])

    def test_custom_utc_receipt_is_copied_to_inert_utc(self):
        values = supplied()
        clock = CallbackUtc(lambda: None)
        for key in ('document', 'binding'):
            object.__setattr__(values[key], 'retrieved_at', AT.replace(tzinfo=clock))
        result = bind_document_passages(**values)
        calls = clock.calls
        self.assertIs(result.document.retrieved_at.tzinfo, timezone.utc)
        self.assertEqual(result.document.retrieved_at.isoformat(), AT.isoformat())
        self.assertEqual(clock.calls, calls)

    def test_non_utc_clock_still_refuses_without_partial_result(self):
        values = supplied()
        values['observed_at'] = values['observed_at'].replace(tzinfo=CallbackUtc(lambda: None, timedelta(hours=1)))
        with self.assertRaises(DocumentPassageError):
            bind_document_passages(**values)
