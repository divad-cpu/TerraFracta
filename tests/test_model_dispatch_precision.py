"""Whole dispatch plans preserve exact reserved totals and cap decisions."""
from dataclasses import replace
from decimal import Decimal, ROUND_DOWN, localcontext
from fractions import Fraction
import unittest
from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.model_cost_budget import BudgetSnapshot, ModelPrice
from workers.model_dispatch_plan import plan_model_dispatch


def item(name):
    return CapturedWorkItem(name,'approved',True,'a'*64,'b'*64,'qualified_prose',True,1)


def plan(count, *, cap='0.00000606', used='0', rate='1.01'):
    return plan_model_dispatch(tuple(item(str(n)) for n in range(count)),
        RoutingLimits(10,10,10),output_token_limit_per_call=1,
        price=ModelPrice(Decimal(rate),Decimal(0)),
        budget=BudgetSnapshot(Decimal(cap),Decimal(cap),Decimal(used),Decimal(used)))


class ModelDispatchPrecisionTests(unittest.TestCase):
    def test_exact_caps_stop_seventh_reservation_even_in_low_precision(self):
        with localcontext() as c:
            c.prec=2;c.rounding=ROUND_DOWN
            report=plan(7)
        self.assertEqual(report.reserved_calls,6)
        self.assertEqual(report.items[-1].reason_code,'run_cost_cap_exceeded')
        self.assertEqual(report.maximum_reserved_usd,Decimal('0.00000606'))
        self.assertEqual(report.resulting_budget.run_spent_and_reserved_usd,Decimal('0.00000606'))

    def test_totals_match_item_costs_and_balance_delta_under_low_precision(self):
        with localcontext() as c:
            c.prec=2;c.rounding=ROUND_DOWN
            report=plan(3, cap='1', used='0.01')
        oracle=sum((Fraction(v.maximum_call_usd) for v in report.items),Fraction(0))
        self.assertEqual(Fraction(report.maximum_reserved_usd),oracle)
        self.assertEqual(Fraction(report.resulting_budget.run_spent_and_reserved_usd)-Fraction(Decimal('0.01')),oracle)
        self.assertEqual(report.reserved_calls,3)

    def test_reported_total_preserves_more_than_standard_context_precision(self):
        report=plan(3,cap='1',rate='1.0000000000000000000000000001')
        exact=3*Fraction(Decimal('1.0000000000000000000000000001'))/1_000_000
        self.assertEqual(Fraction(report.maximum_reserved_usd),exact)
        self.assertEqual(Fraction(report.resulting_budget.month_spent_and_reserved_usd),exact)

    def test_rejected_configuration_keeps_unpaid_work_independent(self):
        structured=replace(item('structured'),extraction_route='structured')
        report=plan_model_dispatch((structured,item('prose')),RoutingLimits(2,2,2),
            output_token_limit_per_call=1,price=ModelPrice(Decimal('1e-999999'),Decimal(0)),
            budget=BudgetSnapshot(Decimal(1),Decimal(1),Decimal(0),Decimal(0)))
        self.assertEqual([v.disposition for v in report.items],['deterministic','deferred'])
        self.assertEqual(report.reserved_calls,0)
        self.assertEqual(report.maximum_reserved_usd,Decimal(0))

    def test_smallest_admitted_rate_can_reserve_multiple_calls(self):
        report=plan(3,cap='1',rate='1e-4096')
        self.assertEqual(report.reserved_calls,3)
        self.assertEqual([v.disposition for v in report.items],['reserved_model_candidate']*3)
        self.assertEqual(report.maximum_reserved_usd,Decimal('3e-4102'))
        self.assertEqual(report.resulting_budget.run_spent_and_reserved_usd,Decimal('3e-4102'))


if __name__=='__main__':
    unittest.main()
