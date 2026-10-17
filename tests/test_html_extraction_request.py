"""Private request composition from invented HTML, not provider or cost evidence."""
from dataclasses import replace
from hashlib import sha256
import json
import unittest

from tests.test_html_passage_comparison import capture, compare, OBSERVED
from tests.test_passage_model_plan import item, plan, BUDGET
from workers.html_extraction_request import (
    HtmlExtractionRequestError, compile_html_extraction_request,
    bind_html_full_request_token_limit, parse_html_extraction_proposal, TEMPLATE_ID,
)
from workers.model_proposal import ModelProposalError
from workers.passage_extraction_request import INSTRUCTIONS, FullRequestTokenLimit
from workers.passage_model_plan import PassageSourceBinding


def request(current=None, previous=None, tokens=100):
    return compile_html_extraction_request(capture() if current is None else current, previous,
        observed_at=OBSERVED, maximum_output_tokens=tokens)


def proof(compiled, current, previous=None, tokens=100, maximum_input=200):
    return bind_html_full_request_token_limit(compiled, current=current, previous=previous,
        observed_at=OBSERVED, maximum_output_tokens=tokens,
        proof=FullRequestTokenLimit('item-one', compiled.request_sha256, maximum_input))


def output(current, **changes):
    return json.dumps(dict(schema_version=1, source_version_id=current.document.source_version_id,
        source_sha256=current.document.content_sha256, language_code='en', locator='article:one',
        proposed_claim_type='condition', proposed_assertion='An invented condition changed in this parsed source text.',
        source_date_text=None) | changes).encode()


def parse(raw, compiled, current, previous=None):
    return parse_html_extraction_proposal(raw, compiled, current=current, previous=previous,
        observed_at=OBSERVED, maximum_output_tokens=100)


