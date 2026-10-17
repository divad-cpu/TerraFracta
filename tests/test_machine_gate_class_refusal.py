"""Malformed classification holds one candidate without aborting its peers."""

from dataclasses import replace
from unittest import TestCase

from scripts.update_rehearsal import fictional_request
from tests.test_automatic_publication_gate import qualified_item
from workers.automatic_publication_gate import propose_machine_disposition
from workers.offline_update_run import rehearse_update_run
from workers.update_run_report import fictional_display_report


class MachineGateClassRefusalTests(TestCase):
    def test_nontext_unhashable_mode_is_an_opaque_hold(self):
        for mode in ([], {}, set()):
            with self.subTest(mode=mode):
                decision = propose_machine_disposition(replace(qualified_item(), mode=mode))
                self.assertEqual(decision.disposition, "held")
                self.assertIn("mode_unsupported", decision.reason_codes)

    def test_nontext_unhashable_change_class_is_an_opaque_hold(self):
        for change_class in ([], {}, set()):
            with self.subTest(change_class=change_class):
                decision = propose_machine_disposition(replace(
                    qualified_item(), change_class=change_class))
                self.assertEqual(decision.disposition, "held")
                self.assertIn("change_class_not_automatable", decision.reason_codes)

    def test_existing_hashable_but_unsupported_values_still_hold(self):
        for change_class in (None, False, 0, "qualified_prose", "structured_observation "):
            with self.subTest(change_class=change_class):
                decision = propose_machine_disposition(replace(
                    qualified_item(), change_class=change_class))
                self.assertEqual(decision.disposition, "held")
                self.assertIn("change_class_not_automatable", decision.reason_codes)

    def test_malformed_first_item_does_not_hide_a_valid_peer_or_its_draft(self):
        request = fictional_request("manual")
        first = request.items[0]
        bad = replace(first, structured_candidate=replace(
            first.structured_candidate, change_class=[]))
        good = replace(first, captured=replace(first.captured, item_key="fictional-safe-2025"),
                       structured_candidate=replace(first.structured_candidate,
                                                    candidate_id="fictional-safe-2025"))
        report = rehearse_update_run(replace(request, items=(bad, good)))
        self.assertEqual([item.outcome for item in report.items], ["held", "shadow_only"])
        self.assertIn("change_class_not_automatable", report.items[0].reason_codes)
        self.assertEqual(report.covered_source_keys, ("fictional-source",))
        self.assertEqual(report.public_changes, 0)
        self.assertEqual(fictional_display_report(report)["fictionalCandidate"]["itemKey"],
                         "fictional-safe-2025")
