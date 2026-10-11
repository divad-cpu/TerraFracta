"""Safety checks for the planning files while no runtime policy is approved."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest

from workers.ssb_14059_capture import DATA_URL, METADATA_URL


ROOT = Path(__file__).resolve().parents[1]


class CandidateConfigTests(unittest.TestCase):
    def test_offline_github_rehearsal_has_no_schedule_or_write_permission(self) -> None:
        workflow = ROOT / ".github/workflows/update-rehearsal.yml"
        parsed = json.loads(subprocess.run(
            ("yq", "-o=json", ".", str(workflow)),
            check=True, capture_output=True, text=True,
        ).stdout)
        self.assertEqual(parsed["on"], {"workflow_dispatch": None})
        self.assertEqual(parsed["permissions"], {"contents": "read"})

    def test_every_source_and_update_route_is_disabled(self) -> None:
        registry = json.loads((ROOT / "config/source_registry.candidate.json").read_text())
        policy = json.loads((ROOT / "config/update_policy.candidate.json").read_text())

        self.assertEqual(registry["document_type"], "planning_candidate_not_runtime_config")
        self.assertEqual(registry["activation_state"], "disabled")
        self.assertTrue(registry["sources"])
        self.assertEqual(
            len({source["source_id"] for source in registry["sources"]}),
            len(registry["sources"]),
        )
        for source in registry["sources"]:
            with self.subTest(source=source["source_id"]):
                self.assertIsInstance(source["source_id"], str)
                self.assertTrue(source["source_id"])
                self.assertEqual(source["source_state"], "candidate")
                self.assertIs(source["collection_enabled"], False)
                self.assertIs(source["auto_publication_enabled"], False)
                self.assertIsNone(source["adapter_id"])
                self.assertIsNone(source["adapter_version"])
                self.assertIsNone(source["qualification_record_id"])
                self.assertIsNone(source["schedule"])
                self.assertIsNone(source["request_limit"])
                self.assertIsNone(source["max_response_bytes"])
                self.assertIsNone(source["review_owner"])
                self.assertEqual(source["qualified_auto_publication_change_types"], [])
                for right in (
                    "fetch", "retain", "model_processing", "excerpt", "public_derived_reuse"
                ):
                    self.assertEqual(source["rights"][right], "unreviewed")
                self.assertIsNone(source["rights"]["review_record_id"])

        self.assertEqual(policy["document_type"], "planning_candidate_not_runtime_config")
        self.assertEqual(policy["policy_status"], "proposed")
        for flag in ("runtime_enabled", "publication_enabled", "schedule_enabled", "chat_trigger_enabled"):
            self.assertIs(policy[flag], False)
        self.assertIsNone(policy["active_schedule"])
        self.assertEqual(policy["accepted_initial_schedule"], {
            "day_of_week": "monday",
            "local_time": "08:00",
            "timezone": "Europe/Oslo",
        })
        self.assertEqual(policy["active_jurisdiction_ids"], [])
        self.assertIsNone(policy["notification_destination"])
        self.assertTrue(all(limit is None for limit in policy["limits"].values()))
        self.assertEqual(policy["automatic_publication_qualification_records"], [])

    def test_exact_ssb_candidate_matches_offline_query_contract(self) -> None:
        registry = json.loads((ROOT / "config/source_registry.candidate.json").read_text())
        candidates = [
            source for source in registry["sources"]
            if source["source_id"] == "SSB-14059-NO-HOUSING-COSTS"
        ]
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["endpoint_queries"], [METADATA_URL, DATA_URL])
        self.assertIsNone(candidates[0]["adapter_id"])
        self.assertIsNone(candidates[0]["review_owner"])


if __name__ == "__main__":
    unittest.main()
