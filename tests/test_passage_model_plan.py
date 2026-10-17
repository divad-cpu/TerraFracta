"""A thin offline seam from selected passages to existing exact reservations."""

from dataclasses import replace
from decimal import Decimal
import unittest

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.model_cost_budget import BudgetSnapshot, ModelPrice
from workers.passage_model_plan import PassageChange, PassageSourceBinding, PassageTokenLimit, plan_passage_model_dispatch
from workers.prose_passage_selection import select_changed_passages
from tests.test_prose_passage_selection import passage, snapshot

PRICE = ModelPrice(Decimal("1"), Decimal("1"))
BUDGET = BudgetSnapshot(Decimal("0.001"), Decimal("0.01"), Decimal(0), Decimal(0))
LIMITS = RoutingLimits(5, 5, 1000)


def item(key="item-one", **changes):
    return replace(CapturedWorkItem(key, "approved", True, "a" * 64, "b" * 64,
                   "qualified_prose", True, 900), **changes)


def change(key="item-one", old_text="Old passage.", new_text="New passage.", **changes):
    current = snapshot((passage(text=new_text),), item_key=key)
    previous = snapshot((passage(text=old_text),), item_key=key,
                        content_sha256="b" * 64, source_version_id="version-old")
    return replace(PassageChange(current, previous), **changes)


def proof(value, tokens=100):
    selected = select_changed_passages(value.current, value.previous)
    return PassageTokenLimit(value.current.item_key, selected.payload_sha256, tokens)


def plan(items, changes=(), token_limits=(), budget=BUDGET, source_bindings=None):
    # Independent invented registry binding; never derive source from captures.
    if source_bindings is None:
        source_bindings = tuple(PassageSourceBinding(value.item_key, "source-one") for index, value in enumerate(items)
            if value.item_key not in {earlier.item_key for earlier in items[:index]})
    return plan_passage_model_dispatch(items, LIMITS, changes=changes, token_limits=token_limits,
        source_bindings=source_bindings,
        output_token_limit_per_call=100, price=PRICE, budget=budget)


