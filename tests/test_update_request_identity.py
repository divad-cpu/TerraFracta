"""Canonical shared-run identity and bounded-request cases."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal, localcontext
from hashlib import sha256
import json
import unittest

from workers.update_request_identity import (
    RunLimits, UpdateRequest, compare_existing_request, identify_update_request,
    scheduled_request_key, canonical_update_request,
)
from workers.missing_run_monitor import oslo_weekly_due_at_utc


LIMITS = RunLimits(
    max_items=30, max_response_bytes=2_000_000,
    max_model_calls=0, max_model_input_tokens=0, max_model_output_tokens=0,
    max_retries=1, max_duration_seconds=300,
    run_cap_usd=Decimal(0), month_cap_usd=Decimal(0),
)


def request() -> UpdateRequest:
    return UpdateRequest(
        request_key="weekly:2026w40:norway", trigger="scheduled",
        scheduled_due_at=oslo_weekly_due_at_utc(2026, 40),
        actor_id="runner:fictional", scope="norway", mode="shadow",
        strategy="incremental", code_version="local-rehearsal-v1",
        policy_version="fictional-policy-v1", limits=LIMITS,
    )


class UpdateRequestIdentityTests(unittest.TestCase):
    def test_weekly_key_comes_from_the_oslo_due_window(self) -> None:
        self.assertEqual(scheduled_request_key(
            "norway", oslo_weekly_due_at_utc(2026, 2)), "weekly:2026w02:norway")
        self.assertEqual(scheduled_request_key(
            "norway", oslo_weekly_due_at_utc(2026, 41)), "weekly:2026w41:norway")
        with self.assertRaises(ValueError):
            scheduled_request_key("norway", oslo_weekly_due_at_utc(2026, 41) + timedelta(hours=1))
        with self.assertRaises(ValueError):
            scheduled_request_key("norway/other", datetime.now(timezone.utc))

    def test_same_request_key_and_inputs_reuse_fingerprint(self) -> None:
        first = identify_update_request(request())
        repeated = identify_update_request(request())
        self.assertEqual(first, repeated)
        self.assertEqual(compare_existing_request(first, first.request_fingerprint), "same_request")
        self.assertEqual(compare_existing_request(first, None), "new")

    def test_changed_scope_mode_or_trigger_conflicts_with_same_key(self) -> None:
        first = identify_update_request(request())
        for changed in (
            replace(request(), mode="publish_eligible"),
            replace(request(), trigger="manual", scheduled_due_at=None),
            replace(request(), policy_version="fictional-policy-v2"),
        ):
            changed_identity = identify_update_request(changed)
            self.assertEqual(compare_existing_request(changed_identity, first.request_fingerprint),
                             "request_key_conflict")

    def test_decimal_spelling_has_one_canonical_identity(self) -> None:
        priced = replace(LIMITS, max_model_calls=1, max_model_input_tokens=100,
                         max_model_output_tokens=20, run_cap_usd=Decimal("1.0"),
                         month_cap_usd=Decimal("2.00"))
        a = identify_update_request(replace(request(), limits=priced))
        b = identify_update_request(replace(request(), limits=replace(
            priced, run_cap_usd=Decimal("1.00"), month_cap_usd=Decimal("2"))))
        self.assertEqual(a.request_fingerprint, b.request_fingerprint)

    def test_payload_bytes_match_fingerprint_and_contain_only_bounded_fields(self) -> None:
        canonical = canonical_update_request(request())
        self.assertLess(len(canonical.encode("ascii")), 4096)
        self.assertEqual(identify_update_request(request()).request_fingerprint,
                         sha256(canonical.encode("ascii")).hexdigest())
        self.assertEqual(canonical, json.dumps(json.loads(canonical), sort_keys=True,
                         separators=(",", ":"), ensure_ascii=True))
        self.assertNotIn("request_key", json.loads(canonical))

    def test_signed_and_extreme_exponent_zero_have_one_identity(self) -> None:
        baseline = identify_update_request(request())
        for amount in (Decimal("-0"), Decimal("0E-999999"), Decimal("-0E+999999")):
            self.assertEqual(identify_update_request(replace(request(), limits=replace(
                LIMITS, run_cap_usd=amount, month_cap_usd=amount))), baseline)

    def test_money_precision_is_bounded_before_expansion(self) -> None:
        for amount in (Decimal("1e-999999"), Decimal("0.0000000001")):
            with self.assertRaises(ValueError):
                identify_update_request(replace(request(), limits=replace(
                    LIMITS, run_cap_usd=amount)))
        allowed = replace(LIMITS, run_cap_usd=Decimal("0.0000000010000"))
        self.assertEqual(json.loads(canonical_update_request(replace(request(),
            limits=allowed)))["limits"]["run_cap_usd"], "0.000000001")

    def test_money_identity_does_not_round_with_decimal_context(self) -> None:
        limits=replace(LIMITS,run_cap_usd=Decimal("999999.123456789000"))
        exact=identify_update_request(replace(request(),limits=limits))
        with localcontext() as context:
            context.prec=3
            self.assertEqual(identify_update_request(replace(request(),limits=limits)),exact)
        self.assertEqual(json.loads(canonical_update_request(replace(request(),
            limits=limits)))["limits"]["run_cap_usd"],"999999.123456789")

    def test_non_request_object_is_a_validation_failure(self) -> None:
        for invalid in (None, {}, "manual"):
            with self.assertRaises(ValueError):
                canonical_update_request(invalid)

    def test_missing_paid_caps_or_invalid_runtime_types_reject(self) -> None:
        for limits in (
            replace(LIMITS, max_items=True),
            replace(LIMITS, max_model_calls=1),
            replace(LIMITS, max_model_calls=1, max_model_input_tokens=100,
                    max_model_output_tokens=20, run_cap_usd=Decimal("NaN"),
                    month_cap_usd=Decimal("1")),
            replace(LIMITS, run_cap_usd="0"),
            replace(LIMITS, max_items=51),
            replace(LIMITS, max_duration_seconds=3_601),
            replace(LIMITS, run_cap_usd=Decimal("1e999999")),
        ):
            with self.assertRaises(ValueError):
                identify_update_request(replace(request(), limits=limits))

    def test_unbounded_identity_and_corrupt_existing_hash_reject(self) -> None:
        with self.assertRaises(ValueError):
            identify_update_request(replace(request(), scope="norway/other"))
        with self.assertRaises(ValueError):
            identify_update_request(replace(request(), request_key="Weekly 2026"))
        identity = identify_update_request(request())
        self.assertEqual(compare_existing_request(identity, "wrong"), "invalid_existing_record")

    def test_scheduled_key_must_match_the_due_instant_and_scope(self) -> None:
        for changed in (
            replace(request(), scheduled_due_at=None),
            replace(request(), scheduled_due_at=oslo_weekly_due_at_utc(2026, 41)),
            replace(request(), request_key="weekly:2026w39:norway"),
            replace(request(), scope="sweden"),
            replace(request(), trigger="manual"),
        ):
            with self.assertRaises(ValueError):
                identify_update_request(changed)


if __name__ == "__main__":
    unittest.main()
