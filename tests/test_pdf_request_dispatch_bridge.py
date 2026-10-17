"""One invented PDF chain: originals -> full request -> offline plan -> proposal.

Token bounds, prices, approvals and output below are explicitly invented caller
assertions, not provider usage, lawful source qualification or accepted content.
"""
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
import json
import unittest

from tests.test_pdf_dispatch_plan import document, work
from tests.test_pdf_passage_comparison import NOW
from workers.change_work_router import RoutingLimits
from workers.model_cost_budget import ModelPrice, BudgetSnapshot
from workers.pdf_dispatch_plan import plan_pdf_dispatch
from workers.pdf_extraction_request import (
    compile_pdf_extraction_request, bind_pdf_full_request_token_limit,
    parse_pdf_extraction_proposal, PdfExtractionRequestError,
)
from workers.passage_extraction_request import FullRequestTokenLimit
from workers.passage_model_plan import PassageSourceBinding

# Invented inputs for arithmetic only; no project/provider budget is accepted.
PRICE = ModelPrice(Decimal('1'), Decimal('1'))
BUDGET = BudgetSnapshot(Decimal('1'), Decimal('2'), Decimal('0'), Decimal('0'))
LIMITS = RoutingLimits(3, 3, 30000)


def compile(value):
    return compile_pdf_extraction_request(value.current, value.previous,
        observed_at=NOW, maximum_output_tokens=100)


def proof(request, value):
    return bind_pdf_full_request_token_limit(request, current=value.current, previous=value.previous,
        observed_at=NOW, maximum_output_tokens=100,
        proof=FullRequestTokenLimit(value.item_key, request.request_sha256, 10000))


def plan(value, tokens=()):
    return plan_pdf_dispatch((work(value),), LIMITS, documents=(value,),
        source_bindings=(PassageSourceBinding(value.item_key, 'invented-pdf'),), token_limits=tokens,
        output_token_limit_per_call=100, price=PRICE, budget=BUDGET, observed_at=NOW)


class PdfRequestDispatchBridgeTests(unittest.TestCase):
    def test_exact_complete_request_bound_proof_reaches_shared_plan_and_unverified_proposal(self):
        value = document(old='Invented previous evidence.', new='Invented current evidence.',
                         new_other='UNSELECTED_PAGE_CANARY')
        request = compile(value); token = proof(request, value); result = plan(value, (token,))
        self.assertEqual(result.passages.dispatch.reserved_calls, 1)
        self.assertEqual(result.passages.dispatch.maximum_reserved_usd, Decimal('0.0101'))
        self.assertEqual(token.maximum_input_tokens, 10000)
        self.assertEqual(token.payload_sha256, request.selected_payload_sha256)
        self.assertNotIn(b'UNSELECTED_PAGE_CANARY', request.body)
        body = json.loads(request.body)
        self.assertEqual(body['selected_payload']['content_sha256'], value.current.document.content_sha256)
        bound = result.comparisons[0].comparison.current
        self.assertEqual(body['pdf_provenance']['current_derivation_sha256'], bound.derivation_manifest_sha256)
        self.assertEqual(body['pdf_provenance']['current_inspection_sha256'], bound.inspection_report_sha256)
        self.assertFalse(body['pdf_provenance']['table_qualification_established'])
        raw = json.dumps(dict(schema_version=1, source_version_id=value.current.document.source_version_id,
            source_sha256=value.current.document.content_sha256, language_code='en', locator='selected-page',
            proposed_claim_type='condition', proposed_assertion='An invented statement from selected native page text.',
            source_date_text=None)).encode()
        proposed = parse_pdf_extraction_proposal(raw, request, current=value.current, previous=value.previous,
            observed_at=NOW, maximum_output_tokens=100)
        self.assertEqual(proposed.review_state, 'unverified')
        self.assertEqual(proposed.locator, 'selected-page')
        self.assertEqual(proposed.source_sha256, value.current.document.content_sha256)

    def test_changed_unselected_text_has_neither_request_nor_cost_reservation(self):
        value = document(old='Same selected evidence.', new='Same selected evidence.')
        with self.assertRaises(PdfExtractionRequestError):compile(value)
        result = plan(value)
        self.assertEqual(result.passages.dispatch.items[0].disposition, 'no_model_work')
        self.assertEqual(result.passages.dispatch.maximum_reserved_usd, Decimal(0))
        self.assertEqual(result.passages.dispatch.resulting_budget, BUDGET)

    def test_equal_payload_does_not_let_old_full_request_receipt_proof_authorize_new_envelope(self):
        value = document(); before = compile(value)
        changed_date = value.current.document.retrieved_at + timedelta(microseconds=1)
        changed_current = replace(value.current,
            document=replace(value.current.document, retrieved_at=changed_date),
            binding=replace(value.current.binding, retrieved_at=changed_date))
        changed = replace(value, current=changed_current)
        after = compile(changed)
        self.assertEqual(before.selected_payload_sha256, after.selected_payload_sha256)
        self.assertNotEqual(before.request_sha256, after.request_sha256)
        with self.assertRaises(PdfExtractionRequestError):
            bind_pdf_full_request_token_limit(after, current=changed.current, previous=changed.previous,
                observed_at=NOW, maximum_output_tokens=100,
                proof=FullRequestTokenLimit(changed.item_key, before.request_sha256, 10000))
        result = plan(changed)
        self.assertEqual(result.passages.dispatch.reserved_calls, 0)
        self.assertEqual(result.passages.dispatch.items[0].disposition, 'deferred')
