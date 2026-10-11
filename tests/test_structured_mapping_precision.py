"""Qualified mapping bounds must retain their exact identity in every context."""
from dataclasses import replace
from decimal import Decimal, Inexact, ROUND_DOWN, ROUND_UP, localcontext
import unittest
from unittest.mock import patch

from tests.test_structured_observation import BASE_MAPPING, encoded, receipt
from workers.structured_observation import (
    ObservationError, extract_structured_observation, semantic_contract_fingerprint,
)

LOW = Decimal("27.39999999999999999999999999999")
HIGH = Decimal("27.40000000000000000000000000001")


def bound(minimum="0", maximum=HIGH):
    return replace(BASE_MAPPING, minimum=Decimal(minimum), maximum=Decimal(maximum))


def qualified(mapping):
    return replace(mapping, accepted_contract_sha256=semantic_contract_fingerprint(mapping))


class StructuredMappingPrecisionTests(unittest.TestCase):
    def test_extreme_nonzero_representation_stops_before_text_expansion(self):
        for value in (Decimal("1e-4097"), Decimal("1e-999999999"),
                      Decimal((0, (1,) * 4097, -4097))):
            with self.subTest(value=value), patch(
                    "workers.structured_observation._canonical_decimal_bound",
                    side_effect=AssertionError("No bound may be formatted before validation")):
                with self.assertRaisesRegex(ObservationError, "mapping_numeric_bounds_invalid"):
                    semantic_contract_fingerprint(bound(maximum=value))

    def test_extreme_nonzero_mapping_stops_before_receipt_fingerprinting(self):
        mapping = replace(bound(maximum="1e-999999999"),
                          accepted_contract_sha256="a" * 64)
        with patch("workers.structured_observation.semantic_contract_fingerprint",
                   side_effect=AssertionError("Invalid mapping must not be fingerprinted")):
            with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
                extract_structured_observation(encoded(), receipt(encoded()), mapping, period="2025")

    def test_computational_boundary_is_admitted_without_rounding(self):
        mapping = bound("-1e-4096", "1e-4096")
        expected = semantic_contract_fingerprint(mapping)
        with localcontext() as context:
            context.prec = 1
            context.Emin = -2
            context.Emax = 2
            context.traps[Inexact] = True
            self.assertEqual(semantic_contract_fingerprint(mapping), expected)

    def test_subprecision_positive_bound_changes_have_distinct_identity(self):
        self.assertNotEqual(semantic_contract_fingerprint(bound(maximum=LOW)),
                            semantic_contract_fingerprint(bound(maximum=HIGH)))

    def test_subprecision_negative_bound_changes_have_distinct_identity(self):
        first = bound("-27.39999999999999999999999999999", "100")
        second = bound("-27.40000000000000000000000000001", "100")
        self.assertNotEqual(semantic_contract_fingerprint(first), semantic_contract_fingerprint(second))

    def test_changed_bound_cannot_borrow_previous_qualification(self):
        old = qualified(bound(maximum=LOW))
        changed = replace(old, maximum=HIGH)
        with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
            extract_structured_observation(encoded(), receipt(encoded()), changed, period="2025")

    def test_exact_bound_cannot_round_into_global_numeric_ceiling(self):
        for maximum in ("10000000.00000000000000000000001", "-10000000.00000000000000000000001"):
            for precision in (1, 3, 28):
                with self.subTest(maximum=maximum, precision=precision), localcontext() as context:
                    context.prec = precision
                    context.rounding = ROUND_DOWN
                    with self.assertRaisesRegex(ObservationError, "mapping_numeric_bounds_invalid"):
                        semantic_contract_fingerprint(bound(maximum=maximum))

    def test_extraction_cannot_reuse_old_rounded_out_of_range_fingerprint(self):
        # Hash produced by the old ROUND_DOWN numeric guard/normalization for this
        # out-of-envelope bound equals the unchanged exact ceiling mapping.
        old_fingerprint = semantic_contract_fingerprint(bound(maximum="10000000"))
        changed = replace(bound(maximum="10000000.00000000000000000000001"),
                          accepted_contract_sha256=old_fingerprint)
        with localcontext() as context:
            context.prec = 3
            context.rounding = ROUND_DOWN
            with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
                extract_structured_observation(encoded(), receipt(encoded()), changed, period="2025")

    def test_fingerprint_is_context_independent_and_preserves_flags(self):
        mapping = bound("-0.123456789012345678901234567891", HIGH)
        expected = semantic_contract_fingerprint(mapping)
        for precision, rounding in ((1, ROUND_DOWN), (3, ROUND_UP), (28, ROUND_DOWN)):
            with self.subTest(precision=precision), localcontext() as context:
                context.prec = precision
                context.rounding = rounding
                before = str(context)
                self.assertEqual(semantic_contract_fingerprint(mapping), expected)
                self.assertEqual(str(context), before)

    def test_traps_and_narrow_ambient_exponents_do_not_block_valid_bounds(self):
        mapping = bound("-0.123456789012345678901234567891", "9999999.9999")
        expected = semantic_contract_fingerprint(mapping)
        with localcontext() as context:
            context.prec = 1
            context.Emin = -2
            context.Emax = 2
            context.traps[Inexact] = True
            before = str(context)
            self.assertEqual(semantic_contract_fingerprint(mapping), expected)
            self.assertEqual(str(context), before)

    def test_exact_existing_fictional_mapping_identity_is_preserved(self):
        self.assertEqual(semantic_contract_fingerprint(BASE_MAPPING),
                         "fa7a9e3ba39202934b4820dacf6c2b54c1160a19f8ef5c0ffe828347a9fa5daa")

    def test_equivalent_nonzero_spellings_keep_one_identity(self):
        for minimum, maximum in (("0.10", "27.4000"), ("0.100000", "2.740E1")):
            self.assertEqual(semantic_contract_fingerprint(bound(minimum, maximum)),
                             semantic_contract_fingerprint(bound("0.1", "27.4")))
        self.assertEqual(semantic_contract_fingerprint(bound("-1.000", "100.000")),
                         semantic_contract_fingerprint(bound("-1", "100")))

    def test_signed_zero_legacy_identity_and_extreme_zero_spelling_are_preserved(self):
        for minimum in ("0E-999999", "0E+999999"):
            self.assertEqual(semantic_contract_fingerprint(bound(minimum, "100")),
                             semantic_contract_fingerprint(BASE_MAPPING))
        self.assertEqual(semantic_contract_fingerprint(bound("-0E-999999", "100")),
                         semantic_contract_fingerprint(bound("-0", "100")))
        self.assertNotEqual(semantic_contract_fingerprint(bound("-0", "100")),
                            semantic_contract_fingerprint(BASE_MAPPING))

    def test_low_precision_valid_extraction_keeps_exact_value_and_contract(self):
        mapping = qualified(bound())
        with localcontext() as context:
            context.prec = 1
            context.rounding = ROUND_DOWN
            result = extract_structured_observation(encoded(), receipt(encoded()), mapping, period="2025")
        self.assertEqual(result.value, Decimal("27.4"))
        self.assertEqual(result.semantic_contract_sha256, mapping.accepted_contract_sha256)

    def test_a_new_exact_fingerprint_does_not_make_an_unqualified_mapping_eligible(self):
        mapping = replace(qualified(bound()), status="proposed")
        with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
            extract_structured_observation(encoded(), receipt(encoded()), mapping, period="2025")


if __name__ == "__main__":
    unittest.main()
