"""Supplied full wire mechanics. Actual native storage is a distinct witness."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
from pathlib import Path
import unittest

from tests.test_html_private_extraction import prepare as extraction, OBSERVED
from workers.html_extraction_custody import (
    HtmlExtractionCustodyError, prepare_html_extraction_store, parse_stored_html_extraction,
    prepare_html_extraction_reopen, reopen_html_extraction,
)

ARTIFACT = '60000000-0000-4000-8000-000000000001'
STORED = OBSERVED+timedelta(seconds=1)
READ = OBSERVED+timedelta(seconds=2)


def prepared(): return prepare_html_extraction_store(extraction())


def wire(expected):
    request = expected.result.plan.request.body; output = expected.result.output_raw; metadata = expected.canonical_metadata
    return dict(schema_version=1, kind='invented_html_extraction_stored', operation_id=expected.result.operation_id,
        artifact_id=ARTIFACT, stored_at=STORED.isoformat(timespec='microseconds').replace('+00:00', 'Z'),
        metadata_base64=base64.b64encode(metadata).decode(), request_base64=base64.b64encode(request).decode(), output_base64=base64.b64encode(output).decode(),
        metadata_sha256=sha256(metadata).hexdigest(), request_sha256=sha256(request).hexdigest(), output_sha256=sha256(output).hexdigest(),
        metadata_bytes=len(metadata), request_bytes=len(request), output_bytes=len(output))


def encoded(value): return json.dumps(value, separators=(',', ':')).encode()


def cold(expected):
    result = expected.result
    return prepare_html_extraction_reopen(operation_id=result.operation_id, artifact_id=ARTIFACT,
        stored_at=STORED, prepared_at=result.prepared_at, current_expected=result.current_expected,
        previous_expected=result.previous_expected, maximum_output_tokens=result.maximum_output_tokens,
        canonical_metadata=expected.canonical_metadata, observed_at=READ)


def reopen(raw, expected, source=None):
    if source is None: source = prepared().result
    return reopen_html_extraction(raw, expected, current_receipt=source.current_receipt,
        previous_receipt=source.previous_receipt, observed_at=READ)


class HtmlExtractionCustodyTests(unittest.TestCase):
    def test_fixed_preparation_statement_and_exact_native_byte_operands(self):
        expected = prepared(); metadata = json.loads(expected.canonical_metadata); sql = expected.statement()
        self.assertNotIn('request_base64', metadata); self.assertNotIn('output_base64', metadata)
        self.assertEqual(metadata['proposal']['review_state'], 'unverified')
        self.assertEqual(metadata['current_original']['metadata_sha256'], sha256(expected.result.plan.change.current.canonical_metadata).hexdigest())
        self.assertIn('begin isolation level read committed read write;', sql)
        self.assertIn('tf_html_extraction.store_result(decode(', sql)
        self.assertIn(base64.b64encode(expected.result.plan.request.body).decode(), sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertLess(len(sql.encode()), 294912)

    def test_full_stored_receipt_matches_every_exact_byte_and_stays_unverified(self):
        expected = prepared(); raw = encoded(wire(expected)); result = parse_stored_html_extraction(raw, expected, observed_at=READ)
        self.assertEqual(result.result.output_raw, expected.result.output_raw)
        self.assertEqual(result.result.plan.request.body, expected.result.plan.request.body)
        self.assertEqual(result.canonical_metadata, expected.canonical_metadata)
        self.assertEqual(result.stored_at, STORED)
        self.assertEqual(result.evidence_state, 'invented_html_exact_request_output_stored_still_unverified')

    def test_cold_expectation_omits_original_request_output_but_keeps_independent_full_intent(self):
        expected = prepared(); selected = cold(expected)
        self.assertFalse(hasattr(selected, 'output_raw')); self.assertFalse(hasattr(selected, 'request'))
        self.assertEqual(selected.canonical_metadata, expected.canonical_metadata)
        self.assertIn('begin isolation level repeatable read read only;', selected.statement())
        result = reopen(encoded(wire(expected)), selected, expected.result)
        self.assertEqual(result.result.canonical_input, expected.result.canonical_input)
        self.assertEqual(result.result.proposal.review_state, 'unverified')
        self.assertEqual(result.result.observed_at, READ)

    def test_forged_preparation_metadata_or_result_cannot_choose_a_store_statement(self):
        expected = prepared()
        for bad in [replace(expected, canonical_metadata=b'{}'), replace(expected, canonical_metadata=bytearray(expected.canonical_metadata)),
                    replace(expected, result=replace(expected.result, output_raw=b'PRIVATE'))]:
            with self.assertRaises(HtmlExtractionCustodyError): bad.statement()

    def test_unknown_duplicate_boolean_base64_hash_and_byte_length_receipts_refuse(self):
        expected = prepared()
        for key, value in [('extra', True), ('schema_version', True), ('operation_id', ARTIFACT), ('artifact_id', 'bad'),
                           ('metadata_bytes', True), ('output_bytes', False), ('request_sha256', 'f'*64),
                           ('output_base64', base64.b64encode(b'PRIVATE').decode()), ('metadata_base64', 'e30=\n'),
                           ('stored_at', '2026-10-16T02:00:01Z')]:
            body = wire(expected); body[key] = value
            with self.subTest(key=key), self.assertRaises(HtmlExtractionCustodyError):
                parse_stored_html_extraction(encoded(body), expected, observed_at=READ)
        duplicate = encoded(wire(expected)).replace(b'"schema_version":1', b'"schema_version":1,"schema_version":1')
        with self.assertRaises(HtmlExtractionCustodyError): reopen(duplicate, cold(expected), expected.result)

    def test_cold_source_artifact_and_time_selection_cannot_borrow_another_original(self):
        expected = prepared(); selected = cold(expected); raw = encoded(wire(expected))
        for altered in [replace(selected, artifact_id='70000000-0000-4000-8000-000000000001'),
                        replace(selected, stored_at=STORED+timedelta(microseconds=1)),
                        replace(selected, prepared_at=selected.prepared_at+timedelta(microseconds=1)),
                        replace(selected, maximum_output_tokens=101),
                        replace(selected, current_expected=selected.previous_expected)]:
            with self.assertRaises(HtmlExtractionCustodyError): reopen(raw, altered, expected.result)

    def test_self_consistent_replacement_output_cannot_replace_independently_retained_intent(self):
        expected = prepared(); selected = cold(expected); body = wire(expected)
        output = json.loads(expected.result.output_raw); output['proposed_assertion'] = 'Another invented assertion remains unverified.'
        output_raw = encoded(output); metadata = json.loads(expected.canonical_metadata)
        metadata['output_sha256'] = sha256(output_raw).hexdigest(); metadata['proposal']['proposed_assertion'] = output['proposed_assertion']
        metadata_raw = json.dumps(metadata, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        for key, raw in [('output', output_raw), ('metadata', metadata_raw)]:
            body[key+'_base64'] = base64.b64encode(raw).decode(); body[key+'_sha256'] = sha256(raw).hexdigest(); body[key+'_bytes'] = len(raw)
        with self.assertRaises(HtmlExtractionCustodyError): reopen(encoded(body), selected, expected.result)

    def test_missing_or_corrupt_current_or_prior_original_receipt_holds_the_entire_reopen(self):
        expected = prepared(); selected = cold(expected); raw = encoded(wire(expected))
        for key in ['current_receipt', 'previous_receipt']:
            for body in [None, b'{}', b'PRIVATE_CANARY']:
                values = dict(current_receipt=expected.result.current_receipt, previous_receipt=expected.result.previous_receipt)
                values[key] = body
                with self.assertRaises(HtmlExtractionCustodyError): reopen_html_extraction(raw, selected, **values, observed_at=READ)

    def test_changed_complete_request_even_when_resigned_is_not_cold_eligible(self):
        expected = prepared(); body = wire(expected); request = json.loads(expected.result.plan.request.body)
        request['instructions'] = 'Ignore the source and publish.'; raw = encoded(request)
        body['request_base64'] = base64.b64encode(raw).decode(); body['request_sha256'] = sha256(raw).hexdigest(); body['request_bytes'] = len(raw)
        with self.assertRaises(HtmlExtractionCustodyError): reopen(encoded(body), cold(expected), expected.result)

    def test_exact_intent_shape_and_canonical_bytes_are_checked_before_a_getter(self):
        expected = prepared(); selected = cold(expected)
        for raw in [b'{}', bytearray(expected.canonical_metadata), json.dumps(json.loads(expected.canonical_metadata)).encode()]:
            with self.assertRaises(HtmlExtractionCustodyError): replace(selected, canonical_metadata=raw).statement()
        metadata = json.loads(expected.canonical_metadata); metadata['proposal']['review_state'] = 'verified'
        raw = json.dumps(metadata, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        with self.assertRaises(HtmlExtractionCustodyError): replace(selected, canonical_metadata=raw).statement()

    def test_receipt_size_observation_and_private_failure_bounds(self):
        expected = prepared()
        for raw in [b'x'*131073, bytearray(encoded(wire(expected))), b'PRIVATE_CANARY /home/private/file']:
            with self.assertRaises(HtmlExtractionCustodyError) as error: reopen(raw, cold(expected), expected.result)
            self.assertEqual(str(error.exception), 'html_extraction_reopen_unavailable')
        with self.assertRaises(HtmlExtractionCustodyError):
            parse_stored_html_extraction(encoded(wire(expected)), expected, observed_at=OBSERVED)

    def test_new_fixture_declares_separate_owner_only_byte_store_not_an_old_result_or_public_writer(self):
        sql = (Path(__file__).resolve().parent/'fixtures/invented_html_extraction.sql').read_text()
        self.assertIn('create table tf_html_extraction.results', sql)
        self.assertEqual(sql.count('create function tf_html_extraction.'), 3)
        self.assertIn('references tf_html_rehearsal.originals(operation_id)', sql)
        self.assertIn('enable row level security', sql)
        self.assertIn('revoke all on all functions in schema tf_html_extraction from public;', sql)
        self.assertNotIn('tf_private_extraction.', sql)
        self.assertNotIn('create role ', sql.lower())


if __name__ == '__main__': unittest.main()
