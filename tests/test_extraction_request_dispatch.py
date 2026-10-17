"""A matching complete request/output ceiling through existing offline gates."""
from dataclasses import replace
from decimal import Decimal
import unittest
from tests.test_document_dispatch_plan import document, work
from tests.test_passage_extraction_request import request, NOW
from tests.test_passage_model_plan import PRICE, BUDGET, LIMITS
from workers.extraction_request_dispatch import ExtractionDispatchError, plan_extraction_request_dispatch
from workers.passage_extraction_request import FullRequestTokenLimit
from workers.passage_model_plan import PassageSourceBinding


def proof(compiled, tokens=200):
    return FullRequestTokenLimit(compiled.item_key, compiled.request_sha256, tokens)


def plan(items, docs, requests, proofs, *, ceiling=100, sources=None, budget=BUDGET):
    if sources is None:
        sources = tuple(PassageSourceBinding(key, 'source-one') for key in dict.fromkeys(item.item_key for item in items))
    return plan_extraction_request_dispatch(items, LIMITS, documents=docs, requests=requests,
        token_limits=proofs, source_bindings=sources, maximum_output_tokens=ceiling,
        price=PRICE, budget=budget, observed_at=NOW)


class ExtractionRequestDispatchTests(unittest.TestCase):
    def test_one_complete_request_binds_both_token_ceilings_and_existing_exact_budget(self):
        doc = document(); compiled = request(doc)
        result = plan((work(doc),), (doc,), (compiled,), (proof(compiled),))
        self.assertEqual(result.requests, (compiled,))
        self.assertEqual(result.documents.passages.dispatch.maximum_reserved_usd, Decimal('0.0003'))
        self.assertEqual(result.request_refusals, ())
        self.assertEqual(result.evidence_state, 'offline_full_request_dispatch_plan_only')

    def test_lower_or_higher_planner_output_ceiling_cannot_borrow_existing_bound_request(self):
        doc = document(); compiled = request(doc)
        for ceiling in [1, 99, 101, 1000000]:
            result = plan((work(doc),), (doc,), (compiled,), (proof(compiled),), ceiling=ceiling)
            self.assertEqual(result.requests, ())
            self.assertEqual(result.documents.passages.dispatch.reserved_calls, 0)
            self.assertEqual(result.request_refusals[0].reason_code, 'extraction_request_or_proof_mismatch')

    def test_invalid_or_missing_first_request_keeps_independent_second_candidate(self):
        a = document(); b = document('second', new='Independent'); ar = request(a); br = request(b)
        variants = [((replace(ar, body=b'forged'), br), (proof(ar), proof(br))),
                    ((ar, br), (replace(proof(ar), request_sha256='f'*64), proof(br))),
                    ((br,), (proof(br),)), ((ar, br), (proof(br),))]
        for requests, proofs in variants:
            result = plan((work(a), work(b)), (a, b), requests, proofs)
            self.assertEqual(result.requests, (br,))
            self.assertEqual(result.documents.passages.dispatch.reserved_calls, 1)
            self.assertEqual(result.documents.passages.dispatch.items[0].disposition, 'deferred')

    def test_source_rights_budget_and_work_hash_refusals_cannot_return_request(self):
        doc = document(); compiled = request(doc)
        for denied in [work(doc, source_status='candidate'), work(doc, fetch_enabled=False),
                       work(doc, model_processing_allowed=False), work(doc, current_sha256='f'*64)]:
            result = plan((denied,), (doc,), (compiled,), (proof(compiled),))
            self.assertEqual(result.requests, ()); self.assertEqual(result.documents.passages.dispatch.reserved_calls, 0)
        for sources, budget in [((), BUDGET), ((PassageSourceBinding(doc.item_key, 'foreign'),), BUDGET),
                                (None, replace(BUDGET, run_cap_usd=Decimal(0)))]:
            result = plan((work(doc),), (doc,), (compiled,), (proof(compiled),), sources=sources, budget=budget)
            self.assertEqual(result.requests, ())

    def test_bad_original_document_prevents_request_and_preserves_separate_comparison_refusal(self):
        doc = document(); compiled = request(doc); broken = replace(doc, previous=replace(doc.previous, raw=b'foreign'))
        result = plan((work(doc),), (broken,), (compiled,), (proof(compiled),))
        self.assertEqual(result.requests, ())
        self.assertEqual(len(result.request_refusals), 1)
        self.assertEqual(len(result.documents.comparison_refusals), 1)
        self.assertEqual(result.documents.passages.dispatch.items[0].disposition, 'held')

    def test_existing_unchanged_structured_and_duplicate_routes_are_preserved(self):
        doc = document(); compiled = request(doc)
        for item, expected in [(work(doc, previous_sha256=doc.current.document.content_sha256), 'unchanged'),
                               (work(doc, extraction_route='structured'), 'deterministic')]:
            result = plan((item,), (doc,), (compiled,), (proof(compiled),))
            self.assertEqual(result.requests, ())
            self.assertEqual(result.documents.passages.dispatch.items[0].disposition, expected)
        result = plan((work(doc), work(doc)), (doc,), (compiled,), (proof(compiled),))
        self.assertEqual(result.requests, (compiled,))
        self.assertEqual([item.disposition for item in result.documents.passages.dispatch.items], ['reserved_model_candidate', 'held'])

    def test_unknown_duplicate_untyped_and_list_scope_refuse_before_partial_plan(self):
        doc = document(); compiled = request(doc); token = proof(compiled)
        variants = [([doc], (compiled,), (token,)), ((doc, doc), (compiled,), (token,)),
                    ((doc,), (compiled, compiled), (token,)), ((doc,), (compiled,), (token, token)),
                    ((doc,), (replace(compiled, item_key='foreign'),), (token,)),
                    ((doc,), (compiled,), (replace(token, item_key='foreign'),)), ((None,), (compiled,), (token,))]
        for docs, requests, proofs in variants:
            with self.assertRaises(ExtractionDispatchError): plan((work(doc),), docs, requests, proofs)
        for ceiling in [None, True, 0, -1, 1000001]:
            with self.assertRaises(ExtractionDispatchError): plan((work(doc),), (doc,), (compiled,), (token,), ceiling=ceiling)

    def test_envelope_without_document_is_held_and_cannot_select_unrecorded_bytes(self):
        doc = document(); compiled = request(doc)
        result = plan((work(doc),), (), (compiled,), (proof(compiled),))
        self.assertEqual(result.requests, ())
        self.assertEqual(result.documents.passages.dispatch.items[0].disposition, 'held')
        self.assertEqual(result.request_refusals[0].reason_code, 'extraction_request_or_proof_missing')


if __name__ == '__main__': unittest.main()
