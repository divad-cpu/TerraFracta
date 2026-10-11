"""Private, offline revision-planning tests for the fixed SSB sample."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest

from workers.ssb_14059_capture import CapturedResponse, DATA_URL, parse_captured_ssb_14059
from workers.ssb_14059_reconcile import (
    SSB14059ReconciliationError,
    reconcile_ssb_14059,
)


ROOT = Path(__file__).resolve().parents[1]


class SSB14059ReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(
            (ROOT / "fixtures/ssb_14059_jsonstat_minimal_2024_2025.json").read_text()
        )
        cls.first_retrieval = datetime(2026, 9, 24, 18, 0, 3, tzinfo=timezone.utc)

    def parsed(self, response: dict | None = None, *, later: bool = False, indent: int | None = None):
        body = json.dumps(response if response is not None else self.fixture, indent=indent).encode("utf-8")
        return parse_captured_ssb_14059(
            CapturedResponse(
                requested_url=DATA_URL,
                final_url=DATA_URL,
                redirect_count=0,
                status=200,
                content_type="application/json",
                body=body,
                retrieved_at=self.first_retrieval + timedelta(days=1) if later else self.first_retrieval,
            )
        )

    def test_first_capture_proposes_two_private_observations(self) -> None:
        plan = reconcile_ssb_14059(None, self.parsed())
        self.assertEqual((plan.state, plan.changed_years), ("new", (2024, 2025)))
        self.assertTrue(plan.raw_version_changed)
        self.assertIsNone(plan.hold_reason)
        self.assertEqual(plan.changed_share_years, (2024, 2025))
        self.assertEqual(plan.changed_response_count_years, (2024, 2025))

    def test_repeated_raw_response_does_not_propose_new_values(self) -> None:
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(later=True))
        self.assertEqual((plan.state, plan.changed_years), ("unchanged", ()))
        self.assertFalse(plan.raw_version_changed)
        self.assertEqual((plan.changed_share_years, plan.changed_response_count_years), ((), ()))

    def test_byte_only_change_is_a_source_version_without_new_observation(self) -> None:
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(later=True, indent=2))
        self.assertEqual((plan.state, plan.changed_years), ("changed", ()))
        self.assertTrue(plan.raw_version_changed)

    def test_newer_source_timestamp_with_changed_2025_value_marks_only_2025(self) -> None:
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        revised["value"][1] = 12.9
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(revised, later=True))
        self.assertEqual((plan.state, plan.changed_years), ("changed", (2025,)))
        self.assertIsNone(plan.hold_reason)
        self.assertEqual(plan.changed_share_years, (2025,))
        self.assertEqual(plan.changed_response_count_years, ())

    def test_response_count_only_revision_does_not_mark_share_cells_changed(self) -> None:
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        revised["value"][5] = 5000
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(revised, later=True))
        self.assertEqual(plan.changed_years, (2025,))
        self.assertEqual(plan.changed_share_years, ())
        self.assertEqual(plan.changed_response_count_years, (2025,))

    def test_changed_value_without_new_source_timestamp_is_held(self) -> None:
        revised = deepcopy(self.fixture)
        revised["value"][1] = 12.9
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(revised, later=True))
        self.assertEqual((plan.state, plan.changed_years), ("held", (2025,)))
        self.assertEqual(plan.hold_reason, "unmarked_numeric_revision")

    def test_older_source_timestamp_is_held_even_with_same_values(self) -> None:
        revised = deepcopy(self.fixture)
        revised["updated"] = "2025-04-16T06:00:00Z"
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(revised, later=True))
        self.assertEqual((plan.state, plan.changed_years), ("held", ()))
        self.assertEqual(plan.hold_reason, "source_time_regressed")

    def test_newer_source_timestamp_without_value_change_has_no_new_observation(self) -> None:
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        plan = reconcile_ssb_14059(self.parsed(), self.parsed(revised, later=True))
        self.assertEqual((plan.state, plan.changed_years), ("changed", ()))

    def test_older_retrieval_is_rejected(self) -> None:
        with self.assertRaises(SSB14059ReconciliationError):
            reconcile_ssb_14059(self.parsed(later=True), self.parsed())

    def test_fabricated_query_identity_is_rejected(self) -> None:
        with self.assertRaises(SSB14059ReconciliationError):
            reconcile_ssb_14059(None, replace(self.parsed(), query_url="https://example.test"))

    def test_same_raw_hash_with_conflicting_values_is_rejected(self) -> None:
        original = self.parsed()
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        fabricated = replace(self.parsed(revised, later=True), raw_sha256=original.raw_sha256)
        with self.assertRaises(SSB14059ReconciliationError):
            reconcile_ssb_14059(original, fabricated)


if __name__ == "__main__":
    unittest.main()
