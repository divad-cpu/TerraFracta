"""New supplied-HTML batch composition; the existing routing engine is reused."""
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
import unittest

from tests.test_html_passage_comparison import capture, OBSERVED
from tests.test_passage_model_plan import item, PRICE, BUDGET, LIMITS
from workers.html_dispatch_plan import HtmlChangeRequest, HtmlDispatchError, plan_html_dispatch
from workers.html_extraction_request import compile_html_extraction_request, bind_html_full_request_token_limit
from workers.passage_extraction_request import FullRequestTokenLimit
from workers.passage_model_plan import PassageSourceBinding


def document(key='item-one', old='Old wording', new='New wording', prefix=''):
    def keyed(value):
        return replace(value, document=replace(value.document, item_key=key), binding=replace(value.binding, item_key=key))
    return HtmlChangeRequest(key, keyed(capture(new, 'new-'+key, 1, prefix)), keyed(capture(old, 'old-'+key, 0)))


def work(value, **changes):
    return item(value.item_key, current_sha256=value.current.document.content_sha256,
        previous_sha256=None if value.previous is None else value.previous.document.content_sha256, **changes)


def token(value):
    request = compile_html_extraction_request(value.current, value.previous, observed_at=OBSERVED, maximum_output_tokens=100)
    return bind_html_full_request_token_limit(request, current=value.current, previous=value.previous,
        observed_at=OBSERVED, maximum_output_tokens=100,
        proof=FullRequestTokenLimit(value.item_key, request.request_sha256, 200))


def plan(items, documents, tokens=(), sources=None, budget=BUDGET, limits=LIMITS):
    if sources is None: sources = tuple(PassageSourceBinding(key, 'fictional-html') for key in dict.fromkeys(i.item_key for i in items))
    return plan_html_dispatch(items, limits, documents=documents, source_bindings=sources, token_limits=tokens,
        output_token_limit_per_call=100, price=PRICE, budget=budget, observed_at=OBSERVED)


class HtmlDispatchPlanTests(unittest.TestCase):
    def test_two_independent_original_pairs_keep_exact_payloads_and_shared_cost_accounting(self):
        a = document(); b = document('second', new='Other wording')
        result = plan((work(a), work(b)), (a, b), (token(a), token(b)))
        self.assertEqual(result.passages.dispatch.reserved_calls, 2)
        self.assertEqual(result.passages.dispatch.maximum_reserved_usd, Decimal('0.0006'))
        self.assertEqual([r.item_key for r in result.comparisons], ['item-one', 'second'])
        self.assertEqual(result.comparisons[0].comparison.current.document, a.current.document)
        self.assertEqual(result.comparisons[1].comparison.previous.document, b.previous.document)
        self.assertEqual(result.evidence_state, 'offline_html_dispatch_plan_only')

    def test_bad_current_or_prior_original_holds_only_its_item_without_whole_document_fallback(self):
        a = document(); b = document('second')
        for bad in [replace(a, current=replace(a.current, raw=b'PRIVATE_CANARY')),
                    replace(a, previous=replace(a.previous, raw=b'PRIVATE_CANARY')),
                    replace(a, previous={})]:
            result = plan((work(a), work(b)), (bad, b), (token(b),))
            self.assertEqual([row.disposition for row in result.passages.dispatch.items], ['held', 'reserved_model_candidate'])
            self.assertEqual(result.passages.dispatch.reserved_calls, 1)
            self.assertEqual([r.item_key for r in result.comparison_refusals], ['item-one'])
            self.assertNotIn('PRIVATE_CANARY', repr(result.comparison_refusals))

    def test_outer_item_cannot_borrow_equal_source_or_passages_from_another_item(self):
        a = document(); b = document('second')
        bad = replace(a, current=b.current, previous=b.previous)
        result = plan((work(a),), (bad,), (replace(token(b), item_key='item-one'),))
        self.assertEqual(result.passages.dispatch.reserved_calls, 0)
        self.assertEqual(result.comparisons, ())
        self.assertEqual(result.comparison_refusals[0].item_key, 'item-one')

    def test_missing_pair_and_missing_full_request_proof_preserve_other_ready_items(self):
        a = document(); b = document('second')
        missing = plan((work(a), work(b)), (b,), (token(b),))
        self.assertEqual([r.disposition for r in missing.passages.dispatch.items], ['held', 'reserved_model_candidate'])
        unbounded = plan((work(a), work(b)), (a, b), (token(b),))
        self.assertEqual([r.disposition for r in unbounded.passages.dispatch.items], ['deferred', 'reserved_model_candidate'])

    def test_markup_only_change_uses_no_model_or_monetary_capacity(self):
        value = document(old='Same text', new='<em>Same text</em>', prefix='<nav>Different wrapping</nav>')
        result = plan((work(value),), (value,))
        self.assertEqual(result.passages.dispatch.items[0].disposition, 'no_model_work')
        self.assertEqual(result.passages.dispatch.items[0].reason_code, 'source_changed_passages_unchanged')
        self.assertEqual(result.passages.dispatch.reserved_calls, 0)
        self.assertEqual(result.passages.dispatch.resulting_budget, BUDGET)

    def test_existing_source_rights_route_budget_and_order_gates_remain_authoritative(self):
        a = document(); b = document('second'); proof = token(a)
        for denied in [work(a, source_status='candidate'), work(a, fetch_enabled=False), work(a, model_processing_allowed=False)]:
            self.assertEqual(plan((denied,), (a,), (proof,)).passages.dispatch.reserved_calls, 0)
        self.assertEqual(plan((work(a),), (a,), (proof,), sources=()).passages.dispatch.reserved_calls, 0)
        self.assertEqual(plan((work(a),), (a,), (proof,), budget=replace(BUDGET, run_cap_usd=BUDGET.run_spent_and_reserved_usd)).passages.dispatch.reserved_calls, 0)
        limited = plan((work(a), work(b)), (a, b), (proof, token(b)), limits=replace(LIMITS, max_items=1))
        self.assertEqual(limited.passages.dispatch.reserved_calls, 1)
        duplicate = plan((work(a), work(a)), (a,), (proof,))
        self.assertEqual(duplicate.passages.dispatch.reserved_calls, 1)
        self.assertEqual(duplicate.passages.dispatch.items[1].disposition, 'held')
        self.assertEqual(duplicate.passages.dispatch.items[1].reason_code, 'item_identity_invalid')

    def test_batch_identity_errors_do_not_silently_drop_or_duplicate_requests(self):
        a = document()
        for docs in [(a, a), (replace(a, item_key='foreign'),), ({},), [a]]:
            with self.assertRaises(HtmlDispatchError): plan((work(a),), docs)


if __name__ == '__main__': unittest.main()
