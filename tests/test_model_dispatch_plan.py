"""Offline integration checks for routing and worst-case cost bounds."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import unittest

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.model_cost_budget import BudgetSnapshot, ModelPrice
from workers.model_dispatch_plan import plan_model_dispatch


def item(key: str, route: str = "qualified_prose") -> CapturedWorkItem:
    return CapturedWorkItem(
        item_key=key, source_status="approved", fetch_enabled=True,
        current_sha256="a" * 64, previous_sha256="b" * 64,
        extraction_route=route, model_processing_allowed=True,
        estimated_model_input_tokens=2_000,
    )


LIMITS = RoutingLimits(max_items=5, max_model_items=5, max_model_input_tokens=10_000)
PRICE = ModelPrice(Decimal("0.10"), Decimal("0.50"))
BUDGET = BudgetSnapshot(
    run_cap_usd=Decimal("0.0006"), month_cap_usd=Decimal("0.001"),
    run_spent_and_reserved_usd=Decimal(0),
    month_spent_and_reserved_usd=Decimal(0),
)


class ModelDispatchPlanTests(unittest.TestCase):
    def plan(self, items: tuple[CapturedWorkItem, ...], budget: BudgetSnapshot = BUDGET):
        return plan_model_dispatch(
            items, LIMITS, output_token_limit_per_call=200,
            price=PRICE, budget=budget,
        )

    def test_only_changed_qualified_prose_reserves_cost(self) -> None:
        report = self.plan((
            replace(item("unchanged"), previous_sha256="a" * 64),
            item("structured", "structured"), item("prose"),
        ))
        self.assertEqual([entry.disposition for entry in report.items], [
            "unchanged", "deterministic", "reserved_model_candidate",
        ])
        self.assertEqual(report.reserved_calls, 1)
        self.assertEqual(report.maximum_reserved_usd, Decimal("0.0003"))
        self.assertEqual(report.resulting_budget.run_spent_and_reserved_usd,
                         Decimal("0.0003"))

    def test_sequential_reservations_never_cross_run_cap(self) -> None:
        report = self.plan((item("one"), item("two"), item("three")))
        self.assertEqual([entry.disposition for entry in report.items], [
            "reserved_model_candidate", "reserved_model_candidate", "deferred",
        ])
        self.assertEqual(report.items[2].reason_code, "run_cost_cap_exceeded")
        self.assertEqual(report.maximum_reserved_usd, Decimal("0.0006"))

    def test_month_cap_defers_paid_candidate(self) -> None:
        report = self.plan((item("one"),), replace(
            BUDGET, month_spent_and_reserved_usd=Decimal("0.0008")
        ))
        self.assertEqual(report.items[0].reason_code, "month_cost_cap_exceeded")
        self.assertEqual(report.reserved_calls, 0)

    def test_missing_budget_does_not_block_deterministic_work(self) -> None:
        report = self.plan((item("structured", "structured"), item("prose")),
                           replace(BUDGET, run_cap_usd=None))
        self.assertEqual([entry.disposition for entry in report.items],
                         ["deterministic", "deferred"])
        self.assertEqual(report.items[1].reason_code,
                         "budget_configuration_missing_or_invalid")

    def test_unqualified_prose_never_reserves(self) -> None:
        report = self.plan((replace(item("prose"), model_processing_allowed=False),))
        self.assertEqual(report.items[0].disposition, "held")
        self.assertEqual(report.reserved_calls, 0)


if __name__ == "__main__":
    unittest.main()
