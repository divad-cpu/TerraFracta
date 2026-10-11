"""The CLI report is explicit that no real information was collected."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest
from dataclasses import replace
from unittest.mock import patch

from scripts.update_rehearsal import fictional_request, FICTIONAL_RUN_LIMITS
from workers.response_byte_budget import ResponseBudgetError
from workers.offline_update_run import rehearse_update_run
from workers.update_run_report import fictional_display_report


class UpdateRehearsalCliTests(unittest.TestCase):
    def test_rehearsal_cannot_read_under_a_larger_limit_than_its_request(self):
        with patch('scripts.update_rehearsal.FICTIONAL_RUN_LIMITS',
                   replace(FICTIONAL_RUN_LIMITS,max_response_bytes=100)):
            for trigger in ('manual','scheduled'):
                with self.assertRaisesRegex(ResponseBudgetError,'insufficient'):
                    fictional_request(trigger)

    def test_revised_value_is_parsed_from_new_bytes_without_borrowing_original_identity(self) -> None:
        for trigger in ("manual", "scheduled"):
            old = fictional_display_report(rehearse_update_run(fictional_request(trigger)))
            new = fictional_display_report(rehearse_update_run(
                fictional_request(trigger, scenario="revised_value")))
            before, after = old["fictionalCandidate"], new["fictionalCandidate"]
            self.assertEqual(before["observation"]["value"], "27.4")
            self.assertEqual(after["observation"]["value"], "28.1")
            self.assertEqual(before["observation"]["semanticContractSha256"],
                             after["observation"]["semanticContractSha256"])
            for key in ("sourceVersionId", "contentSha256"):
                self.assertNotEqual(before["decision"][key], after["decision"][key])
            self.assertNotEqual(before["publication"]["id"], after["publication"]["id"])
            self.assertEqual(after["publication"]["snapshot"]["claims"][0]["assertion"],
                             "In 2025, the fictional share was 28.1%.")
            self.assertEqual(new["publicChanges"], 0)
            self.assertEqual(new["state"], "completed")
            self.assertEqual(new["items"][1]["outcome"], "held")

    def test_checked_in_revised_report_matches_the_shared_worker(self) -> None:
        report = fictional_display_report(rehearse_update_run(
            fictional_request("scheduled", scenario="revised_value")))
        fixture = Path(__file__).resolve().parents[1] / "fixtures/fictional_revised_update_report.json"
        self.assertEqual(json.loads(json.dumps(report)), json.loads(fixture.read_text()))

    def test_missing_source_is_partial_for_both_triggers(self) -> None:
        for trigger in ("manual", "scheduled"):
            report = fictional_display_report(rehearse_update_run(
                fictional_request(trigger, scenario="missing_source")))
            self.assertEqual(report["schemaVersion"], 3)
            self.assertEqual(report["state"], "partial")
            self.assertEqual(report["items"], [])
            self.assertEqual(report["coveredSourceKeys"], ())
            self.assertEqual(report["dueSourceKeys"], ("fictional-source",))

    def test_invalid_reference_is_withheld_and_cannot_borrow_other_item_coverage(self) -> None:
        for trigger in ("manual", "scheduled"):
            report = fictional_display_report(rehearse_update_run(
                fictional_request(trigger, scenario="invalid_citation")))
            self.assertEqual(report["state"], "partial")
            self.assertEqual(report["coveredSourceKeys"], ())
            self.assertEqual(report["items"][0]["source"], None)
            self.assertEqual(report["items"][0]["sourceBindingValid"], False)
            self.assertEqual(report["items"][1]["sourceBindingValid"], True)
            serialized = json.dumps(report)
            self.assertNotIn("127.0.0.1", serialized)
            self.assertNotIn("withheld-test-canary", serialized)

    def test_unknown_scenario_and_eligible_export_are_refused(self) -> None:
        with self.assertRaises(ValueError):
            fictional_request("manual", scenario="arbitrary-source")
        with self.assertRaises(ValueError):
            fictional_display_report(rehearse_update_run(
                fictional_request("manual", mode="publish_eligible")))

    def test_fictional_eligible_path_still_has_no_public_changes(self) -> None:
        request = fictional_request("scheduled", mode="publish_eligible")
        self.assertNotEqual(request.items[0].source.url,
                            request.items[0].source.retrieval_url)
        report = rehearse_update_run(request)
        self.assertEqual([item.outcome for item in report.items], [
            "eligible_for_activation_check", "held", "unchanged", "held",
        ])
        self.assertEqual(report.public_changes, 0)
        self.assertEqual(report.state, "partial")
        self.assertEqual(report.covered_source_keys, ("fictional-source",))
        self.assertIn("semantic_contract_mismatch", report.items[3].reason_codes)

    def test_manual_and_scheduled_reports_differ_only_by_trigger(self) -> None:
        reports = []
        for trigger in ("manual", "scheduled"):
            result = subprocess.run(
                [sys.executable, "-m", "scripts.update_rehearsal", "--trigger", trigger],
                check=True, text=True, capture_output=True,
            )
            report = json.loads(result.stdout)
            self.assertEqual(report["reportKind"], "fictional_rehearsal")
            self.assertEqual(report["mode"], "shadow")
            self.assertEqual(report["state"], "completed")
            self.assertEqual(report["startedAt"], "2026-09-28T06:00:00Z")
            self.assertEqual(report["scheduledDueAt"],
                             "2026-09-28T06:00:00Z" if trigger == "scheduled" else None)
            self.assertEqual(len(report["requestFingerprint"]), 64)
            self.assertEqual(len(report["items"]), 4)
            self.assertEqual(report["items"][3]["outcome"], "held")
            self.assertIn("semantic_contract_mismatch", report["items"][3]["reasonCodes"])
            self.assertTrue(all(
                item["source"]["url"].startswith("https://example.org/")
                for item in report["items"]
            ))
            self.assertTrue(all(item["publicUrl"] is None for item in report["items"]))
            reports.append(report)
        reports[0].pop("trigger")
        reports[1].pop("trigger")
        reports[0].pop("requestKey")
        reports[1].pop("requestKey")
        reports[0].pop("requestFingerprint")
        reports[1].pop("requestFingerprint")
        reports[0].pop("scheduledDueAt")
        reports[1].pop("scheduledDueAt")
        self.assertEqual(reports[0], reports[1])

    def test_checked_in_preview_matches_shared_scheduled_run(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "scripts.update_rehearsal", "--trigger", "scheduled"],
            check=True, text=True, capture_output=True,
        )
        fixture = Path(__file__).resolve().parents[1] / "fixtures/fictional_update_report.json"
        self.assertEqual(json.loads(result.stdout), json.loads(fixture.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
