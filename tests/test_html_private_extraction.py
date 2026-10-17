"""Exact supplied-output mechanics only; no actual model or stored-result claim."""
import base64
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest

from tests.test_stored_html_change import context, compile, OBSERVED
from workers.html_private_extraction import (
    HtmlPrivateExtractionError, prepare_html_private_extraction, recheck_html_private_extraction,
)


def inputs():
    values = context(); plan = compile(values)
    raw = json.dumps(dict(schema_version=1, source_version_id=plan.change.current.result.document.source_version_id,
        source_sha256=plan.change.current.result.document.content_sha256, language_code='en', locator='article:one',
        proposed_claim_type='condition', proposed_assertion='An invented source statement remains unverified.',
        source_date_text=None)).encode()
    return dict(current_receipt=values[0], current_expected=values[1], previous_receipt=values[2], previous_expected=values[3],
        request=plan.request, output_raw=raw, operation_id='50000000-0000-4000-8000-000000000001',
        prepared_at=OBSERVED-timedelta(seconds=1), observed_at=OBSERVED, maximum_output_tokens=100)


def prepare(**changes):
    return prepare_html_private_extraction(**(inputs() | changes))


class HtmlPrivateExtractionTests(unittest.TestCase):
    def test_packet_binds_two_originals_complete_request_and_exact_unverified_output(self):
        values = inputs(); result = prepare_html_private_extraction(**values); body = json.loads(result.canonical_input)
        self.assertEqual(result, recheck_html_private_extraction(result))
        self.assertEqual(base64.b64decode(body['request_base64']), values['request'].body)
        self.assertEqual(base64.b64decode(body['output_base64']), values['output_raw'])
        self.assertEqual(body['output_sha256'], sha256(values['output_raw']).hexdigest())
        self.assertEqual(body['request_sha256'], values['request'].request_sha256)
        self.assertEqual(body['current_original']['metadata_sha256'], sha256(result.plan.change.current.canonical_metadata).hexdigest())
        self.assertNotEqual(body['current_original']['artifact_id'], body['previous_original']['artifact_id'])
        self.assertEqual(body['proposal']['review_state'], 'unverified')
        self.assertEqual(result.evidence_state, 'invented_retained_html_exact_request_output_unverified_unstored')
        self.assertNotIn('source statement', repr(result))

    def test_bad_earlier_or_current_full_receipt_never_becomes_a_first_observation_packet(self):
        for key in ['current_receipt', 'previous_receipt']:
            for raw in [None, b'{}', b'PRIVATE_CANARY']:
                with self.assertRaises(HtmlPrivateExtractionError): prepare(**{key: raw})

    def test_complete_request_or_its_original_provenance_cannot_be_swapped(self):
        request = inputs()['request']; body = json.loads(request.body)
        body['html_provenance']['previous_derivation_sha256'] = 'f'*64
        encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        for altered in [replace(request, body=encoded, request_sha256=sha256(encoded).hexdigest()),
                        replace(request, selected_payload_sha256='f'*64), replace(request, evidence_state='approved'), {}]:
            with self.assertRaises(HtmlPrivateExtractionError): prepare(request=altered)

    def test_only_exact_changed_locators_original_sha_language_and_source_version_bind_output(self):
        values = inputs(); output = json.loads(values['output_raw'])
        for key, bad in [('locator', 'context:one'), ('source_sha256', 'f'*64),
                         ('language_code', 'no'), ('source_version_id', 'foreign-version')]:
            with self.assertRaises(HtmlPrivateExtractionError): prepare(output_raw=json.dumps(output | {key: bad}).encode())
        for raw in [b'{"refusal":true}', b'An unsupported refusal.', values['output_raw'][:-1]+b',"schema_version":1}']:
            with self.assertRaises(HtmlPrivateExtractionError): prepare(output_raw=raw)

    def test_retained_custody_times_and_immutable_preparation_are_distinct(self):
        values = inputs(); result = prepare_html_private_extraction(**values)
        self.assertGreater(result.prepared_at, result.plan.change.current.stored_at)
        for prepared in [result.plan.change.current.stored_at-timedelta(microseconds=1), OBSERVED+timedelta(microseconds=1), OBSERVED.replace(tzinfo=None)]:
            with self.assertRaises(HtmlPrivateExtractionError): prepare(prepared_at=prepared)
        later = prepare(observed_at=OBSERVED+timedelta(hours=1))
        self.assertEqual(later.canonical_input, result.canonical_input)
        self.assertNotEqual(later.observed_at, result.observed_at)

    def test_mutated_packet_or_proposal_cannot_be_reused_without_whole_regeneration(self):
        result = prepare()
        for bad in [replace(result, output_raw=b'PRIVATE_CANARY'), replace(result, canonical_input=b'{}'),
                    replace(result, proposal=replace(result.proposal, review_state='verified')),
                    replace(result, plan=replace(result.plan, evidence_state='approved')),
                    replace(result, previous_receipt=b'{}'), replace(result, maximum_output_tokens=True), {}]:
            with self.assertRaises(HtmlPrivateExtractionError): recheck_html_private_extraction(bad)

    def test_native_byte_and_scope_types_cannot_enter_a_signed_packet(self):
        values = inputs()
        for change in [dict(output_raw=bytearray(values['output_raw'])), dict(operation_id='bad'),
                       dict(maximum_output_tokens=True), dict(maximum_output_tokens=1_000_001)]:
            with self.assertRaises(HtmlPrivateExtractionError): prepare(**change)

    def test_private_refusal_omits_source_model_and_receipt_text(self):
        with self.assertRaises(HtmlPrivateExtractionError) as error: prepare(output_raw=b'PRIVATE_CANARY /home/private/file')
        self.assertEqual(str(error.exception), 'html_private_extraction_unavailable')
        self.assertIsNone(error.exception.__cause__)


if __name__ == '__main__': unittest.main()
