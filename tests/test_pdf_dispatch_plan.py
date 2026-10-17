"""Native invented PDF pairs through shared offline source/route/cost gates."""
from dataclasses import replace
from decimal import Decimal
from hashlib import sha256
import unittest
from unittest.mock import patch

from tests.test_pdf_passage_comparison import capture, NOW
from tests.test_passage_model_plan import item, PRICE, BUDGET, LIMITS
from workers.pdf_dispatch_plan import PdfChangeRequest, PdfDispatchError, plan_pdf_dispatch
from workers.pdf_passage_binding import PdfPageSelection
from workers.pdf_passage_comparison import compare_pdf_passages
from workers.passage_model_plan import PassageSourceBinding, PassageTokenLimit


def document(key='one-item', *, old='Selected old.', new='Selected new.', old_other='Other old.', new_other='Other new.'):
    def keyed(value):
        return replace(value, document=replace(value.document, item_key=key),
                       binding=replace(value.binding, item_key=key))
    return PdfChangeRequest(key, keyed(capture((new, new_other), version=2)),
                            keyed(capture((old, old_other), age=2)))


def work(value, **changes):
    return item(value.item_key, current_sha256=value.current.document.content_sha256,
        previous_sha256=None if value.previous is None else value.previous.document.content_sha256, **changes)


def token(value):
    compared = compare_pdf_passages(value.current, value.previous, observed_at=NOW)
    # An invented independently supplied upper bound for this exact selected
    # payload, not a tokenizer/provider observation or a full-request proof.
    return PassageTokenLimit(value.item_key, compared.selection.payload_sha256, 200)


def plan(items, documents, tokens=(), *, sources=None, budget=BUDGET, limits=LIMITS, price=PRICE):
    if sources is None:
        sources = tuple(PassageSourceBinding(key, 'invented-pdf') for key in dict.fromkeys(i.item_key for i in items))
    return plan_pdf_dispatch(items, limits, documents=documents, source_bindings=sources, token_limits=tokens,
        output_token_limit_per_call=100, price=price, budget=budget, observed_at=NOW)


