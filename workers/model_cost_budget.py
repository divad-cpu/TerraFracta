"""Exact, offline model-call reservation arithmetic for a future paid runner.

Rates and caps must come from accepted runtime configuration. This module does
not call a provider or persist a monthly ledger.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import (
    Context, Decimal, DivisionByZero, Inexact, InvalidOperation,
    MAX_EMAX, MIN_EMIN, Overflow, ROUND_HALF_EVEN,
)


MILLION = Decimal(1_000_000)
MAX_TOKEN_LIMIT = 1_000_000
MAX_USD_VALUE = Decimal(1_000_000)
# Computational representation bounds, not accepted prices, caps or USD rounding.
MAX_PRICE_DIGITS = 4096
MAX_PRICE_EXPONENT = 4096
# Dividing a valid rate by 10**6 may add six fractional places. A balance up
# to1,000,000 needs seven integer places. Successful balances must remain valid.
MAX_BALANCE_EXPONENT = MAX_PRICE_EXPONENT + 6
MAX_BALANCE_DIGITS = MAX_BALANCE_EXPONENT + 7


def _valid_amount(value: object, digits: int, exponent: int) -> bool:
    if not isinstance(value, Decimal) or not value.is_finite() or not 0 <= value <= MAX_USD_VALUE:
        return False
    if value.is_zero():
        return True
    parts = value.as_tuple()
    return (
        len(parts.digits) <= digits
        and -exponent <= parts.exponent <= exponent
    )


def _exact_context(values: tuple[Decimal, ...], extra_digits: int) -> Context:
    """Cover the complete coefficient span without consulting caller context."""
    nonzero = tuple(value for value in values if not value.is_zero())
    precision = 28 if not nonzero else max(
        28,
        max(value.adjusted() for value in nonzero)
        - min(value.as_tuple().exponent for value in nonzero) + 1 + extra_digits,
    )
    return Context(
        prec=precision, rounding=ROUND_HALF_EVEN, Emin=MIN_EMIN, Emax=MAX_EMAX,
        traps=[InvalidOperation, DivisionByZero, Overflow, Inexact],
    )


def add_reserved_model_cost(total: Decimal, cost: Decimal) -> Decimal:
    """Add already validated reservation amounts exactly for the offline plan."""
    # Both operands are this module's bounded successful outputs; one carry digit.
    return _exact_context((total, cost), 1).add(total, cost)


@dataclass(frozen=True)
class ModelPrice:
    input_usd_per_million: Decimal | None
    output_usd_per_million: Decimal | None


@dataclass(frozen=True)
class BudgetSnapshot:
    run_cap_usd: Decimal | None
    month_cap_usd: Decimal | None
    run_spent_and_reserved_usd: Decimal | None
    month_spent_and_reserved_usd: Decimal | None


@dataclass(frozen=True)
class Reservation:
    allowed: bool
    reason_code: str
    maximum_call_usd: Decimal
    next_run_reserved_usd: Decimal | None
    next_month_reserved_usd: Decimal | None


def reserve_model_call(
    *, input_token_limit: int | None, output_token_limit: int | None,
    price: ModelPrice, budget: BudgetSnapshot,
) -> Reservation:
    """Reserve worst-case token cost; the future runtime must debit actual use."""

    amounts = (
        price.input_usd_per_million, price.output_usd_per_million,
        budget.run_cap_usd, budget.month_cap_usd,
        budget.run_spent_and_reserved_usd, budget.month_spent_and_reserved_usd,
    )
    if (
        type(input_token_limit) is not int or not 1 <= input_token_limit <= MAX_TOKEN_LIMIT
        or type(output_token_limit) is not int or not 1 <= output_token_limit <= MAX_TOKEN_LIMIT
        or any(not _valid_amount(value, MAX_PRICE_DIGITS, MAX_PRICE_EXPONENT)
               for value in amounts[:2])
        or any(not _valid_amount(value, MAX_BALANCE_DIGITS, MAX_BALANCE_EXPONENT)
               for value in amounts[2:])
    ):
        return Reservation(False, "budget_configuration_missing_or_invalid", Decimal(0), None, None)

    input_rate, output_rate, run_cap, month_cap, run_used, month_used = (
        Decimal(0) if value.is_zero() else value for value in amounts
    )
    # Seven token digits, division by 10**6 and a possible carry need at most14
    # extra span digits. Inexact is trapped as an internal arithmetic invariant.
    context = _exact_context((input_rate, output_rate, run_cap, month_cap, run_used, month_used), 14)
    maximum = context.divide(context.add(
        context.multiply(Decimal(input_token_limit), input_rate),
        context.multiply(Decimal(output_token_limit), output_rate),
    ), MILLION)
    next_run = context.add(run_used, maximum)
    next_month = context.add(month_used, maximum)
    if next_run > run_cap:
        return Reservation(False, "run_cost_cap_exceeded", maximum, None, None)
    if next_month > month_cap:
        return Reservation(False, "month_cost_cap_exceeded", maximum, None, None)
    return Reservation(
        True, "reserved", maximum, next_run, next_month
    )
