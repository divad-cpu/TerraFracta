"""A successful job and a successful source check are separate facts."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from workers.missing_run_monitor import (
    CompletedRunReceipt, ScheduledWindow, assess_scheduled_window,
    oslo_weekly_due_at_utc, oslo_window_key,
)


DUE = oslo_weekly_due_at_utc(2026, 41)
WINDOW = ScheduledWindow(
    scope="fictional-country", due_at=DUE, grace=timedelta(minutes=30),
    now=DUE + timedelta(hours=1),
    due_source_keys=("fictional-a", "fictional-b", "fictional-c"),
    latest_scheduled_run=None,
)
SUCCESS = CompletedRunReceipt(
    trigger="scheduled", scope="fictional-country",
    window_key="2026-W41",
    finished_at=DUE + timedelta(minutes=4),
    run_state="completed",
    covered_source_keys=("fictional-a", "fictional-b", "fictional-c"),
    visibility_state="verified",
)


class MissingRunMonitorTests(unittest.TestCase):
    def test_monday_local_time_survives_daylight_saving_change(self) -> None:
        self.assertEqual(oslo_weekly_due_at_utc(2026, 2),
                         datetime(2026, 1, 5, 7, tzinfo=timezone.utc))
        self.assertEqual(oslo_weekly_due_at_utc(2026, 41),
                         datetime(2026, 10, 5, 6, tzinfo=timezone.utc))
        self.assertEqual(oslo_window_key(DUE), "2026-W41")
        with self.assertRaises(ValueError):
            oslo_weekly_due_at_utc(2026, 54)

    def test_missing_run_after_grace_is_attention(self) -> None:
        self.assertEqual(assess_scheduled_window(WINDOW).reason_code, "scheduled_run_missing")

    def test_before_due_and_within_grace_are_pending(self) -> None:
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, now=DUE - timedelta(minutes=1))).state, "pending")
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, now=DUE + timedelta(minutes=30))).reason_code,
            "within_grace_window")

    def test_correct_scope_and_coverage_are_healthy(self) -> None:
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, latest_scheduled_run=SUCCESS)).state, "healthy")

    def test_late_success_keeps_coverage_but_reports_attention(self) -> None:
        late = replace(SUCCESS, finished_at=DUE + timedelta(minutes=31))
        result = assess_scheduled_window(replace(WINDOW, latest_scheduled_run=late))
        self.assertEqual(result.reason_code, "scheduled_run_late")
        self.assertEqual(result.coverage_state, "complete")

    def test_wrong_scope_or_stale_success_does_not_hide_missing_run(self) -> None:
        for receipt in (
            replace(SUCCESS, scope="other-country"),
            replace(SUCCESS, finished_at=DUE - timedelta(minutes=1)),
            replace(SUCCESS, window_key="2026-W40"),
        ):
            self.assertEqual(assess_scheduled_window(
                replace(WINDOW, latest_scheduled_run=receipt)).reason_code, "scheduled_run_missing")

    def test_previous_week_finishing_late_cannot_count_for_current_week(self) -> None:
        stale = replace(SUCCESS, window_key="2026-W40",
                        finished_at=DUE + timedelta(minutes=5))
        result = assess_scheduled_window(replace(WINDOW, latest_scheduled_run=stale))
        self.assertEqual(result.reason_code, "scheduled_run_missing")

    def test_due_time_must_match_accepted_local_schedule(self) -> None:
        shifted = replace(WINDOW, due_at=DUE + timedelta(hours=1))
        self.assertEqual(assess_scheduled_window(shifted).reason_code, "window_invalid")

    def test_completed_run_with_missing_source_is_attention(self) -> None:
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, latest_scheduled_run=replace(
                SUCCESS, covered_source_keys=("fictional-a", "fictional-b")))).reason_code,
            "due_source_coverage_incomplete")

    def test_same_count_with_wrong_source_does_not_pass_coverage(self) -> None:
        substituted = replace(SUCCESS, covered_source_keys=(
            "fictional-a", "fictional-b", "fictional-other"))
        self.assertEqual(assess_scheduled_window(replace(
            WINDOW, latest_scheduled_run=substituted)).reason_code,
            "due_source_coverage_incomplete")

    def test_visibility_or_partial_run_is_not_success(self) -> None:
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, latest_scheduled_run=replace(SUCCESS, visibility_state="pending"))).reason_code,
            "visibility_unverified")
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, latest_scheduled_run=replace(SUCCESS, run_state="partial"))).reason_code,
            "run_not_completed")

    def test_impossible_receipt_is_invalid(self) -> None:
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, latest_scheduled_run=replace(
                SUCCESS, covered_source_keys=("fictional-a", "fictional-a")))).state,
            "invalid")

    def test_manual_catchup_keeps_missing_schedule_visible(self) -> None:
        catchup = replace(SUCCESS, trigger="manual")
        result = assess_scheduled_window(replace(WINDOW, latest_manual_run=catchup))
        self.assertEqual(result.state, "attention")
        self.assertEqual(result.reason_code, "scheduled_run_missing_manual_catchup_complete")
        self.assertEqual(result.coverage_state, "complete")

    def test_incomplete_manual_catchup_is_not_healthy_coverage(self) -> None:
        catchup = replace(SUCCESS, trigger="manual",
                          covered_source_keys=("fictional-a", "fictional-b"))
        result = assess_scheduled_window(replace(WINDOW, latest_manual_run=catchup))
        self.assertEqual(result.reason_code, "scheduled_run_missing_manual_catchup_incomplete")
        self.assertEqual(result.coverage_state, "incomplete")

    def test_receipt_with_wrong_trigger_is_invalid(self) -> None:
        result = assess_scheduled_window(replace(
            WINDOW, latest_scheduled_run=replace(SUCCESS, trigger="manual")))
        self.assertEqual(result.reason_code, "run_receipt_invalid")

    def test_invalid_grace_is_rejected_without_exception(self) -> None:
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, grace=None)).reason_code, "window_invalid")
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, grace=timedelta(days=30))).reason_code, "window_invalid")
        self.assertEqual(assess_scheduled_window(
            replace(WINDOW, scope="fictional/other")).reason_code, "window_invalid")


if __name__ == "__main__":
    unittest.main()
