"""Private receipts must refuse unsupported submicrosecond claims before use."""
from datetime import timedelta, timezone
from hashlib import sha256
import json
import unittest

from scripts.fictional_run_admission_cases import fictional_request
from tests import test_update_run_work as work
from tests import test_source_response_receipts as source
from tests import test_captured_update_pipeline as pipeline
from tests import test_captured_pipeline_failure as failure
from tests import test_processing_checkpoint as processing
from tests import test_visibility_receipts as visibility
from workers.update_run_work import parse_work_claim, parse_work_renewal
from workers.source_response_receipts import (
    parse_response_reservation, parse_response_dispatch, parse_response_settlement,
)
from workers.captured_update_pipeline import parse_processing_checkpoint


def extra_fraction(instant, digits="0000001"):
    return instant.isoformat().replace("+00:00", "." + digits + "+00:00")


class ReceivedTimestampPrecisionTests(unittest.TestCase):
    def test_future_submicrosecond_work_observation_refuses(self):
        with self.assertRaises(ValueError):
            parse_work_claim(work.payload(observedAt=extra_fraction(work.NOW)),
                             fictional_request(), work.admission(), work.NOW)

    def test_submicrosecond_work_limit_overages_cannot_be_truncated(self):
        for field, seconds in (("leaseExpiresAt", 30), ("deadlineAt", 300)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                parse_work_claim(work.payload(**{field: extra_fraction(work.NOW + timedelta(seconds=seconds))}),
                                 fictional_request(), work.admission(), work.NOW)

    def test_unsupported_renewal_precision_cannot_keep_an_equal_old_deadline(self):
        current = parse_work_claim(work.payload(), fictional_request(), work.admission(), work.NOW)
        for field, seconds in (("observedAt", 10), ("leaseExpiresAt", 40), ("deadlineAt", 300)):
            value = json.loads(work.payload(status="renewed",
                observedAt=(work.NOW + timedelta(seconds=10)).isoformat(),
                leaseExpiresAt=(work.NOW + timedelta(seconds=40)).isoformat()))
            del value["attempt"]
            value[field] = extra_fraction(work.NOW + timedelta(seconds=seconds))
            with self.subTest(field=field), self.assertRaises(ValueError):
                parse_work_renewal(json.dumps(value).encode(), fictional_request(), current,
                                   work.NOW + timedelta(seconds=10))

    def test_response_reservation_future_fraction_refuses(self):
        with self.assertRaises(ValueError):
            parse_response_reservation(source.reservation_payload(reservedAt=extra_fraction(source.NOW)),
                                       source.context(), now=source.NOW)

    def test_response_dispatch_future_fraction_refuses(self):
        reserved = parse_response_reservation(source.reservation_payload(), source.context(), now=source.NOW)
        with self.assertRaises(ValueError):
            parse_response_dispatch(source.dispatch_payload(dispatchedAt=extra_fraction(source.NOW)),
                                    source.context(), reserved, now=source.NOW)

    def test_response_settlement_future_fraction_refuses(self):
        expected = source.context()
        reserved = parse_response_reservation(source.reservation_payload(), expected, now=source.NOW)
        dispatched = parse_response_dispatch(source.dispatch_payload(), expected, reserved, now=source.NOW)
        with self.assertRaises(ValueError):
            parse_response_settlement(source.settlement_payload(settledAt=extra_fraction(source.NOW)),
                expected, reserved, dispatched, outcome="measured", body_bytes=3,
                content_sha256=sha256(b"abc").hexdigest(), now=source.NOW)

    def test_capture_check_refusal_stops_before_extraction_without_refunding_body(self):
        backend = pipeline.FakePipeline()
        backend.capture_changes = {"checkedAt": extra_fraction(pipeline.NOW)}
        with self.assertRaises(ValueError):
            pipeline.run(backend)
        self.assertEqual(backend.events, ["open", "capture-check"])
        self.assertEqual(backend.response.events,
                         ["reserve-committed", "dispatch-committed", "settle-committed"])
        self.assertEqual(backend.response.received["body_bytes"], 3)
        self.assertEqual(backend.response.received["outcome"], "measured")

    def test_failed_capture_check_refuses_without_releasing_uncertain_charge(self):
        backend = failure.FailurePipeline()
        backend.failure_changes = {"checkedAt": extra_fraction(failure.NOW)}
        with self.assertRaises(ValueError):
            failure.run(backend)
        self.assertEqual(backend.events, ["open:fictional-source", "failed-check"])
        self.assertEqual(backend.response.received["body_bytes"], 101)
        self.assertEqual(backend.response.received["outcome"], "uncertain")

    def test_deferred_dependency_check_refuses_before_processing_or_second_open(self):
        backend = failure.FailurePipeline()
        def deferred(plan):
            backend.stage("deferred-check")
            value = json.loads(backend.unavailable(plan, "deferred", 0))
            value["checkedAt"] = extra_fraction(failure.NOW)
            return json.dumps(value).encode()
        backend.store_deferred_capture = deferred
        with self.assertRaises(ValueError):
            failure.run(backend, (pipeline.plan(), failure.second_plan()))
        self.assertEqual(backend.events, ["open:fictional-source", "failed-check", "deferred-check"])
        self.assertEqual(backend.response.received["body_bytes"], 101)

    def test_future_activation_fraction_cannot_be_truncated_into_processing_now(self):
        value = processing.record()
        value["activations"][0]["activatedAt"] = extra_fraction(pipeline.NOW)
        with self.assertRaises(ValueError):
            parse_processing_checkpoint(json.dumps(value).encode(), processing.manifest(), now=pipeline.NOW)

    def test_future_visibility_recording_fraction_refuses(self):
        value = visibility.receipt()
        value["recordedAt"] = extra_fraction(visibility.NOW)
        with self.assertRaises(ValueError):
            visibility.parse(value, now=visibility.NOW)

    def test_visibility_equality_cannot_borrow_a_truncated_checked_through_time(self):
        value = visibility.receipt()
        value["summary"]["checkedThrough"] = extra_fraction(visibility.NOW)
        with self.assertRaises(ValueError):
            visibility.parse(value)

    def test_unsupported_precision_even_equal_zero_fraction_is_refused(self):
        for digits in ("0000000", "0000001", "0000009", "9999999", "000000000000"):
            with self.subTest(digits=digits), self.assertRaises(ValueError):
                parse_work_claim(work.payload(observedAt=extra_fraction(work.NOW, digits)),
                                 fictional_request(), work.admission(), work.NOW)

    def test_supported_zero_to_six_fractional_places_keep_same_exact_claim(self):
        for suffix in ("Z", "+00:00"):
            for digits in ("", "0", "00", "000", "0000", "00000", "000000"):
                instant = work.NOW.strftime("%Y-%m-%dT%H:%M:%S") + ("." + digits if digits else "") + suffix
                claim = parse_work_claim(work.payload(observedAt=instant),
                                         fictional_request(), work.admission(), work.NOW)
                self.assertEqual(claim.observed_at, work.NOW)
                self.assertEqual(claim.deadline_at, work.NOW + timedelta(seconds=300))

    def test_work_and_response_keep_existing_minute_offset_normalization(self):
        offset = timezone(timedelta(hours=2))
        claim = parse_work_claim(work.payload(
            observedAt=work.NOW.astimezone(offset).isoformat(),
            leaseExpiresAt=(work.NOW + timedelta(seconds=30)).astimezone(offset).isoformat(),
            deadlineAt=(work.NOW + timedelta(seconds=300)).astimezone(offset).isoformat()),
            fictional_request(), work.admission(), work.NOW)
        self.assertEqual(claim.observed_at, work.NOW)
        reserved = parse_response_reservation(source.reservation_payload(
            reservedAt=source.NOW.astimezone(offset).isoformat()), source.context(), now=source.NOW)
        self.assertEqual(reserved.reserved_at, source.NOW)

    def test_pipeline_keeps_existing_utc_only_checkpoint_rule(self):
        backend = pipeline.FakePipeline()
        backend.capture_changes = {"checkedAt": pipeline.NOW.astimezone(timezone(timedelta(hours=2))).isoformat()}
        with self.assertRaises(ValueError):
            pipeline.run(backend)
        self.assertEqual(backend.events, ["open", "capture-check"])


if __name__ == "__main__":
    unittest.main()