class HtmlExtractionRequestTests(unittest.TestCase):
    def test_deterministic_request_binds_original_html_and_both_derivation_witnesses(self):
        old = capture('Old wording', 'old', 0); current = capture()
        compiled = request(current, old); compared = compare(current, old)
        self.assertEqual(compiled, request(current, old))
        self.assertEqual(compiled.request_sha256, sha256(compiled.body).hexdigest())
        body = json.loads(compiled.body)
        self.assertEqual(body['template_id'], TEMPLATE_ID)
        self.assertEqual(body['instructions'], INSTRUCTIONS)
        self.assertEqual(body['html_provenance']['current_derivation_sha256'], compared.current.derivation_manifest_sha256)
        self.assertEqual(body['html_provenance']['previous_derivation_sha256'], compared.previous.derivation_manifest_sha256)
        self.assertFalse(body['html_provenance']['rendered_visibility_verified'])
        self.assertEqual(body['selected_payload']['content_sha256'], sha256(current.raw).hexdigest())
        self.assertEqual(body['selected_payload']['passages'][0]['text'], 'New wording')
        self.assertEqual(body['output_schema']['properties']['source_sha256']['const'], sha256(current.raw).hexdigest())
        self.assertEqual(compiled.evidence_state, 'offline_html_complete_extraction_envelope_only')
        self.assertNotIn('New wording', repr(compiled))

    def test_unselected_navigation_tags_and_previous_text_are_not_model_evidence(self):
        old = capture('Old PRIVATE_PRIOR', 'old', 0)
        current = capture('New <em>wording</em>', prefix='<nav>PRIVATE_NAV</nav>')
        body = json.loads(request(current, old).body)
        self.assertEqual(body['selected_payload']['passages'][0]['text'], 'New wording')
        self.assertNotIn(b'PRIVATE_NAV', request(current, old).body)
        self.assertNotIn(b'PRIVATE_PRIOR', request(current, old).body)
        self.assertNotIn(b'<em>', request(current, old).body)
        self.assertEqual(body['output_schema']['properties']['locator']['enum'], ['article:one'])

    def test_markup_only_and_unchanged_selected_text_cannot_create_request(self):
        old = capture('Same', 'old', 0)
        for current in [old, capture('<em>Same</em>', 'new', 1, '<nav>changed</nav>')]:
            with self.assertRaises(HtmlExtractionRequestError): request(current, old)

    def test_bad_current_prior_or_missing_container_never_becomes_first_observation(self):
        current = capture(); old = capture('Old', 'old', 0)
        self.assertIsNone(json.loads(request(current).body)['html_provenance']['previous_derivation_sha256'])
        for now, before in [(replace(current, raw=b'PRIVATE'), old), (current, replace(old, raw=b'PRIVATE')),
                            (current, {}), (None, old)]:
            with self.assertRaises(HtmlExtractionRequestError):
                compile_html_extraction_request(now, before, observed_at=OBSERVED, maximum_output_tokens=100)
        gone = capture(element_id='gone')
        gone = replace(gone, mapping=replace(gone.mapping, selections=current.mapping.selections))
        with self.assertRaises(HtmlExtractionRequestError): request(gone, old)

    def test_changed_markup_with_equal_payload_invalidates_full_request_proof(self):
        current = capture(); first = request(current)
        changed = capture('<em>New wording</em>')
        second = request(changed)
        self.assertNotEqual(first.request_sha256, second.request_sha256)
        # Original-source identity remains in the selected payload even though
        # derived text is equal. A new raw document is never an old request.
        self.assertEqual(json.loads(first.body)['selected_payload']['passages'], json.loads(second.body)['selected_payload']['passages'])
        with self.assertRaises(HtmlExtractionRequestError): proof(first, changed)
        with self.assertRaises(HtmlExtractionRequestError):
            bind_html_full_request_token_limit(second, current=changed, previous=None,
                observed_at=OBSERVED, maximum_output_tokens=100,
                proof=FullRequestTokenLimit('item-one', first.request_sha256, 200))

    def test_changed_retrieval_receipt_binds_even_when_source_and_payload_are_equal(self):
        current = capture(); first = request(current)
        changed = capture(seconds=2); second = request(changed)
        self.assertEqual(first.selected_payload_sha256, second.selected_payload_sha256)
        self.assertNotEqual(first.request_sha256, second.request_sha256)
        with self.assertRaises(HtmlExtractionRequestError): proof(first, changed)

    def test_forged_request_cannot_be_resigned_to_bypass_regeneration(self):
        current = capture(); compiled = request(current)
        body = json.loads(compiled.body); body['html_provenance']['rendered_visibility_verified'] = True
        altered = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        for forged in [replace(compiled, body=altered, request_sha256=sha256(altered).hexdigest()),
                       replace(compiled, evidence_state='approved'), replace(compiled, body=bytearray(compiled.body)),
                       replace(compiled, item_key='other'), {}]:
            with self.assertRaises(HtmlExtractionRequestError):
                bind_html_full_request_token_limit(forged, current=current, previous=None,
                    observed_at=OBSERVED, maximum_output_tokens=100,
                    proof=FullRequestTokenLimit('item-one', compiled.request_sha256, 200))
            with self.assertRaises(HtmlExtractionRequestError): parse(output(current), forged, current)

    def test_only_complete_request_token_proof_reaches_unchanged_rights_and_cost_planner(self):
        old = capture('Old wording', 'old', 0); current = capture(); compiled = request(current, old)
        token = proof(compiled, current, old); compared = compare(current, old)
        work = item(current_sha256=current.document.content_sha256, previous_sha256=old.document.content_sha256)
        sources = (PassageSourceBinding('item-one', 'fictional-html'),)
        def planned(value=work, bound=token, source=sources, budget=BUDGET):
            return plan((value,), (compared.change,), (bound,), source_bindings=source, budget=budget).dispatch
        self.assertEqual(planned().reserved_calls, 1)
        self.assertEqual(token.maximum_input_tokens, 200)
        for denied in [replace(work, source_status='candidate'), replace(work, fetch_enabled=False), replace(work, model_processing_allowed=False)]:
            self.assertEqual(planned(denied).reserved_calls, 0)
        self.assertEqual(planned(source=()).reserved_calls, 0)
        self.assertEqual(planned(budget=replace(BUDGET, run_cap_usd=BUDGET.run_spent_and_reserved_usd)).reserved_calls, 0)
        for invalid in [True, 0, -1, 1_000_001, '200']:
            with self.assertRaises(HtmlExtractionRequestError): proof(compiled, current, old, maximum_input=invalid)
        with self.assertRaises(HtmlExtractionRequestError): proof(compiled, current, old, tokens=101)
        with self.assertRaises(HtmlExtractionRequestError): request(current, old, tokens=True)

    def test_structural_proposal_keeps_original_sha_exact_locator_and_unverified_state(self):
        current = capture(); compiled = request(current)
        proposal = parse(output(current), compiled, current)
        self.assertEqual(proposal.review_state, 'unverified')
        self.assertEqual(proposal.source_sha256, sha256(current.raw).hexdigest())
        for change in [dict(source_sha256=sha256(b'New wording').hexdigest()), dict(locator='unselected'),
                       dict(source_version_id='feed-version'), dict(language_code='no')]:
            with self.assertRaises(ModelProposalError): parse(output(current, **change), compiled, current)
        for raw in [b'{"refusal":true}', b'I cannot support this.', output(current)[:-1]+b',"schema_version":1}']:
            with self.assertRaises(ModelProposalError): parse(raw, compiled, current)

    def test_rebinding_refusal_does_not_echo_private_original_or_request(self):
        with self.assertRaises(HtmlExtractionRequestError) as error:
            request(replace(capture(), raw=b'PRIVATE_CANARY /home/private/file'))
        self.assertEqual(str(error.exception), 'html_extraction_request_unavailable')


if __name__ == '__main__': unittest.main()