class PassageModelPlanTests(unittest.TestCase):
    def test_foreign_source_with_equal_item_and_source_bytes_cannot_borrow_registered_work(self):
        foreign = change()
        foreign = replace(foreign, current=replace(foreign.current, source_key="foreign-source"),
                          previous=replace(foreign.previous, source_key="foreign-source"))
        result = plan((item(),), (foreign,), (proof(foreign),))
        self.assertEqual(result.dispatch.items[0].disposition, "held")
        self.assertEqual(result.dispatch.reserved_calls, 0)
        self.assertEqual(result.selections, ())

    def test_changed_selected_payload_uses_its_bound_limit_not_full_document_estimate(self):
        changed = change()
        result = plan((item(),), (changed,), (proof(changed),))
        self.assertEqual(result.dispatch.reserved_calls, 1)
        self.assertEqual(result.dispatch.maximum_reserved_usd, Decimal("0.0002"))
        self.assertEqual(result.dispatch.items[0].disposition, "reserved_model_candidate")
        self.assertEqual(len(result.selections), 1)
        self.assertIn(b"New passage.", result.selections[0].selection.payload)
        self.assertNotIn(b"Old passage.", result.selections[0].selection.payload)

    def test_metadata_only_source_change_consumes_no_model_or_monetary_capacity(self):
        changed = change(old_text="Same passage.", new_text="Same passage.")
        result = plan((item(),), (changed,))
        self.assertEqual(result.dispatch.reserved_calls, 0)
        self.assertEqual(result.dispatch.resulting_budget, BUDGET)
        self.assertEqual(result.dispatch.items[0].disposition, "no_model_work")
        self.assertEqual(result.dispatch.items[0].reason_code, "source_changed_passages_unchanged")

    def test_missing_passage_capture_never_falls_back_to_whole_document_dispatch(self):
        result = plan((item(),))
        self.assertEqual(result.dispatch.items[0].disposition, "held")
        self.assertEqual(result.dispatch.items[0].reason_code, "passage_capture_missing")
        self.assertEqual(result.dispatch.reserved_calls, 0)

    def test_missing_wrong_or_invalid_bound_token_limit_is_deferred_without_paid_work(self):
        changed = change()
        for limits in [(), (replace(proof(changed), payload_sha256="f" * 64),),
                       (proof(changed, True),), (proof(changed, 0),), (proof(changed, 1_000_001),)]:
            with self.subTest(limits=limits):
                result = plan((item(),), (changed,), limits)
                self.assertEqual(result.dispatch.items[0].disposition, "deferred")
                self.assertEqual(result.dispatch.reserved_calls, 0)

    def test_changed_capture_hash_item_or_baseline_mismatch_is_held(self):
        good = change()
        for bad in [replace(good, current=replace(good.current, content_sha256="f" * 64)),
                    replace(good, previous=None),
                    replace(good, previous=replace(good.previous, content_sha256="f" * 64)),
                    replace(good, previous=replace(good.previous, source_key="another-source"))]:
            with self.subTest(bad=bad):
                result = plan((item(),), (bad,))
                self.assertEqual(result.dispatch.items[0].disposition, "held")
                self.assertEqual(result.dispatch.reserved_calls, 0)

    def test_removed_passage_is_held_without_hiding_independent_ready_item(self):
        removed = replace(change(), current=snapshot(()))
        ready = change("second")
        result = plan((item(), item("second")), (removed, ready), (proof(ready),))
        self.assertEqual([r.disposition for r in result.dispatch.items], ["held", "reserved_model_candidate"])
        self.assertEqual(result.dispatch.items[0].reason_code, "passage_removed_or_relocated")

    def test_unchanged_and_structured_source_paths_keep_existing_behavior_without_passages(self):
        result = plan((item("same", previous_sha256="a" * 64), item("structured", extraction_route="structured")), source_bindings=())
        self.assertEqual([r.disposition for r in result.dispatch.items], ["unchanged", "deterministic"])
        self.assertEqual(result.selections, ())

    def test_existing_rights_source_and_item_limit_refusals_are_never_promoted(self):
        changed = change()
        for denied in [item(source_status="candidate"), item(fetch_enabled=False),
                       item(model_processing_allowed=False), item(current_sha256="invalid")]:
            result = plan((denied,), (changed,), (proof(changed),))
            self.assertEqual(result.dispatch.items[0].disposition, "held")
            self.assertEqual(result.dispatch.reserved_calls, 0)
            self.assertEqual(result.selections, ())

    def test_duplicates_and_over_limit_items_retain_original_identity_positions(self):
        changed = change()
        result = plan_passage_model_dispatch((item(), item(), item("later")), RoutingLimits(2, 2, 1000),
            changes=(changed,), token_limits=(proof(changed),), output_token_limit_per_call=100,
            source_bindings=(PassageSourceBinding("item-one", "source-one"),),
            price=PRICE, budget=BUDGET)
        self.assertEqual([r.disposition for r in result.dispatch.items], ["reserved_model_candidate", "held", "deferred"])
        self.assertEqual([r.reason_code for r in result.dispatch.items][1:], ["item_identity_invalid", "item_limit_reached"])

    def test_existing_cost_cap_and_exact_decimal_budget_remain_authoritative(self):
        one, two = change(), change("second")
        budget = replace(BUDGET, run_cap_usd=Decimal("0.0003"))
        result = plan((item(), item("second")), (one, two), (proof(one), proof(two)), budget)
        self.assertEqual([r.disposition for r in result.dispatch.items], ["reserved_model_candidate", "deferred"])
        self.assertEqual(result.dispatch.items[1].reason_code, "run_cost_cap_exceeded")
        self.assertEqual(result.dispatch.maximum_reserved_usd, Decimal("0.0002"))

    def test_equal_texts_in_different_source_items_remain_separate_reservations(self):
        one, two = change(), change("second")
        two = replace(two, current=replace(two.current, source_key="source-two"),
                      previous=replace(two.previous, source_key="source-two"))
        result = plan((item(), item("second")), (one, two), (proof(one), proof(two)),
            source_bindings=(PassageSourceBinding("item-one", "source-one"), PassageSourceBinding("second", "source-two")))
        self.assertEqual(result.dispatch.reserved_calls, 2)
        self.assertNotEqual(result.selections[0].selection.payload_sha256, result.selections[1].selection.payload_sha256)

    def test_foreign_or_duplicate_capture_and_token_records_refuse_scope(self):
        changed = change()
        for changes, limits in [((changed, changed), ()), ((change("foreign"),), ()),
                                ((changed,), (proof(changed), proof(changed)))]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                plan((item(),), changes, limits)

    def test_existing_hash_string_subclass_cannot_bypass_missing_passage_refusal(self):
        class HashText(str):
            pass
        result = plan((item(current_sha256=HashText("a" * 64)),))
        self.assertEqual(result.dispatch.items[0].disposition, "held")
        self.assertEqual(result.dispatch.items[0].reason_code, "passage_capture_missing")
        self.assertEqual(result.dispatch.reserved_calls, 0)

    def test_missing_or_malformed_source_binding_holds_without_selected_text(self):
        changed = change()
        for bindings in [(), (PassageSourceBinding("item-one", ""),),
                         (PassageSourceBinding("item-one", "source-one "),),
                         (PassageSourceBinding("item-one", "\ud800"),)]:
            result = plan((item(),), (changed,), (proof(changed),), source_bindings=bindings)
            self.assertEqual(result.dispatch.items[0].reason_code, "passage_source_binding_missing_or_invalid")
            self.assertEqual(result.dispatch.reserved_calls, 0)
            self.assertEqual(result.selections, ())

    def test_source_binding_refusal_preserves_independent_item_and_original_rights_holds(self):
        one, two = change(), change("second")
        result = plan((item(), item("second")), (one, two), (proof(one), proof(two)),
            source_bindings=(PassageSourceBinding("second", "source-one"),))
        self.assertEqual([row.disposition for row in result.dispatch.items], ["held", "reserved_model_candidate"])
        self.assertEqual([row.item_key for row in result.selections], ["second"])
        denied = plan((item(model_processing_allowed=False),), (one,), (proof(one),), source_bindings=())
        self.assertEqual(denied.dispatch.items[0].reason_code, "model_route_not_qualified")

    def test_foreign_duplicate_or_non_tuple_source_binding_configuration_refuses_scope(self):
        for bindings in [(PassageSourceBinding("foreign", "source-one"),),
                         (PassageSourceBinding("item-one", "source-one"),) * 2, [], (object(),)]:
            with self.subTest(bindings=bindings), self.assertRaises(ValueError):
                plan((item(),), source_bindings=bindings)


if __name__ == "__main__":
    unittest.main()
