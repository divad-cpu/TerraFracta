"""Monetary caps must not depend on ambient Decimal rounding or precision."""
from dataclasses import replace
from decimal import Decimal, Inexact, ROUND_DOWN, ROUND_UP, localcontext
from fractions import Fraction
import random
import unittest

from workers.model_cost_budget import BudgetSnapshot, ModelPrice, reserve_model_call


def reserve(rate='1.01', *, used='0', cap='0.000001', output_rate='0', input_limit=1, output_limit=1):
    return reserve_model_call(
        input_token_limit=input_limit, output_token_limit=output_limit,
        price=ModelPrice(Decimal(rate), Decimal(output_rate)),
        budget=BudgetSnapshot(Decimal(cap), Decimal(cap), Decimal(used), Decimal(used)),
    )


class ModelCostPrecisionTests(unittest.TestCase):
    def test_standard_precision_cannot_hide_subprecision_overage(self):
        result=reserve('1.0000000000000000000000000001')
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason_code, 'run_cost_cap_exceeded')
        self.assertEqual(result.maximum_call_usd, Decimal('0.0000010000000000000000000000000001'))

    def test_low_precision_cannot_turn_overage_into_exact_cap(self):
        with localcontext() as context:
            context.prec=2;context.rounding=ROUND_DOWN
            result=reserve()
        self.assertFalse(result.allowed)
        self.assertEqual(result.maximum_call_usd, Decimal('0.00000101'))

    def test_existing_over_cap_balance_cannot_be_rounded_down(self):
        result=reserve('0', used='0.0000010000000000000000000001')
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason_code, 'run_cost_cap_exceeded')

    def test_caller_traps_and_exponents_do_not_change_exact_result_or_context(self):
        with localcontext() as context:
            context.prec=1;context.Emin=-2;context.Emax=2
            context.traps[Inexact]=True;context.rounding=ROUND_UP
            before=str(context)
            result=reserve('0.12345678901234567890123456789', cap='1')
            self.assertEqual(str(context), before)
        self.assertTrue(result.allowed)
        self.assertEqual(result.maximum_call_usd, Decimal('0.00000012345678901234567890123456789'))

    def test_very_small_valid_rates_are_not_underflowed(self):
        with localcontext() as context:
            context.prec=2;context.Emin=-2;context.Emax=2
            result=reserve('1e-100', cap='1e-100')
        self.assertTrue(result.allowed)
        self.assertEqual(result.maximum_call_usd, Decimal('1e-106'))

    def test_separate_month_cap_uses_exact_balance(self):
        base=BudgetSnapshot(Decimal('1'), Decimal('0.000001'), Decimal('0'),
                            Decimal('0.0000010000000000000000000001'))
        result=reserve_model_call(input_token_limit=1, output_token_limit=1,
                                 price=ModelPrice(Decimal(0),Decimal(0)),budget=base)
        self.assertEqual(result.reason_code,'month_cost_cap_exceeded')

    def test_exact_input_limit_and_carry_cost_are_preserved(self):
        result=reserve('999999.999999999999999999999999', output_rate='0.000000000000000000000001',
                       input_limit=1_000_000, output_limit=1_000_000,cap='1000000')
        exact=Fraction(Decimal('999999.999999999999999999999999'))+Fraction(Decimal('0.000000000000000000000001'))
        self.assertTrue(result.allowed)
        self.assertEqual(Fraction(result.maximum_call_usd),exact)

    def test_extreme_nonzero_representations_fail_before_arithmetic(self):
        for rate in ('1e-4097','1e-999999'):
            with self.subTest(rate=rate):
                result=reserve(rate,cap='1')
                self.assertFalse(result.allowed)
                self.assertEqual(result.reason_code,'budget_configuration_missing_or_invalid')
                self.assertIsNone(result.next_run_reserved_usd)
        excessive=Decimal((0,(1,)*4097,-4097))
        result=reserve_model_call(input_token_limit=1,output_token_limit=1,
                                 price=ModelPrice(excessive,Decimal(0)),
                                 budget=BudgetSnapshot(*(Decimal(1),Decimal(1),Decimal(0),Decimal(0))))
        self.assertFalse(result.allowed)

    def test_zero_representation_does_not_require_a_huge_precision(self):
        result=reserve('0e-999999', used='-0e999999',cap='0')
        self.assertTrue(result.allowed)
        self.assertEqual(result.maximum_call_usd,Decimal(0))

    def test_boundary_scale_remains_exact(self):
        result=reserve('1e-4096',cap='1')
        self.assertTrue(result.allowed)
        self.assertEqual(result.maximum_call_usd,Decimal('1e-4102'))

    def test_successful_smallest_scale_balance_can_be_reserved_again(self):
        budget=BudgetSnapshot(Decimal(1),Decimal(1),Decimal(0),Decimal(0))
        first=reserve_model_call(input_token_limit=1,output_token_limit=1,
                                 price=ModelPrice(Decimal('1e-4096'),Decimal(0)),budget=budget)
        second=reserve_model_call(input_token_limit=1,output_token_limit=1,
            price=ModelPrice(Decimal('1e-4096'),Decimal(0)),
            budget=replace(budget,run_spent_and_reserved_usd=first.next_run_reserved_usd,
                           month_spent_and_reserved_usd=first.next_month_reserved_usd))
        self.assertTrue(second.allowed)
        self.assertEqual(second.next_run_reserved_usd,Decimal('2e-4102'))
        self.assertEqual(second.next_month_reserved_usd,Decimal('2e-4102'))

    def test_maximum_rate_coefficient_and_wide_balance_remain_closed(self):
        rate=Decimal((0,(1,)*4096,-4096))
        budget=BudgetSnapshot(Decimal(1_000_000),Decimal(1_000_000),Decimal(999_999),Decimal(999_999))
        for index in range(3):
            result=reserve_model_call(input_token_limit=1,output_token_limit=1,
                                     price=ModelPrice(rate,Decimal(0)),budget=budget)
            self.assertTrue(result.allowed)
            self.assertEqual(Fraction(result.next_run_reserved_usd),
                             Fraction(999_999)+(index+1)*Fraction(rate)/1_000_000)
            budget=replace(budget,run_spent_and_reserved_usd=result.next_run_reserved_usd,
                           month_spent_and_reserved_usd=result.next_month_reserved_usd)

    def test_fraction_oracle_matches_many_valid_inputs_and_contexts(self):
        rng=random.Random(70431)
        cases=[]
        for _ in range(90):
            rate=Decimal((0,tuple(map(int,str(rng.randrange(1,10**30)))),-rng.randrange(26,50)))
            output_rate=Decimal((0,tuple(map(int,str(rng.randrange(1,10**25)))),-rng.randrange(25,45)))
            inputs=rng.randrange(1,1_000_001);outputs=rng.randrange(1,1_000_001)
            expected=(Fraction(rate)*inputs+Fraction(output_rate)*outputs)/1_000_000
            cases.append((rate,output_rate,inputs,outputs,expected))
        for precision,rounding in ((1,ROUND_DOWN),(2,ROUND_UP),(28,ROUND_DOWN)):
            with localcontext() as context:
                context.prec=precision;context.rounding=rounding
                for rate,output_rate,inputs,outputs,expected in cases:
                    with self.subTest(precision=precision,inputs=inputs,outputs=outputs):
                        cap=Decimal('1000000');budget=BudgetSnapshot(cap,cap,Decimal(0),Decimal(0))
                        result=reserve_model_call(input_token_limit=inputs,output_token_limit=outputs,
                                                 price=ModelPrice(rate,output_rate),budget=budget)
                        self.assertTrue(result.allowed)
                        self.assertEqual(Fraction(result.maximum_call_usd),expected)
                        self.assertEqual(Fraction(result.next_run_reserved_usd),expected)
                        self.assertEqual(Fraction(result.next_month_reserved_usd),expected)


if __name__=='__main__':
    unittest.main()
