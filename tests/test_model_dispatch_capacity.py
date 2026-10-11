"""Rejected monetary proposals cannot spend the offline paid-work capacity."""
from dataclasses import replace
from decimal import Decimal
import unittest

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.model_cost_budget import BudgetSnapshot, ModelPrice
from workers.model_dispatch_plan import plan_model_dispatch


def item(key: str, tokens: int = 1) -> CapturedWorkItem:
    return CapturedWorkItem(key, "approved", True, "a" * 64, "b" * 64,
                            "qualified_prose", True, tokens)


def plan(items, limits, *, run_cap="0.000001", month_cap="0.000001"):
    return plan_model_dispatch(
        items, limits, output_token_limit_per_call=1,
        price=ModelPrice(Decimal(1), Decimal(0)),
        budget=BudgetSnapshot(Decimal(run_cap), Decimal(month_cap), Decimal(0), Decimal(0)),
    )


class ModelDispatchCapacityTests(unittest.TestCase):
    def test_run_rejection_leaves_call_slot_for_later_eligible_item(self):
        report = plan((item("expensive", 1000), item("small")), RoutingLimits(2, 1, 1001))
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["run_cost_cap_exceeded", "reserved"])
        self.assertEqual(report.reserved_calls, 1)
        self.assertEqual(report.maximum_reserved_usd, Decimal("0.000001"))

    def test_run_rejection_leaves_input_tokens_for_later_eligible_item(self):
        report = plan((item("expensive", 1000), item("small", 50)),
                      RoutingLimits(2, 2, 1000), run_cap="0.00005", month_cap="0.00005")
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["run_cost_cap_exceeded", "reserved"])
        self.assertEqual(report.resulting_budget.run_spent_and_reserved_usd, Decimal("0.00005"))

    def test_month_rejection_does_not_take_later_call_slot(self):
        report = plan((item("expensive", 1000), item("small")), RoutingLimits(2, 1, 1001),
                      run_cap="1")
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["month_cost_cap_exceeded", "reserved"])
        self.assertEqual(report.reserved_calls, 1)

    def test_invalid_per_call_tokens_do_not_take_later_call_slot(self):
        report = plan((item("invalid", 1_000_001), item("small")),
                      RoutingLimits(2, 1, 1_000_002))
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["budget_configuration_missing_or_invalid", "reserved"])
        self.assertEqual(report.reserved_calls, 1)

    def test_successful_calls_still_consume_item_and_input_limits(self):
        for limits in (RoutingLimits(3, 1, 100), RoutingLimits(3, 3, 1)):
            with self.subTest(limits=limits):
                report = plan((item("first"), item("second"), item("table")), limits,
                              run_cap="1", month_cap="1")
                self.assertEqual([entry.disposition for entry in report.items],
                                 ["reserved_model_candidate", "deferred", "deferred"])
                self.assertEqual(report.reserved_calls, 1)
                self.assertEqual(report.items[1].reason_code, "model_limit_reached")

    def test_overall_item_bound_is_not_refunded(self):
        report = plan((item("expensive", 1000), item("small")), RoutingLimits(1, 1, 1001))
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["run_cost_cap_exceeded", "item_limit_reached"])
        self.assertEqual(report.reserved_calls, 0)

    def test_duplicate_identity_is_not_refunded(self):
        report = plan((item("same", 1000), item("same"), item("other")), RoutingLimits(3, 1, 1002))
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["run_cost_cap_exceeded", "item_identity_invalid", "reserved"])
        self.assertEqual(report.reserved_calls, 1)

    def test_rejected_prose_does_not_interfere_with_deterministic_item(self):
        report = plan((item("expensive", 1000), replace(item("table"), extraction_route="structured"),
                       item("small")), RoutingLimits(3, 1, 1001))
        self.assertEqual([entry.disposition for entry in report.items],
                         ["deferred", "deterministic", "reserved_model_candidate"])

    def test_missing_money_configuration_still_defers_all_paid_work(self):
        report = plan_model_dispatch((item("first"), item("second")), RoutingLimits(2, 1, 2),
            output_token_limit_per_call=1, price=ModelPrice(None, Decimal(0)),
            budget=BudgetSnapshot(Decimal(1), Decimal(1), Decimal(0), Decimal(0)))
        self.assertEqual(report.reserved_calls, 0)
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["budget_configuration_missing_or_invalid"] * 2)
        self.assertEqual(report.maximum_reserved_usd, Decimal(0))


if __name__ == "__main__":
    unittest.main()
