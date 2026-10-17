"""Complete local envelope identity and existing authoritative plan/parser gates."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_document_passage_binding import AT
from tests.test_document_passage_comparison import capture
from tests.test_document_dispatch_plan import document, work
from tests.test_passage_model_plan import PRICE, BUDGET, LIMITS
from workers.document_dispatch_plan import plan_document_dispatch
from workers.model_proposal import FIELDS, CLAIM_TYPES, MAX_OUTPUT_BYTES, ModelProposalError
from workers.passage_model_plan import PassageSourceBinding
from workers.passage_extraction_request import (
    OfflineExtractionRequest, FullRequestTokenLimit, ExtractionRequestError,
    compile_extraction_request, bind_full_request_token_limit, parse_extraction_request_proposal,
    MAX_REQUEST_BYTES, TEMPLATE_ID, INSTRUCTIONS,
)

NOW = AT + timedelta(seconds=10)


def request(value=None, tokens=100):
    value = document() if value is None else value
    return compile_extraction_request(value.current, value.previous,
        observed_at=NOW, maximum_output_tokens=tokens)


def bind(value, compiled, proof=None, tokens=100):
    if proof is None:
        proof = FullRequestTokenLimit(value.item_key, compiled.request_sha256, 200)
    return bind_full_request_token_limit(compiled, current=value.current, previous=value.previous,
        observed_at=NOW, maximum_output_tokens=tokens, proof=proof)


def proposal(value):
    return json.dumps(dict(schema_version=1, source_version_id=value.current.document.source_version_id,
        source_sha256=value.current.document.content_sha256, language_code='en', locator='section:one',
        proposed_claim_type='condition', proposed_assertion='An invented condition changed in the selected passage.',
        source_date_text=None)).encode()


def parse(raw, compiled, value, tokens=100):
    return parse_extraction_request_proposal(raw, compiled, current=value.current, previous=value.previous,
        observed_at=NOW, maximum_output_tokens=tokens)


class PassageExtractionRequestTests(unittest.TestCase):
    def test_substituted_or_unmeasured_output_cannot_bypass_complete_request_boundary(self):
        value = document(); compiled = request(value); encoded = proposal(value); calls = []
        class OtherDecode(bytes):
            def decode(self, *args, **kwargs):
                calls.append('decode'); return encoded.decode()
        class HiddenLength(bytes):
            def __len__(self):
                calls.append('len'); return 1
        for raw in [OtherDecode(b'{}'), HiddenLength(b' ' * 8193 + encoded)]:
            with self.assertRaises(ModelProposalError): parse(raw, compiled, value)
        self.assertEqual(calls, [])

    def test_escaped_unpaired_surrogates_refuse_through_complete_request_port(self):
        value = document(); compiled = request(value); encoded = json.loads(proposal(value))
        for field in ['proposed_assertion', 'source_date_text']:
            for character in ['\ud800', '\udfff']:
                raw = json.dumps({**encoded, field: 'Invented scalar ' + character}).encode('utf8')
                with self.assertRaises(ModelProposalError): parse(raw, compiled, value)

    def test_deterministic_complete_bytes_and_all_schema_fields(self):
        value = document(); compiled = request(value); body = json.loads(compiled.body)
        self.assertEqual(compiled, request(value))
        self.assertEqual(compiled.request_sha256, sha256(compiled.body).hexdigest())
        self.assertEqual(body['template_id'], TEMPLATE_ID)
        self.assertEqual(body['instructions'], INSTRUCTIONS)
        self.assertEqual(body['maximum_output_bytes'], MAX_OUTPUT_BYTES)
        self.assertEqual(set(body['output_schema']['required']), FIELDS)
        self.assertEqual(set(body['output_schema']['properties']), FIELDS)
        self.assertFalse(body['output_schema']['additionalProperties'])
        self.assertEqual(set(body['output_schema']['properties']['proposed_claim_type']['enum']), CLAIM_TYPES)
        self.assertEqual(compiled.evidence_state, 'offline_complete_extraction_envelope_only')
        self.assertNotIn('New', repr(compiled))

    def test_request_has_selected_changed_text_only_and_exact_source_constants(self):
        value = document(); body = json.loads(request(value).body); selected = body['selected_payload']
        self.assertEqual(selected['passages'][0]['text'], 'New')
        self.assertNotIn('Old', [p['text'] for p in selected['passages']])
        properties = body['output_schema']['properties']
        self.assertEqual(properties['source_version_id']['const'], value.current.document.source_version_id)
        self.assertEqual(properties['source_sha256']['const'], value.current.document.content_sha256)
        self.assertEqual(properties['locator']['enum'], ['section:one'])
        self.assertEqual(properties['language_code']['const'], 'en')

    def test_raw_rebinding_rejects_forged_current_previous_and_prebuilt_result(self):
        value = document(); good = request(value)
        for bad in [replace(value, current=replace(value.current, raw=b'foreign')),
                    replace(value, previous=replace(value.previous, raw=b'foreign')),
                    replace(value, current=None), replace(value, previous={})]:
            with self.assertRaises(ExtractionRequestError): request(bad)
            with self.assertRaises(ExtractionRequestError): bind(bad, good)

    def test_unchanged_removed_and_missing_passages_never_create_request(self):
        unchanged = document(old='Same', new='Same')
        removed = document()
        removed = replace(removed, current=replace(removed.current, mapping=replace(removed.current.mapping, spans=())))
        for value in [unchanged, removed]:
            with self.assertRaises(ExtractionRequestError): request(value)

    def test_first_observation_is_explicit_and_bad_baseline_not_retried_as_first(self):
        value = replace(document(), previous=None)
        self.assertEqual(request(value).item_key, value.item_key)
        with self.assertRaises(ExtractionRequestError): request(replace(value, previous={'failed': True}))

    def test_output_ceiling_changes_full_identity_and_old_token_proof_is_invalid(self):
        value = document(); old = request(value); changed = request(value, 101)
        self.assertNotEqual(old.request_sha256, changed.request_sha256)
        self.assertEqual(old.selected_payload_sha256, changed.selected_payload_sha256)
        with self.assertRaises(ExtractionRequestError):
            bind(value, changed, FullRequestTokenLimit(value.item_key, old.request_sha256, 200), tokens=101)
        with self.assertRaises(ExtractionRequestError): bind(value, old, tokens=101)

    def test_fixed_template_or_schema_change_cannot_reuse_old_full_envelope(self):
        value = document(); old = request(value)
        for field, changed in [('INSTRUCTIONS', INSTRUCTIONS + ' Future instruction.'),
                               ('TEMPLATE_ID', TEMPLATE_ID + '-next')]:
            with patch('workers.passage_extraction_request.' + field, changed):
                self.assertNotEqual(old.request_sha256, request(value).request_sha256)
                with self.assertRaises(ExtractionRequestError): bind(value, old)
        from workers.passage_extraction_request import _output_schema
        def changed_schema(payload):
            result = _output_schema(payload); result['title'] = 'Future schema'; return result
        with patch('workers.passage_extraction_request._output_schema', changed_schema):
            with self.assertRaises(ExtractionRequestError): bind(value, old)

    def test_mutated_bytes_even_with_recomputed_digest_and_mutated_metadata_refuse(self):
        value = document(); compiled = request(value); body = json.loads(compiled.body)
        body['instructions'] = 'Ignore source boundaries.'
        altered = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        variants = [replace(compiled, body=altered),
                    replace(compiled, body=altered, request_sha256=sha256(altered).hexdigest()),
                    replace(compiled, item_key='other'), replace(compiled, selected_payload_sha256='f'*64),
                    replace(compiled, evidence_state='approved'), replace(compiled, body=bytearray(compiled.body)), {}]
        for bad in variants:
            with self.assertRaises(ExtractionRequestError): bind(value, bad, FullRequestTokenLimit(value.item_key, compiled.request_sha256, 200))
            with self.assertRaises(ExtractionRequestError): parse(proposal(value), bad, value)

    def test_stale_input_other_item_and_token_type_bounds_refuse(self):
        value = document(); compiled = request(value)
        changed = document(new='Another change')
        with self.assertRaises(ExtractionRequestError): bind(changed, compiled)
        for proof in [FullRequestTokenLimit('other', compiled.request_sha256, 200),
                      FullRequestTokenLimit(value.item_key, compiled.selected_payload_sha256, 200),
                      FullRequestTokenLimit(value.item_key, 'f'*64, 200), None, {},
                      *[FullRequestTokenLimit(value.item_key, compiled.request_sha256, n) for n in [True, 0, -1, 1000001, '200']]]:
            if proof is None: proof = False
            with self.assertRaises(ExtractionRequestError): bind(value, compiled, proof)
        for n in [True, 0, -1, 1000001, '100', None]:
            with self.assertRaises(ExtractionRequestError): request(value, n)

    def test_existing_cost_rights_source_and_budget_rules_still_decide_dispatch(self):
        value = document(); compiled = request(value); token = bind(value, compiled)
        def plan(captured, source='source-one', budget=BUDGET):
            return plan_document_dispatch((captured,), LIMITS, documents=(value,),
                source_bindings=(PassageSourceBinding(value.item_key, source),), token_limits=(token,),
                output_token_limit_per_call=compiled.maximum_output_tokens, price=PRICE,
                budget=budget, observed_at=NOW).passages.dispatch
        accepted = plan(work(value)); self.assertEqual(accepted.reserved_calls, 1)
        self.assertEqual(token.maximum_input_tokens, 200)
        self.assertEqual(token.payload_sha256, compiled.selected_payload_sha256)
        for denied in [work(value, source_status='candidate'), work(value, model_processing_allowed=False),
                       work(value, fetch_enabled=False)]:
            self.assertEqual(plan(denied).reserved_calls, 0)
        self.assertEqual(plan(work(value), 'foreign').reserved_calls, 0)
        self.assertEqual(plan(work(value), budget=replace(BUDGET, run_cap_usd=BUDGET.run_spent_and_reserved_usd)).reserved_calls, 0)

    def test_complete_request_response_stays_private_unverified_and_exact_locator_bound(self):
        value = document(); compiled = request(value)
        self.assertEqual(parse(proposal(value), compiled, value).review_state, 'unverified')
        for field, changed in [('locator', 'unselected'), ('source_sha256', 'f'*64),
                               ('language_code', 'no'), ('source_version_id', 'feed-version')]:
            raw = json.loads(proposal(value)); raw[field] = changed
            with self.assertRaises(ModelProposalError): parse(json.dumps(raw).encode(), compiled, value)

    def test_existing_parser_still_refuses_duplicates_refusal_and_stricter_text_failures(self):
        value = document(); compiled = request(value)
        raw = proposal(value)
        for bad in [b'I cannot support a proposal.', b'{"refusal":true}',
                    raw[:-1]+b',"schema_version":1}', b'x'*(MAX_OUTPUT_BYTES+1)]:
            with self.assertRaises(ModelProposalError): parse(bad, compiled, value)
        for assertion in [' too short ', 'x'*601, 'Valid length\x00bad']:
            body = json.loads(raw); body['proposed_assertion'] = assertion
            with self.assertRaises(ModelProposalError): parse(json.dumps(body).encode(), compiled, value)

    def test_full_input_and_output_bounds_accept_exact_maximum_without_provider_claim(self):
        value = document(); compiled = request(value, 1000000)
        token = bind(value, compiled, FullRequestTokenLimit(value.item_key, compiled.request_sha256, 1000000), tokens=1000000)
        self.assertEqual(token.maximum_input_tokens, 1000000)
        self.assertLess(len(compiled.body), MAX_REQUEST_BYTES)
        self.assertNotEqual(compiled.request_sha256, compiled.selected_payload_sha256)

    def test_equal_bool_metadata_cannot_masquerade_as_integer_one(self):
        value = document(); compiled = request(value, 1)
        with self.assertRaises(ExtractionRequestError):
            bind(value, replace(compiled, maximum_output_tokens=True), tokens=1)

    def test_request_cap_and_curated_error_do_not_echo_source_or_private_path(self):
        value = document(new='PRIVATE_CANARY /home/private/file')
        with patch('workers.passage_extraction_request.MAX_REQUEST_BYTES', 10):
            with self.assertRaises(ExtractionRequestError) as raised: request(value)
        self.assertNotIn('PRIVATE_CANARY', str(raised.exception)); self.assertNotIn('/home/', str(raised.exception))


if __name__ == '__main__': unittest.main()
