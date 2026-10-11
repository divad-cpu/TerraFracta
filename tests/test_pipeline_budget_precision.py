"""The original work budget cannot round up with an admitted clock origin."""
from fractions import Fraction
import unittest
from tests import test_captured_pipeline_clock as clock_support
from tests.test_source_response_receipts import NOW, context
from workers.captured_update_pipeline import _bounded_work_check


class PipelineBudgetPrecisionTests(unittest.TestCase):
    def test_large_float_origin_cannot_grant_thirty_first_second(self):
        for entry in ('execute', 'resume', 'process_only'):
            backend, invoke = clock_support.PipelineClockTests().context(entry)
            backend.elapsed[0] = float(2 ** 55)
            process = backend.process
            def late(*args):
                result = process(*args)
                backend.elapsed[0] = 2 ** 55 + 31
                return result
            backend.process = late
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                invoke()
            self.assertEqual(backend.events[-1], 'process')
            self.assertNotIn('close', backend.events)

    def test_both_signs_and_mixed_integer_float_ticks_respect_exact_original_budget(self):
        for start in (float(2 ** 55), -float(2 ** 55)):
            for elapsed in (0, 29, 30, 31):
                end = int(start) + elapsed
                ticks = iter((start, end))
                check = _bounded_work_check(context().work, NOW, lambda: NOW, lambda: next(ticks), 'budget held')
                with self.subTest(start=start, elapsed=elapsed):
                    if elapsed < 30:
                        check()
                    else:
                        with self.assertRaisesRegex(ValueError, '^budget held$'):
                            check()

    def test_timely_binary_fraction_is_not_rejected_by_rounded_deadline_addition(self):
        # Exact accepted binary64 numbers, not decimal interpretations of them.
        start, end = -0.1, 29.9
        self.assertLess(Fraction(end) - Fraction(start), 30)
        ticks = iter((start, end))
        _bounded_work_check(context().work, NOW, lambda: NOW, lambda: next(ticks), 'budget held')()

    def test_budget_never_resets_on_intermediate_ticks_and_unrepresentable_origins_stay_held(self):
        for origin in (0, -10, float(2 ** 55)):
            ticks = iter((origin, int(origin) + 10, int(origin) + 20, int(origin) + 30))
            check = _bounded_work_check(context().work, NOW, lambda: NOW, lambda: next(ticks), 'budget held')
            check(); check()
            with self.assertRaises(ValueError):
                check()
        for origin in (1e308, -1e308):
            with self.assertRaises(ValueError):
                check = _bounded_work_check(context().work, NOW, lambda: NOW, lambda: origin, 'budget held')
                check()


if __name__ == '__main__':
    unittest.main()
