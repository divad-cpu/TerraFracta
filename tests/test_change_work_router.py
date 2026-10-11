"""Offline routing cases for cost and coverage accounting."""

from __future__ import annotations

from dataclasses import replace
import unittest

from workers.change_work_router import (
    CapturedWorkItem,
    RoutingLimits,
    route_captured_changes,
)


def item(key: str, *, route: str = "qualified_prose") -> CapturedWorkItem:
    return CapturedWorkItem(
        item_key=key,
        source_status="approved",
        fetch_enabled=True,
        current_sha256="a" * 64,
        previous_sha256="b" * 64,
        extraction_route=route,
        model_processing_allowed=True,
        estimated_model_input_tokens=120,
    )


LIMITS = RoutingLimits(max_items=6, max_model_items=2, max_model_input_tokens=240)


class ChangeWorkRouterTests(unittest.TestCase):
    def test_unchanged_and_structured_items_use_no_model_budget(self) -> None:
        plan = route_captured_changes((
            replace(item("same"), previous_sha256="a" * 64),
            item("table", route="structured"),
        ), LIMITS)
        self.assertEqual([entry.disposition for entry in plan.items], ["unchanged", "deterministic"])
        self.assertEqual(plan.model_items, 0)
        self.assertEqual(plan.estimated_model_input_tokens, 0)

    def test_only_changed_qualified_prose_is_model_candidate(self) -> None:
        plan = route_captured_changes((
            item("first"),
            replace(item("unqualified"), extraction_route="unqualified"),
            replace(item("forbidden"), model_processing_allowed=False),
        ), LIMITS)
        self.assertEqual([entry.disposition for entry in plan.items],
                         ["model_candidate", "held", "held"])
        self.assertEqual(plan.estimated_model_input_tokens, 120)

    def test_missing_model_limits_defer_only_model_work(self) -> None:
        plan = route_captured_changes((
            item("table", route="structured"), item("prose"),
        ), RoutingLimits(max_items=2, max_model_items=None, max_model_input_tokens=None))
        self.assertEqual([entry.disposition for entry in plan.items],
                         ["deterministic", "deferred"])
        self.assertEqual(plan.items[1].reason_code, "model_limit_reached")

    def test_token_limit_defers_later_item_without_losing_coverage(self) -> None:
        plan = route_captured_changes((item("one"), item("two"), item("three")),
                                      RoutingLimits(3, 3, 240))
        self.assertEqual([entry.disposition for entry in plan.items],
                         ["model_candidate", "model_candidate", "deferred"])
        self.assertEqual(plan.estimated_model_input_tokens, 240)
        self.assertEqual(plan.model_items, 2)

    def test_unapproved_and_invalid_hashes_hold(self) -> None:
        plan = route_captured_changes((
            replace(item("unapproved"), source_status="candidate"),
            replace(item("invalid"), current_sha256="wrong"),
        ), LIMITS)
        self.assertEqual([entry.reason_code for entry in plan.items],
                         ["source_not_enabled", "hash_invalid"])

    def test_duplicate_key_and_item_limit_are_explicit(self) -> None:
        plan = route_captured_changes((item("one"), item("one"), item("two")),
                                      RoutingLimits(2, 1, 120))
        self.assertEqual([entry.disposition for entry in plan.items],
                         ["model_candidate", "held", "deferred"])
        self.assertEqual(plan.items[1].reason_code, "item_identity_invalid")
        self.assertEqual(plan.items[2].reason_code, "item_limit_reached")

    def test_wrong_runtime_types_cannot_become_model_work(self) -> None:
        plan = route_captured_changes((
            replace(item("bad-fetch"), fetch_enabled="yes"),
            replace(item("bad-hash"), current_sha256=123),
            replace(item("bad-consent"), model_processing_allowed="yes"),
            replace(item("bad-tokens"), estimated_model_input_tokens=True),
        ), RoutingLimits(4, 4, 500))
        self.assertEqual([entry.disposition for entry in plan.items],
                         ["held", "held", "held", "deferred"])
        self.assertEqual(plan.model_items, 0)


if __name__ == "__main__":
    unittest.main()
