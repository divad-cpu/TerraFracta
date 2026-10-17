"""A decision belongs to its run, independently of source retrieval age."""

from dataclasses import replace
from datetime import timedelta, timezone
from unittest import TestCase
from unittest.mock import patch

from scripts.update_rehearsal import fictional_request
from workers.offline_update_run import rehearse_update_run
from workers.update_run_report import fictional_display_report


class OfflineDecisionWindowTests(TestCase):
    def request_at(self, when, *, trigger="manual", unchanged=False):
        request = fictional_request(trigger)
        item = request.items[0]
        if unchanged:
            item = replace(item, captured=replace(
                item.captured, previous_sha256=item.captured.current_sha256))
        return replace(request, items=(replace(item, structured_candidate=replace(
            item.structured_candidate, evaluated_at=when)),))

    def assert_unbound(self, request):
        with patch("workers.offline_update_run.propose_machine_disposition",
                   side_effect=AssertionError("Unbound decision was evaluated")):
            report = rehearse_update_run(request)
        item = report.items[0]
        self.assertEqual(item.outcome, "held")
        self.assertEqual(item.reason_codes, ("candidate_binding_invalid",))
        self.assertFalse(item.source_binding_valid)
        self.assertIsNone(item.decision)
        self.assertEqual(report.covered_source_keys, ())
        self.assertEqual(report.public_changes, 0)
        self.assertEqual(report.state, "partial")
        display = fictional_display_report(report)
        self.assertIsNone(display["fictionalCandidate"])

    def test_decision_before_run_does_not_borrow_current_source_coverage(self):
        request = fictional_request("manual")
        self.assert_unbound(self.request_at(request.started_at - timedelta(microseconds=1)))

    def test_decision_after_finish_is_not_a_completed_shadow_result(self):
        request = fictional_request("manual")
        self.assert_unbound(self.request_at(request.finished_at + timedelta(microseconds=1)))

    def test_unchanged_content_still_requires_a_current_decision_window(self):
        request = fictional_request("scheduled")
        self.assert_unbound(self.request_at(request.started_at - timedelta(microseconds=1),
                                           trigger="scheduled", unchanged=True))

    def test_malformed_and_non_utc_decision_clocks_hold_without_evaluation(self):
        request = fictional_request("manual")
        for when in (None, True, "2026-09-28T06:01:00Z",
                     request.finished_at.replace(tzinfo=None),
                     request.finished_at.astimezone(timezone(timedelta(hours=1)))):
            with self.subTest(when=when):
                self.assert_unbound(self.request_at(when))

    def test_both_exact_run_endpoints_remain_admitted(self):
        request = fictional_request("manual")
        for when in (request.started_at, request.finished_at):
            with self.subTest(when=when):
                report = rehearse_update_run(self.request_at(when))
                self.assertEqual(report.items[0].outcome, "shadow_only")
                self.assertIsNotNone(fictional_display_report(report)["fictionalCandidate"])

    def test_older_source_receipt_does_not_need_to_be_refetched(self):
        request = fictional_request("manual")
        item = request.items[0]
        candidate = replace(item.structured_candidate, evidence=replace(
            item.structured_candidate.evidence,
            retrieved_at=request.started_at - timedelta(days=1)))
        report = rehearse_update_run(replace(request, items=(replace(
            item, structured_candidate=candidate),)))
        self.assertEqual(report.items[0].outcome, "shadow_only")
        self.assertEqual(fictional_display_report(report)["fictionalCandidate"][
            "publication"]["snapshot"]["claims"][0]["evidence"][0]["retrievedAt"],
            "2026-09-27T06:00:00Z")
