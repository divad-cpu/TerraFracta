"""Freeze both supplied vintages before any UTC callback; pure comparisons."""
from datetime import timedelta
from hashlib import sha256
import unittest

from tests.test_plain_document_entry_snapshot import CallbackUtc
from tests.test_document_passage_comparison import capture as plain_capture, AT as PLAIN_AT
from tests.test_html_passage_comparison import capture as html_capture, AT as HTML_AT
from workers.document_passage_comparison import compare_document_passages, DocumentComparisonError
from workers.html_passage_comparison import compare_html_passages, HtmlComparisonError

PROFILES = [('plain', plain_capture, compare_document_passages, DocumentComparisonError, PLAIN_AT),
            ('html', html_capture, compare_html_passages, HtmlComparisonError, HTML_AT)]


class DocumentComparisonEntrySnapshotTests(unittest.TestCase):
    def test_invalid_previous_entry_cannot_be_repaired_during_current_binding(self):
        for name, capture, compare, error, at in PROFILES:
            with self.subTest(profile=name):
                current, previous = capture('New', 'new', 1), capture('Old', 'old', 0)
                for part in (previous.document, previous.binding, previous.mapping):
                    object.__setattr__(part, 'content_sha256', '0' * 64)
                def repair():
                    for part in (previous.document, previous.binding, previous.mapping):
                        object.__setattr__(part, 'content_sha256', sha256(previous.raw).hexdigest())
                observed = (at + timedelta(seconds=10)).replace(tzinfo=CallbackUtc(repair))
                with self.assertRaises(error):
                    compare(current, previous, observed_at=observed)

    def test_valid_previous_entry_survives_later_callback_mutation(self):
        for name, capture, compare, _, at in PROFILES:
            with self.subTest(profile=name):
                current, previous = capture('New', 'new', 1), capture('Old', 'old', 0)
                observed = (at + timedelta(seconds=10)).replace(tzinfo=CallbackUtc(
                    lambda: object.__setattr__(previous.document, 'source_key', 'foreign')))
                result = compare(current, previous, observed_at=observed)
                self.assertEqual(result.previous.snapshot.passages[0].text, 'Old')
                self.assertEqual(result.previous.document.source_key, result.current.document.source_key)

    def test_prior_original_cannot_be_substituted_during_current_binding(self):
        for name, capture, compare, _, at in PROFILES:
            with self.subTest(profile=name):
                current, previous = capture('New', 'new', 1), capture('Old', 'old', 0)
                replacement = capture('Substituted', 'old', 0)
                def substitute():
                    for field in ('raw', 'document', 'binding', 'mapping'):
                        object.__setattr__(previous, field, getattr(replacement, field))
                observed = (at + timedelta(seconds=10)).replace(tzinfo=CallbackUtc(substitute))
                result = compare(current, previous, observed_at=observed)
                self.assertEqual(result.previous.snapshot.passages[0].text, 'Old')
                self.assertEqual(result.previous.document.content_sha256,
                                 sha256(capture('Old', 'old', 0).raw).hexdigest())

    def test_changed_flag_uses_original_captured_bytes_after_callback(self):
        for name, capture, compare, _, at in PROFILES:
            with self.subTest(profile=name):
                current, previous = capture('New', 'new', 1), capture('Old', 'old', 0)
                observed = (at + timedelta(seconds=10)).replace(tzinfo=CallbackUtc(
                    lambda: object.__setattr__(current, 'raw', previous.raw)))
                result = compare(current, previous, observed_at=observed)
                self.assertIs(result.source_bytes_changed, True)
                self.assertEqual(result.current.snapshot.passages[0].text, 'New')
                self.assertEqual(result.previous.snapshot.passages[0].text, 'Old')


class DocumentSnapshotFaultTests(unittest.TestCase):
    def ports(self):
        from tests.test_plain_document_entry_snapshot import supplied
        from workers.document_passage_binding import bind_document_passages, DocumentPassageError
        values = supplied()
        yield ('plain_binding', lambda clock: bind_document_passages(**{**values, 'observed_at': clock}),
               DocumentPassageError, 'document_passage_binding_invalid', values['observed_at'])
        for name, capture, compare, error, at in PROFILES:
            current, previous = capture('New', 'new', 1), capture('Old', 'old', 0)
            yield (name, lambda clock, c=current, p=previous, f=compare: f(c, p, observed_at=clock),
                   error, 'document_comparison_unavailable' if name == 'plain' else 'html_comparison_unavailable',
                   at + timedelta(seconds=10))

    def test_unexpected_clock_fault_is_curated_at_each_snapshot_port(self):
        for name, invoke, error, message, at in self.ports():
            with self.subTest(port=name):
                def fail():
                    raise RuntimeError('FICTIONAL_PRIVATE_CLOCK_DETAIL')
                with self.assertRaises(error) as caught:
                    invoke(at.replace(tzinfo=CallbackUtc(fail)))
                self.assertEqual(str(caught.exception), message)
                self.assertIsNone(caught.exception.__cause__)
                self.assertTrue(caught.exception.__suppress_context__)

    def test_cancellation_identity_is_preserved_at_each_snapshot_port(self):
        from asyncio import CancelledError
        for kind in (KeyboardInterrupt, SystemExit, CancelledError):
            for name, invoke, _, _, at in self.ports():
                with self.subTest(port=name, cancellation=kind.__name__):
                    stop = kind('FICTIONAL_STOP')
                    def cancel():
                        raise stop
                    with self.assertRaises(kind) as caught:
                        invoke(at.replace(tzinfo=CallbackUtc(cancel)))
                    self.assertIs(caught.exception, stop)
