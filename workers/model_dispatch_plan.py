"""Offline, budget-bound plan for changed prose items.

This joins routing and worst-case price reservations. It neither persists a
ledger nor grants authority to call a provider; a runtime must reserve against
durable concurrent balances before each paid request.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal

from workers.change_work_router import (
    CapturedWorkItem,
    RoutingLimits,
    route_captured_changes,
)
from workers.model_cost_budget import (
    BudgetSnapshot, ModelPrice, add_reserved_model_cost, reserve_model_call,
)


@dataclass(frozen=True)
class PlannedModelItem:
    item_key: str
    disposition: str
    reason_code: str
    maximum_call_usd: Decimal


@dataclass(frozen=True)
class ModelDispatchPlan:
    items: tuple[PlannedModelItem, ...]
    reserved_calls: int
    maximum_reserved_usd: Decimal
    resulting_budget: BudgetSnapshot


def plan_model_dispatch(
    items: tuple[CapturedWorkItem, ...], routing_limits: RoutingLimits,
    *, output_token_limit_per_call: int | None,
    price: ModelPrice, budget: BudgetSnapshot,
) -> ModelDispatchPlan:
    """Propose calls only after both routing and monetary caps pass."""

    current_budget = budget
    reserved_calls = 0
    reserved_total = Decimal(0)
    costs: dict[str, Decimal] = {}

    def reserve_candidate(item: CapturedWorkItem) -> str | None:
        nonlocal current_budget, reserved_calls, reserved_total
        reservation = reserve_model_call(
            input_token_limit=item.estimated_model_input_tokens,
            output_token_limit=output_token_limit_per_call,
            price=price, budget=current_budget,
        )
        if not reservation.allowed:
            return reservation.reason_code
        current_budget = replace(
            current_budget,
            run_spent_and_reserved_usd=reservation.next_run_reserved_usd,
            month_spent_and_reserved_usd=reservation.next_month_reserved_usd,
        )
        reserved_calls += 1
        reserved_total = add_reserved_model_cost(reserved_total, reservation.maximum_call_usd)
        costs[item.item_key] = reservation.maximum_call_usd
        return None

    routing = route_captured_changes(items, routing_limits, model_admission=reserve_candidate)
    outcomes = tuple(
        PlannedModelItem(route.item_key, "reserved_model_candidate", "reserved", costs[route.item_key])
        if route.disposition == "model_candidate" else
        PlannedModelItem(route.item_key, route.disposition, route.reason_code, Decimal(0))
        for route in routing.items
    )
    return ModelDispatchPlan(
        outcomes, reserved_calls, reserved_total, current_budget
    )
