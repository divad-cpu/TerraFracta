"""Exact offline extraction-result evidence, not provider or native proof."""
import base64
from dataclasses import replace
from hashlib import sha256
import json
import unittest
from unittest.mock import patch
from tests import test_reopened_document_change as retained_fixture
from tests.test_document_result_contract import request as result_request, stored_shape
from tests.test_feed_postgres_contract import uid
from tests.test_feed_capture_reopen import encode
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request
from workers.private_extraction_result import (prepare_private_extraction_result,
    recheck_private_extraction_result, PrivateExtractionResultError)
NOW = retained_fixture.NOW


def retained(text, version):
    def expected(*args, **kwargs): return result_request(*args, **kwargs, operation_id=uid(version+100))
    def stored(value): return {**stored_shape(value), 'artifact_id': uid(version+200)}
    with patch.object(retained_fixture, 'result_request', side_effect=expected), patch.object(retained_fixture, 'stored_shape', side_effect=stored):
        return retained_fixture.retained(text, 'Invented metadata\n', version)


def fixture(*, changed=True):
    current, cr = retained('Changed exact invented passage.' if changed else 'Original exact invented passage.', 31)
    previous, pr = retained('Original exact invented passage.', 30)
    pair = prepare_reopened_document_change(current, cr, previous, pr, observed_at=NOW)
    request = compile_extraction_request(pair.current, pair.previous, observed_at=NOW, maximum_output_tokens=100)
    b = current.request.binding
    output = encode(dict(schema_version=1, source_version_id=b.source_version_id, source_sha256=b.content_sha256,
        locator='section:one', proposed_claim_type='condition', proposed_assertion='Changed exact invented passage.',
        source_date_text=None, language_code=b.language_code))
    return dict(current=current, current_receipt=cr, previous=previous, previous_receipt=pr,
        request=request, output_raw=output, operation_id=uid(300), prepared_at=NOW, observed_at=NOW, maximum_output_tokens=100)


def prepare(values): return prepare_private_extraction_result(**values)


class PrivateExtractionResultTests(unittest.TestCase):
    def test_exact_request_output_and_independent_original_references_remain_unverified(self):
        values = fixture(); result = prepare(values); body = json.loads(result.canonical_input)
        self.assertEqual(base64.b64decode(body['request_base64']), values['request'].body)
        self.assertEqual(base64.b64decode(body['output_base64']), values['output_raw'])
        self.assertEqual(body['request_sha256'], sha256(values['request'].body).hexdigest())
        self.assertEqual(body['output_sha256'], sha256(values['output_raw']).hexdigest())
        self.assertEqual(body['current_document']['artifact_id'], values['current'].artifact_id)
        self.assertEqual(body['previous_document']['artifact_id'], values['previous'].artifact_id)
        self.assertEqual(body['proposal']['review_state'], 'unverified')
        self.assertNotIn('published', body); self.assertNotIn('actual_cost', body)
        self.assertEqual(recheck_private_extraction_result(result), result)
        self.assertNotIn('Changed exact', repr(result))
        self.assertNotIn(values['current'].request.binding.source_url, repr(result))

    def test_missing_or_bad_prior_never_falls_back_to_first_observation(self):
        values = fixture()
        for previous, receipt in [(None, None), (values['previous'], b'{}'), (values['previous'], None),
                (values['previous'], bytearray(values['previous_receipt']))]:
            with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'previous': previous, 'previous_receipt': receipt})

    def test_each_original_and_full_receipt_is_reconfirmed_before_output_admission(self):
        values = fixture()
        for side in ['current', 'previous']:
            changed = replace(values[side], response_raw=b'{}')
            with self.assertRaises(PrivateExtractionResultError): prepare({**values, side: changed})
            body = json.loads(values[side+'_receipt']); body['input']['snapshot']['passages'][0]['text'] = 'FORGED'
            with self.assertRaises(PrivateExtractionResultError): prepare({**values, side+'_receipt': encode(body)})

    def test_no_change_missing_passages_or_reused_document_identity_cannot_create_result(self):
        values = fixture()
        with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'previous': values['current'], 'previous_receipt': values['current_receipt']})
        same = retained('Original exact invented passage.', 31)
        with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'current': same[0], 'current_receipt': same[1]})

    def test_request_template_ceiling_body_hash_and_selected_digest_substitution_refuse(self):
        values = fixture(); request = values['request']
        candidates = [replace(request, body=request.body.replace(b'Extract one', b'Approve one')),
            replace(request, body=bytearray(request.body)), replace(request, request_sha256='f'*64),
            replace(request, selected_payload_sha256='f'*64), replace(request, maximum_output_tokens=101)]
        for request in candidates:
            with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'request': request})
        with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'maximum_output_tokens': 101})

    def test_output_source_locator_claim_review_extra_fields_and_unicode_are_not_trusted(self):
        values = fixture(); body = json.loads(values['output_raw'])
        for fields in [dict(source_version_id=uid(99)), dict(source_sha256='f'*64), dict(locator='section:unknown'),
                dict(proposed_claim_type='approved'), dict(review_state='approved'), dict(proposed_assertion='Bad\ud800 text')]:
            with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'output_raw': encode({**body, **fields})})

    def test_builtin_output_and_canonical_bytes_are_required_before_user_hooks(self):
        values = fixture(); calls = []
        class Hook(bytes):
            def __len__(self): calls.append('length'); return 1
            def decode(self, *args, **kwargs): calls.append('decode'); return values['output_raw'].decode()
        for raw in [Hook(b'{}'), bytearray(values['output_raw']), memoryview(values['output_raw']), b' '*8193+values['output_raw']]:
            with self.assertRaises(PrivateExtractionResultError): prepare({**values, 'output_raw': raw})
        result = prepare(values)
        for raw in [Hook(result.canonical_input), bytearray(result.canonical_input), b'{}']:
            with self.assertRaises(PrivateExtractionResultError): recheck_private_extraction_result(replace(result, canonical_input=raw))
        self.assertEqual(calls, [])

    def test_forged_prebuilt_proposal_or_state_is_reparsed_not_adopted(self):
        result = prepare(fixture())
        for changed in [replace(result, proposal=replace(result.proposal, review_state='approved')),
                replace(result, output_raw=b'{}'), replace(result, evidence_state='approved')]:
            with self.assertRaises(PrivateExtractionResultError): recheck_private_extraction_result(changed)

    def test_observation_and_uuid_are_closed_and_failure_is_private(self):
        values = fixture()
        for fields in [dict(operation_id='PRIVATE_CANARY /home/private'), dict(observed_at=NOW.replace(tzinfo=None)),
                dict(observed_at=retained_fixture.AT), dict(maximum_output_tokens=True)]:
            with self.assertRaisesRegex(PrivateExtractionResultError, '^private_extraction_result_unavailable$'):
                prepare({**values, **fields})


if __name__ == '__main__': unittest.main()
