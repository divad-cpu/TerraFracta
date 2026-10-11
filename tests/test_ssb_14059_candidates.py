"""Offline tests for private, structured SSB evidence candidates."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
import unittest

from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL, parse_captured_ssb_14059, parse_captured_ssb_14059_metadata
from workers.ssb_14059_candidates import (
    SSB14059CandidateError,
    build_private_ssb_14059_candidates,
)
from workers.ssb_14059_reconcile import ReconciliationPlan, reconcile_ssb_14059


ROOT = Path(__file__).resolve().parents[1]


class SSB14059CandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(
            (ROOT / "fixtures/ssb_14059_jsonstat_minimal_2024_2025.json").read_text()
        )
        cls.reviewed = json.loads(
            (ROOT / "fixtures/ssb_14059_housing_cost_burden_2024_2025.json").read_text()
        )
        cls.first_retrieval = datetime(2026, 9, 24, 18, 0, 3, tzinfo=timezone.utc)
        cls.metadata_fixture = json.loads(
            (ROOT / "fixtures/ssb_14059_metadata_minimal_2024_2025.json").read_text()
        )

    def parsed(self, response: dict | None = None, *, later: bool = False, indent: int | None = None):
        body = json.dumps(
            response if response is not None else self.fixture, indent=indent
        ).encode("utf-8")
        capture = CapturedResponse(
            requested_url=DATA_URL,
            final_url=DATA_URL,
            redirect_count=0,
            status=200,
            content_type="application/json",
            body=body,
            retrieved_at=self.first_retrieval + timedelta(days=1) if later else self.first_retrieval,
        )
        return parse_captured_ssb_14059(capture), body

    def metadata(self, capture):
        response = deepcopy(self.metadata_fixture)
        response["updated"] = capture.source_updated_at.isoformat().replace("+00:00", "Z")
        return parse_captured_ssb_14059_metadata(CapturedResponse(
            requested_url=METADATA_URL,
            final_url=METADATA_URL,
            redirect_count=0,
            status=200,
            content_type="application/json",
            body=json.dumps(response).encode("utf-8"),
            retrieved_at=capture.retrieved_at,
        ))

    def test_reviewed_values_have_exact_cell_locators_and_private_state(self) -> None:
        capture, body = self.parsed()
        plan = reconcile_ssb_14059(None, capture)
        candidates = build_private_ssb_14059_candidates(capture, plan, self.metadata(capture))
        self.assertEqual([item.survey_year for item in candidates], [2024, 2025])
        for item, expected in zip(candidates, self.reviewed["rows"], strict=True):
            self.assertEqual(item.period_precision, "year")
            self.assertEqual(item.share_40_59_percent, Decimal(str(expected["share_40_59_percent"])))
            self.assertEqual(item.share_upper_band_percent, Decimal(str(expected["share_upper_band_percent"])))
            self.assertEqual(item.combined_share_ge_40_percent, Decimal(str(expected["combined_share_ge_40_percent"])))
            self.assertEqual(item.respondent_count, expected["respondent_count"])
            self.assertEqual(item.share_unit, "percent")
            self.assertEqual(item.respondent_count_basis, "ssb_response_count_unreconciled")
            self.assertEqual(
                item.lower_band_locator,
                f"EierStatus=0;ContentsCode=Boutg4;Tid={item.survey_year}",
            )
            self.assertEqual(
                item.upper_band_locator,
                f"EierStatus=0;ContentsCode=Boutg5;Tid={item.survey_year}",
            )
            self.assertEqual(
                item.respondent_count_locator,
                f"EierStatus=0;ContentsCode=AntHushSvar;Tid={item.survey_year}",
            )
            self.assertEqual(item.query_url, self.reviewed["query_url"])
            self.assertEqual(item.raw_response_sha256, sha256(body).hexdigest())
            self.assertEqual(item.metadata_response_sha256, self.metadata(capture).raw_sha256)
            self.assertEqual(item.retrieved_at, self.first_retrieval)
            self.assertEqual(item.source_updated_at.isoformat(), "2026-04-16T06:00:00+00:00")
            self.assertEqual((item.review_state, item.hold_reason), ("unreviewed", None))

    def test_identical_response_has_no_new_candidate(self) -> None:
        previous, _ = self.parsed()
        current, _ = self.parsed(later=True)
        plan = reconcile_ssb_14059(previous, current)
        self.assertEqual(build_private_ssb_14059_candidates(current, plan, self.metadata(current)), ())

    def test_byte_only_change_has_no_new_numeric_candidate(self) -> None:
        previous, _ = self.parsed()
        current, _ = self.parsed(later=True, indent=2)
        plan = reconcile_ssb_14059(previous, current)
        self.assertEqual((plan.state, plan.raw_version_changed), ("changed", True))
        self.assertEqual(build_private_ssb_14059_candidates(current, plan, self.metadata(current)), ())

    def test_newer_2025_revision_yields_only_one_unreviewed_candidate(self) -> None:
        previous, _ = self.parsed()
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        revised["value"][1] = 12.9
        current, _ = self.parsed(revised, later=True)
        plan = reconcile_ssb_14059(previous, current)
        candidates = build_private_ssb_14059_candidates(current, plan, self.metadata(current))
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].survey_year, 2025)
        self.assertEqual(candidates[0].combined_share_ge_40_percent, Decimal("18.3"))
        self.assertEqual(candidates[0].review_state, "unreviewed")

    def test_unmarked_numeric_revision_remains_held(self) -> None:
        previous, _ = self.parsed()
        revised = deepcopy(self.fixture)
        revised["value"][1] = 12.9
        current, _ = self.parsed(revised, later=True)
        plan = reconcile_ssb_14059(previous, current)
        candidate = build_private_ssb_14059_candidates(current, plan, self.metadata(current))[0]
        self.assertEqual(candidate.review_state, "held")
        self.assertEqual(candidate.hold_reason, "unmarked_numeric_revision")

    def test_respondent_count_revision_is_not_hidden_by_unchanged_percentages(self) -> None:
        previous, _ = self.parsed()
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        revised["value"][5] = 5000
        current, _ = self.parsed(revised, later=True)
        plan = reconcile_ssb_14059(previous, current)
        candidates = build_private_ssb_14059_candidates(current, plan, self.metadata(current))
        self.assertEqual([item.survey_year for item in candidates], [2025])
        self.assertEqual(candidates[0].respondent_count, 5000)

    def test_duplicate_or_unknown_plan_year_is_rejected(self) -> None:
        capture, _ = self.parsed()
        for years in ((2024, 2024), (2026,)):
            with self.subTest(years=years):
                with self.assertRaises(SSB14059CandidateError):
                    build_private_ssb_14059_candidates(
                        capture, ReconciliationPlan("changed", years, True, capture.raw_sha256), self.metadata(capture)
                    )

    def test_changed_year_without_new_raw_version_is_rejected(self) -> None:
        capture, _ = self.parsed()
        with self.assertRaises(SSB14059CandidateError):
            build_private_ssb_14059_candidates(
                capture, ReconciliationPlan("unchanged", (2025,), False, capture.raw_sha256), self.metadata(capture)
            )

    def test_plan_measure_change_sets_must_cover_changed_years(self) -> None:
        capture, _ = self.parsed()
        plan = reconcile_ssb_14059(None, capture)
        from dataclasses import replace

        with self.assertRaises(SSB14059CandidateError):
            build_private_ssb_14059_candidates(
                capture,
                replace(plan, changed_response_count_years=(2024,)),
                self.metadata(capture),
            )

    def test_unknown_or_inconsistent_plan_state_is_rejected(self) -> None:
        capture, _ = self.parsed()
        for plan in (
            ReconciliationPlan("published", (2025,), True, capture.raw_sha256),
            ReconciliationPlan("changed", (), False, capture.raw_sha256),
            ReconciliationPlan("held", (2025,), True, capture.raw_sha256),
        ):
            with self.subTest(plan=plan):
                with self.assertRaises(SSB14059CandidateError):
                    build_private_ssb_14059_candidates(capture, plan, self.metadata(capture))

    def test_plan_for_another_response_is_rejected(self) -> None:
        previous, _ = self.parsed()
        revised = deepcopy(self.fixture)
        revised["updated"] = "2026-05-01T06:00:00Z"
        revised["value"][1] = 12.9
        current, _ = self.parsed(revised, later=True)
        plan = reconcile_ssb_14059(previous, current)
        with self.assertRaises(SSB14059CandidateError):
            build_private_ssb_14059_candidates(previous, plan, self.metadata(previous))

    def test_candidate_requires_matching_metadata_version(self) -> None:
        capture, _ = self.parsed()
        plan = reconcile_ssb_14059(None, capture)
        from dataclasses import replace

        mismatched = replace(
            self.metadata(capture),
            source_updated_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        with self.assertRaises(SSB14059CandidateError):
            build_private_ssb_14059_candidates(capture, plan, mismatched)


if __name__ == "__main__":
    unittest.main()
