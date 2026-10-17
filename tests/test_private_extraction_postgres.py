"""Full fixed PostgreSQL wire contract; no native/storage claim from fixtures."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
from tests.test_private_extraction_result import fixture, prepare, NOW
from tests.test_feed_capture_reopen import encode
from tests.test_feed_postgres_contract import uid
from workers.private_extraction_postgres import (prepare_private_extraction_store,
    private_extraction_read_statement, parse_stored_private_extraction_result,
    PrivateExtractionPostgresError, _shape, RECEIPT_MARGIN)
from workers.feed_postgres_contract import MAX_CAPTURE_OUTPUT


def wire(expected):
    value = _shape(json.loads(expected.canonical_metadata), expected.result.request.body, expected.result.output_raw)
    return {**value, 'artifact_id': uid(400), 'stored_at': (NOW+timedelta(seconds=1)).isoformat(timespec='microseconds').replace('+00:00', 'Z')}


class PrivateExtractionPostgresTests(unittest.TestCase):
    def test_fixed_write_and_read_routes_keep_exact_request_output_bytes(self):
        expected = prepare_private_extraction_store(prepare(fixture())); sql = expected.statement()
        self.assertIn('select tf_private_extraction.store_result(', sql)
        self.assertIn(base64.b64encode(expected.result.request.body).decode(), sql)
        self.assertIn(base64.b64encode(expected.result.output_raw).decode(), sql)
        read = private_extraction_read_statement(expected)
        self.assertIn('repeatable read read only', read)
        self.assertIn('select tf_private_extraction.result_receipt(', read)
        result = parse_stored_private_extraction_result(encode(wire(expected)), expected, observed_at=NOW+timedelta(seconds=2))
        self.assertEqual(result.request_sha256, expected.result.request.request_sha256)
        self.assertIn('still_unverified', result.evidence_state)

    def test_complete_output_budget_is_checked_before_sql_without_changing_compiler_limit(self):
        result = prepare(fixture()); expected = prepare_private_extraction_store(result)
        size = len(json.dumps(_shape(json.loads(expected.canonical_metadata), result.request.body, result.output_raw), ensure_ascii=False).encode())
        with patch('workers.private_extraction_postgres.MAX_CAPTURE_OUTPUT', size+RECEIPT_MARGIN):
            self.assertEqual(prepare_private_extraction_store(result), expected)
        with patch('workers.private_extraction_postgres.MAX_CAPTURE_OUTPUT', size+RECEIPT_MARGIN-1):
            with self.assertRaises(PrivateExtractionPostgresError): prepare_private_extraction_store(result)
        self.assertGreater(MAX_CAPTURE_OUTPUT, size+RECEIPT_MARGIN)

    def test_each_raw_byte_context_and_unverified_proposal_must_match_full_receipt(self):
        expected = prepare_private_extraction_store(prepare(fixture())); value = wire(expected)
        for mutate in [lambda v:v.update(request_base64=base64.b64encode(b'{}').decode()),
                lambda v:v.update(output_base64=base64.b64encode(b'{}').decode()),
                lambda v:v.update(operation_id=uid(99)), lambda v:v['input']['proposal'].update(review_state='approved'),
                lambda v:v['input']['current_document'].update(artifact_id=uid(99)),
                lambda v:v['input'].update(request_sha256='f'*64), lambda v:v.update(schema_version=True),
                lambda v:v.update(extra='private')]:
            bad = deepcopy(value); mutate(bad)
            with self.assertRaises(PrivateExtractionPostgresError): parse_stored_private_extraction_result(encode(bad), expected, observed_at=NOW+timedelta(seconds=2))

    def test_closed_metadata_bytes_and_prebuilt_mutation_refuse_all_ports(self):
        expected = prepare_private_extraction_store(prepare(fixture())); calls = []
        class Hook(bytes):
            def decode(self, *args, **kwargs): calls.append(True); return '{}'
        for raw in [b'{}', bytearray(expected.canonical_metadata), Hook(expected.canonical_metadata)]:
            bad = replace(expected, canonical_metadata=raw)
            with self.assertRaises(PrivateExtractionPostgresError): bad.statement()
            with self.assertRaises(PrivateExtractionPostgresError): private_extraction_read_statement(bad)
            with self.assertRaises(PrivateExtractionPostgresError): parse_stored_private_extraction_result(encode(wire(expected)), bad, observed_at=NOW+timedelta(seconds=2))
        self.assertEqual(calls, [])

    def test_receipt_framing_types_size_and_chronology_cannot_masquerade_as_confirmation(self):
        expected = prepare_private_extraction_store(prepare(fixture())); value = wire(expected)
        for raw in [b'{"x":1,"x":2}', b'null', b'x'*(MAX_CAPTURE_OUTPUT+1), bytearray(encode(value))]:
            with self.assertRaises(PrivateExtractionPostgresError): parse_stored_private_extraction_result(raw, expected, observed_at=NOW+timedelta(seconds=2))
        for at in [NOW-timedelta(seconds=1), NOW.replace(tzinfo=None), None]:
            with self.assertRaises(PrivateExtractionPostgresError): parse_stored_private_extraction_result(encode(value), expected, observed_at=at)
        for stored in [NOW-timedelta(microseconds=1), NOW+timedelta(seconds=3)]:
            bad = {**value, 'stored_at': stored.isoformat(timespec='microseconds').replace('+00:00', 'Z')}
            with self.assertRaises(PrivateExtractionPostgresError): parse_stored_private_extraction_result(encode(bad), expected, observed_at=NOW+timedelta(seconds=2))

    def test_refusal_never_echoes_private_result(self):
        expected = prepare_private_extraction_store(prepare(fixture()))
        with self.assertRaisesRegex(PrivateExtractionPostgresError, '^private_extraction_stored_result_unavailable$'):
            parse_stored_private_extraction_result(b'PRIVATE_CANARY /home/private', expected, observed_at=NOW)


if __name__ == '__main__': unittest.main()
