"""Worst-case token reservations keep paid work within configured caps."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import unittest

from workers.model_cost_budget import BudgetSnapshot, ModelPrice, reserve_model_call


PRICE = ModelPrice(Decimal("0.10"), Decimal("0.50"))
BUDGET = BudgetSnapshot(
    run_cap_usd=Decimal("0.01"), month_cap_usd=Decimal("0.02"),
    run_spent_and_reserved_usd=Decimal("0"),
    month_spent_and_reserved_usd=Decimal("0"),
)


class ModelCostBudgetTests(unittest.TestCase):
    def test_exact_worst_case_reservation(self) -> None:
        result = reserve_model_call(
            input_token_limit=2000, output_token_limit=200,
            price=PRICE, budget=BUDGET,
        )
        self.assertTrue(result.allowed)
        self.assertEqual(result.maximum_call_usd, Decimal("0.0003"))
        self.assertEqual(result.next_run_reserved_usd, Decimal("0.0003"))

    def test_missing_cap_fails_closed(self) -> None:
        result = reserve_model_call(
            input_token_limit=2000, output_token_limit=200,
            price=PRICE, budget=replace(BUDGET, month_cap_usd=None),
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason_code, "budget_configuration_missing_or_invalid")

    def test_run_and_month_caps_are_separate(self) -> None:
        near_run = replace(BUDGET, run_spent_and_reserved_usd=Decimal("0.0098"))
        self.assertEqual(reserve_model_call(
            input_token_limit=2000, output_token_limit=200,
            price=PRICE, budget=near_run,
        ).reason_code, "run_cost_cap_exceeded")
        near_month = replace(BUDGET, month_spent_and_reserved_usd=Decimal("0.0198"))
        self.assertEqual(reserve_model_call(
            input_token_limit=2000, output_token_limit=200,
            price=PRICE, budget=near_month,
        ).reason_code, "month_cost_cap_exceeded")

    def test_exact_cap_is_allowed_and_overage_is_blocked(self) -> None:
        exact = replace(BUDGET, run_cap_usd=Decimal("0.0003"),
                        month_cap_usd=Decimal("0.0003"))
        self.assertTrue(reserve_model_call(
            input_token_limit=2000, output_token_limit=200,
            price=PRICE, budget=exact,
        ).allowed)
        too_small = replace(exact, month_cap_usd=Decimal("0.000299"))
        self.assertEqual(reserve_model_call(
            input_token_limit=2000, output_token_limit=200,
            price=PRICE, budget=too_small,
        ).reason_code, "month_cost_cap_exceeded")

    def test_invalid_rates_or_limits_do_not_reserve(self) -> None:
        for input_limit, price in ((0, PRICE), (10, ModelPrice(Decimal("NaN"), Decimal("0.5")))):
            result = reserve_model_call(
                input_token_limit=input_limit, output_token_limit=200,
                price=price, budget=BUDGET,
            )
            self.assertFalse(result.allowed)
            self.assertIsNone(result.next_run_reserved_usd)

    def test_wrong_runtime_types_fail_closed(self) -> None:
        for input_limit, price, budget in (
            (True, PRICE, BUDGET),
            ("2000", PRICE, BUDGET),
            (2000, ModelPrice("0.1", Decimal("0.5")), BUDGET),
            (2000, PRICE, replace(BUDGET, run_cap_usd="0.01")),
        ):
            result = reserve_model_call(
                input_token_limit=input_limit, output_token_limit=200,
                price=price, budget=budget,
            )
            self.assertFalse(result.allowed)
            self.assertEqual(result.reason_code, "budget_configuration_missing_or_invalid")

    def test_pathological_price_and_token_limit_fail_before_arithmetic(self) -> None:
        for input_limit, price in (
            (1_000_001, PRICE),
            (2_000, ModelPrice(Decimal("1e999999"), Decimal("0.5"))),
        ):
            result = reserve_model_call(
                input_token_limit=input_limit, output_token_limit=200,
                price=price, budget=BUDGET,
            )
            self.assertFalse(result.allowed)
            self.assertEqual(result.reason_code, "budget_configuration_missing_or_invalid")


if __name__ == "__main__":
    unittest.main()
