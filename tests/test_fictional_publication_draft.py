from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import unittest

from scripts.update_rehearsal import fictional_request
from workers.fictional_publication_draft import build_fictional_publication_draft
from workers.offline_update_run import rehearse_update_run


class FictionalPublicationDraftTests(unittest.TestCase):
    def test_same_parsed_value_receipt_and_locator_make_a_draft_only(self) -> None:
        report = rehearse_update_run(fictional_request("manual"))
        draft = build_fictional_publication_draft(report)
        self.assertEqual(draft["publication"]["kind"], "draft")
        claim = draft["publication"]["snapshot"]["claims"][0]
        self.assertEqual(claim["assertion"], "In 2025, the fictional share was 27.4%.")
        self.assertEqual(claim["evidence"][0]["locator"], report.items[0].source.locator)
        self.assertEqual(draft["decision"]["contentSha256"], report.items[0].source.content_sha256)
        self.assertEqual(draft["decision"]["disposition"], "shadow_only")

    def test_held_or_uncovered_scenarios_never_become_drafts(self) -> None:
        for scenario in ("missing_source", "invalid_citation"):
            report = rehearse_update_run(fictional_request("scheduled", scenario=scenario))
            self.assertIsNone(build_fictional_publication_draft(report))
        report = rehearse_update_run(fictional_request("scheduled"))
        self.assertIsNone(build_fictional_publication_draft(replace(report, items=report.items[1:])))

    def test_hash_locator_mapping_unit_and_private_address_drift_are_refused(self) -> None:
        report = rehearse_update_run(fictional_request("manual"))
        item = report.items[0]
        for observation in (
            replace(item.observation, content_sha256="f" * 64),
            replace(item.observation, locator="invented-location"),
            replace(item.observation, semantic_contract_sha256="f" * 64),
            replace(item.observation, unit="count"),
            replace(item.observation, value=Decimal("100.1")),
            replace(item.observation, value=Decimal("27.41")),
        ):
            with self.subTest(observation=observation), self.assertRaises(ValueError):
                build_fictional_publication_draft(replace(report, items=(replace(item, observation=observation),)))
        with self.assertRaises(ValueError):
            build_fictional_publication_draft(replace(report, items=(replace(item, source=replace(item.source, url="https://example.org/unaccepted")),)))

    def test_source_retrieval_comes_from_receipt_not_run_start(self) -> None:
        report = rehearse_update_run(fictional_request("manual"))
        shifted = replace(report, started_at=report.finished_at)
        draft = build_fictional_publication_draft(shifted)
        self.assertEqual(draft["publication"]["snapshot"]["claims"][0]["evidence"][0]["retrievedAt"], "2026-09-28T06:00:00Z")

    def test_nonfictional_eligible_operation_cannot_use_the_fictional_builder(self) -> None:
        with self.assertRaises(ValueError):
            build_fictional_publication_draft(rehearse_update_run(fictional_request("manual", mode="publish_eligible")))


if __name__ == "__main__":
    unittest.main()
