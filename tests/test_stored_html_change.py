"""Synthetic receipts exercise binding only; actual SQL custody is separate."""
import base64
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest

from tests.test_html_inspection_report import capture, examples, AT, OBSERVED
from workers.html_original_custody import (
    prepare_html_original, prepare_html_original_reopen, parse_stored_html_original,
)
from workers.stored_html_change import (
    StoredHtmlChangeError, prepare_stored_html_change, compile_stored_html_request,
)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def wire(capture, serial):
    prepared_at = AT + timedelta(hours=1, seconds=serial)
    stored_at = prepared_at + timedelta(microseconds=1)
    expected = prepare_html_original(capture.raw, capture.document, binding=capture.binding,
        mapping=capture.mapping, operation_id=f'20000000-0000-4000-8000-{serial:012d}',
        prepared_at=prepared_at, observed_at=OBSERVED)
    receipt = encode(dict(schema_version=1, kind='invented_html_original_stored',
        operation_id=expected.intent.operation_id, artifact_id=f'30000000-0000-4000-8000-{serial:012d}',
        stored_at=stored_at.isoformat(timespec='microseconds').replace('+00:00', 'Z'),
        raw_base64=base64.b64encode(capture.raw).decode('ascii'),
        metadata_base64=base64.b64encode(expected.intent.canonical_metadata).decode('ascii'),
        raw_sha256=sha256(capture.raw).hexdigest(), metadata_sha256=sha256(expected.intent.canonical_metadata).hexdigest(),
        raw_bytes=len(capture.raw), metadata_bytes=len(expected.intent.canonical_metadata)))
    stored = parse_stored_html_original(receipt, expected, observed_at=OBSERVED)
    reopen = prepare_html_original_reopen(intent=expected.intent, document=capture.document,
        binding=capture.binding, mapping=capture.mapping, artifact_id=stored.artifact_id,
        stored_at=stored.stored_at, observed_at=OBSERVED)
    return receipt, reopen


def context(current=None):
    now, old, _ = examples()
    return (*wire(now if current is None else current, 2), *wire(old, 1))


def compare(values):
    return prepare_stored_html_change(*values, observed_at=OBSERVED)


def compile(values, maximum_output_tokens=100):
    return compile_stored_html_request(*values, observed_at=OBSERVED, maximum_output_tokens=maximum_output_tokens)


class StoredHtmlChangeTests(unittest.TestCase):
    def test_two_whole_receipts_reopen_to_exact_original_comparison_and_complete_request(self):
        values = context(); result = compare(values); planned = compile(values)
        self.assertEqual(result.current.raw, examples()[0].raw)
        self.assertEqual(result.previous.raw, examples()[1].raw)
        self.assertEqual(result.current.result.snapshot.content_sha256, sha256(result.current.raw).hexdigest())
        self.assertEqual(result.comparison.change.current, result.current.result.snapshot)
        self.assertNotEqual(result.current.artifact_id, result.previous.artifact_id)
        self.assertEqual(result.current.stored_at, values[1].stored_at)
        self.assertEqual(planned.change, result)
        body = json.loads(planned.request.body)
        self.assertEqual(body['selected_payload']['content_sha256'], sha256(result.current.raw).hexdigest())
        self.assertEqual(body['html_provenance']['current_derivation_sha256'], result.current.result.derivation_manifest_sha256)
        self.assertEqual(body['html_provenance']['previous_derivation_sha256'], result.previous.result.derivation_manifest_sha256)
        self.assertEqual(planned.evidence_state, 'invented_retained_html_pair_offline_request_only')
        self.assertNotIn('Revised invented wording', repr(planned))

    def test_missing_or_failed_prior_receipt_never_creates_first_observation_request(self):
        now, expected, old, prior = context()
        for values in [(now, expected, None, prior), (now, expected, b'{}', prior),
                       (now, expected, old, None), (now, expected, old, {}), (now, expected, old, expected)]:
            with self.assertRaises(StoredHtmlChangeError): compare(values)
            with self.assertRaises(StoredHtmlChangeError): compile(values)

    def test_both_original_and_metadata_bytes_are_mandatory_even_with_equal_receipt_metadata(self):
        values = context()
        for index, field in [(0, 'raw_base64'), (0, 'metadata_base64'), (2, 'raw_base64'), (2, 'metadata_base64')]:
            changed = list(values); payload = json.loads(changed[index]); payload[field] = base64.b64encode(b'PRIVATE_CANARY').decode()
            changed[index] = encode(payload)
            with self.assertRaises(StoredHtmlChangeError): compare(changed)

    def test_independent_source_recipe_artifact_and_time_expectations_cannot_be_borrowed(self):
        now, expected, old, prior = context()
        changed = [replace(expected, artifact_id='40000000-0000-4000-8000-000000000001'),
            replace(expected, stored_at=expected.stored_at+timedelta(microseconds=1)),
            replace(expected, binding=replace(expected.binding, mapping_sha256='f'*64)),
            replace(expected, document=replace(expected.document, source_url='https://example.org/other'))]
        for other in changed:
            with self.assertRaises(StoredHtmlChangeError): compare((now, other, old, prior))

    def test_changed_wrapping_of_retained_originals_with_identical_selected_text_has_no_request(self):
        _, old, _ = examples()
        values = context(capture(b'<nav>Changed wrapping</nav>'+old.raw))
        result = compare(values)
        self.assertTrue(result.comparison.source_bytes_changed)
        self.assertEqual(result.comparison.selection.reason_code, 'source_changed_passages_unchanged')
        self.assertIsNone(result.comparison.selection.payload)
        with self.assertRaises(StoredHtmlChangeError): compile(values)

    def test_reversed_supplied_vintages_hold_without_guessing_a_baseline(self):
        now, expected, old, prior = context()
        with self.assertRaises(StoredHtmlChangeError): compare((old, prior, now, expected))
        with self.assertRaises(StoredHtmlChangeError): compile((old, prior, now, expected))

    def test_invalid_output_ceiling_or_observation_cannot_promote_retained_originals_to_dispatch(self):
        values = context()
        for maximum in [True, 0, 1_000_001]:
            with self.assertRaises(StoredHtmlChangeError): compile(values, maximum)
        with self.assertRaises(StoredHtmlChangeError):
            prepare_stored_html_change(*values, observed_at=AT)

    def test_fixed_failure_does_not_disclose_earlier_original_or_receipt(self):
        now, expected, _, prior = context()
        with self.assertRaises(StoredHtmlChangeError) as error: compare((now, expected, b'PRIVATE_CANARY /home/private', prior))
        self.assertEqual(str(error.exception), 'stored_html_change_unavailable')
        self.assertIsNone(error.exception.__cause__)


if __name__ == '__main__': unittest.main()