class PdfDispatchPlanTests(unittest.TestCase):
    def test_two_complete_pairs_keep_separate_comparisons_and_shared_exact_budget(self):
        a = document(); b = document('second', new='Independent text.')
        result = plan((work(a), work(b)), (a, b), (token(a), token(b)))
        self.assertEqual(result.passages.dispatch.reserved_calls, 2)
        self.assertEqual(result.passages.dispatch.maximum_reserved_usd, Decimal('0.0006'))
        self.assertEqual([row.item_key for row in result.comparisons], ['one-item', 'second'])
        self.assertEqual(result.comparisons[1].comparison.previous.document, b.previous.document)
        self.assertEqual(result.evidence_state, 'offline_native_pdf_dispatch_plan_only')

    def test_invalid_pair_holds_only_its_item_with_no_whole_document_fallback(self):
        a = document(); b = document('second')
        proof = token(b)
        for bad in (replace(a, current=replace(a.current, raw=b'PRIVATE_CANARY')),
                    replace(a, previous=replace(a.previous, raw=b'PRIVATE_CANARY')),
                    replace(a, previous={})):
            with self.subTest(prior=bad.previous is not None):
                result = plan((work(a), work(b)), (bad, b), (proof,))
                self.assertEqual([row.disposition for row in result.passages.dispatch.items], ['held', 'reserved_model_candidate'])
                self.assertEqual([row.item_key for row in result.comparison_refusals], ['one-item'])
                self.assertNotIn('PRIVATE_CANARY', repr(result.comparison_refusals))

    def test_changed_unselected_page_consumes_no_model_or_money_capacity(self):
        value = document(old='Same selected.', new='Same selected.')
        result = plan((work(value),), (value,))
        self.assertEqual(result.passages.dispatch.items[0].disposition, 'no_model_work')
        self.assertEqual(result.passages.dispatch.items[0].reason_code, 'source_changed_passages_unchanged')
        self.assertEqual(result.passages.dispatch.reserved_calls, 0)
        self.assertEqual(result.passages.dispatch.resulting_budget, BUDGET)

    def test_source_route_rights_missing_binding_and_budget_gates_remain_authoritative(self):
        value = document(); proof = token(value)
        for denied in (work(value, source_status='candidate'), work(value, fetch_enabled=False),
                       work(value, model_processing_allowed=False), work(value, extraction_route='unqualified_prose')):
            with self.subTest(status=denied.source_status, route=denied.extraction_route):
                self.assertEqual(plan((denied,), (value,), (proof,)).passages.dispatch.reserved_calls, 0)
        self.assertEqual(plan((work(value),), (value,), (proof,), sources=()).passages.dispatch.reserved_calls, 0)
        exhausted = replace(BUDGET, run_cap_usd=BUDGET.run_spent_and_reserved_usd)
        self.assertEqual(plan((work(value),), (value,), (proof,), budget=exhausted).passages.dispatch.reserved_calls, 0)

    def test_missing_pair_proof_limits_and_duplicate_work_keep_existing_dispositions(self):
        a = document(); b = document('second'); proof = token(b)
        self.assertEqual([r.disposition for r in plan((work(a), work(b)), (b,), (proof,)).passages.dispatch.items],
                         ['held', 'reserved_model_candidate'])
        self.assertEqual([r.disposition for r in plan((work(a), work(b)), (a, b), (proof,)).passages.dispatch.items],
                         ['deferred', 'reserved_model_candidate'])
        both = (token(a), proof)
        limited = plan((work(a), work(b)), (a, b), both, limits=replace(LIMITS, max_items=1))
        self.assertEqual(limited.passages.dispatch.reserved_calls, 1)
        repeated = plan((work(b), work(b)), (b,), (proof,))
        self.assertEqual(repeated.passages.dispatch.items[1].reason_code, 'item_identity_invalid')

    def test_other_item_cannot_lend_equal_source_text_or_token_to_this_outer_identity(self):
        a = document(); b = document('second')
        borrowed = replace(a, current=b.current, previous=b.previous)
        result = plan((work(a),), (borrowed,), (replace(token(b), item_key=a.item_key),))
        self.assertEqual(result.passages.dispatch.reserved_calls, 0)
        self.assertEqual(result.comparisons, ())
        self.assertEqual(result.comparison_refusals[0].item_key, a.item_key)

    def test_all_pending_pair_metadata_are_captured_before_first_worker_callback(self):
        from workers.pdf_text_inspection import inspect_pdf_bytes as real_inspect
        a = document(); b = document('second')
        different = PdfPageSelection('selected-page', 2, sha256(b'Other old.').hexdigest())
        b = replace(b, previous=replace(b.previous, mapping=replace(b.previous.mapping, selections=(different,))))
        proof = token(a); calls = []
        def inspector(*args, **kwargs):
            calls.append(True)
            if len(calls) == 1:
                object.__setattr__(b.previous.mapping, 'selections', (PdfPageSelection(
                    'selected-page', 1, sha256(b'Selected old.').hexdigest()),))
                object.__setattr__(b, 'item_key', 'foreign')
            return real_inspect(*args, **kwargs)
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=inspector):
            result = plan((work(a), work(b)), (a, b), (proof,))
        self.assertEqual(result.passages.dispatch.reserved_calls, 1)
        self.assertEqual([row.item_key for row in result.comparison_refusals], ['second'])

    def test_source_and_cost_assertions_do_not_change_at_native_callback(self):
        from workers.pdf_text_inspection import inspect_pdf_bytes as real_inspect
        value = document(); proof = token(value)
        denied = work(value, source_status='candidate')
        exhausted = replace(BUDGET, run_cap_usd=BUDGET.run_spent_and_reserved_usd)
        limits = replace(LIMITS); price = replace(PRICE)
        source = PassageSourceBinding(value.item_key, 'unbound-source')
        for mode in ('source_status', 'budget', 'source_binding', 'input_tokens'):
            current_work = replace(denied if mode == 'source_status' else work(value))
            current_budget = replace(exhausted if mode == 'budget' else BUDGET)
            current_source = replace(source if mode == 'source_binding' else PassageSourceBinding(value.item_key, 'invented-pdf'))
            current_proof = replace(proof, maximum_input_tokens=0) if mode == 'input_tokens' else replace(proof)
            def inspector(*args, **kwargs):
                object.__setattr__(current_work, 'source_status', 'approved')
                object.__setattr__(current_budget, 'run_cap_usd', BUDGET.run_cap_usd)
                object.__setattr__(current_source, 'source_key', 'invented-pdf')
                object.__setattr__(current_proof, 'maximum_input_tokens', 200)
                return real_inspect(*args, **kwargs)
            with self.subTest(mode=mode), patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=inspector):
                result = plan((current_work,), (value,), (current_proof,), sources=(current_source,),
                              budget=current_budget, limits=limits, price=price)
                self.assertEqual(result.passages.dispatch.reserved_calls, 0)

    def test_invalid_outer_identity_and_mutable_context_refuse_before_any_native_work(self):
        value = document(); source = PassageSourceBinding(value.item_key, 'invented-pdf')
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No worker')) as inspector:
            for docs in ((value, value), (replace(value, item_key='foreign'),), ({},), [value]):
                with self.assertRaisesRegex(PdfDispatchError, '^pdf_dispatch_scope_invalid$'):
                    plan((work(value),), docs)
            bad_price = replace(PRICE, input_usd_per_million=[])
            with self.assertRaises(PdfDispatchError):
                plan((work(value),), (value,), sources=(source,), price=bad_price)
            inspector.assert_not_called()

    def test_pre_capture_and_later_inspection_refusals_preserve_document_order(self):
        a = document(); b = document('second')
        bad_a = replace(a, current=replace(a.current, raw=b'%PDF-invalid',
            document=replace(a.current.document, content_sha256=sha256(b'%PDF-invalid').hexdigest()),
            binding=replace(a.current.binding, content_sha256=sha256(b'%PDF-invalid').hexdigest()),
            mapping=replace(a.current.mapping, content_sha256=sha256(b'%PDF-invalid').hexdigest())))
        bad_b = replace(b, previous={})
        result = plan((work(a), work(b)), (bad_a, bad_b))
        self.assertEqual([row.item_key for row in result.comparison_refusals], ['one-item', 'second'])
        self.assertEqual(result.passages.dispatch.reserved_calls, 0)
