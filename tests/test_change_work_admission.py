"""The optional offline price screen cannot bypass captured-work routing gates."""
from dataclasses import replace
import unittest

from workers.change_work_router import CapturedWorkItem, RoutingLimits, route_captured_changes


def item(key, tokens=1):
    return CapturedWorkItem(key, "approved", True, "a" * 64, "b" * 64,
                            "qualified_prose", True, tokens)


class ChangeWorkAdmissionTests(unittest.TestCase):
    def test_no_screen_retains_original_candidate_accounting(self):
        entries = (item("one"), item("two"), item("three"))
        limits = RoutingLimits(3, 2, 2)
        self.assertEqual(route_captured_changes(entries, limits),
                         route_captured_changes(entries, limits, model_admission=None))
        self.assertEqual(route_captured_changes(entries, limits).model_items, 2)

    def test_rejected_screen_counts_neither_models_nor_input_tokens(self):
        seen = []
        def screen(entry):
            seen.append(entry.item_key)
            return "offline_price_refusal" if entry.item_key == "large" else None
        report = route_captured_changes((item("large", 50), item("small")),
                                        RoutingLimits(2, 1, 50), model_admission=screen)
        self.assertEqual(seen, ["large", "small"])
        self.assertEqual(report.model_items, 1)
        self.assertEqual(report.estimated_model_input_tokens, 1)
        self.assertEqual(report.items[0].reason_code, "offline_price_refusal")

    def test_source_hash_rights_and_unchanged_work_never_reach_screen(self):
        seen = []
        entries = (
            replace(item("candidate"), source_status="candidate"),
            replace(item("disabled"), fetch_enabled=False),
            replace(item("bad-hash"), current_sha256="invalid"),
            replace(item("unchanged"), previous_sha256="a" * 64),
            replace(item("structured"), extraction_route="structured"),
            replace(item("forbidden"), model_processing_allowed=False),
            replace(item("unqualified"), extraction_route="unqualified"),
        )
        report = route_captured_changes(entries, RoutingLimits(7, 7, 7),
                                        model_admission=lambda entry: seen.append(entry.item_key))
        self.assertEqual(seen, [])
        self.assertEqual(report.model_items, 0)
        self.assertEqual([entry.disposition for entry in report.items],
                         ["held", "held", "held", "unchanged", "deterministic", "held", "held"])

    def test_missing_or_exceeded_model_limits_never_reach_screen(self):
        for limits in (RoutingLimits(2, 0, 1), RoutingLimits(2, None, 1),
                       RoutingLimits(2, 1, 0), RoutingLimits(2, 1, None)):
            seen = []
            report = route_captured_changes((item("one"), item("two")), limits,
                                            model_admission=lambda entry: seen.append(entry.item_key))
            self.assertEqual(seen, [])
            self.assertEqual(report.model_items, 0)
        seen = []
        route_captured_changes((item("large", 2), item("small")), RoutingLimits(2, 1, 1),
                               model_admission=lambda entry: seen.append(entry.item_key))
        self.assertEqual(seen, ["small"])

    def test_rejection_does_not_refund_global_bound_or_identity(self):
        seen = []
        def reject(entry):
            seen.append(entry.item_key)
            return "offline_refusal"
        report = route_captured_changes((item("same"), item("same"), item("late")),
                                        RoutingLimits(2, 1, 3), model_admission=reject)
        self.assertEqual(seen, ["same"])
        self.assertEqual([entry.reason_code for entry in report.items],
                         ["offline_refusal", "item_identity_invalid", "item_limit_reached"])

    def test_successful_screen_runs_once_per_admitted_candidate(self):
        seen = []
        report = route_captured_changes((item("one"), item("two"), item("late")),
                                        RoutingLimits(3, 2, 2),
                                        model_admission=lambda entry: seen.append(entry.item_key))
        self.assertEqual(seen, ["one", "two"])
        self.assertEqual(report.model_items, 2)
        self.assertEqual(report.estimated_model_input_tokens, 2)
        self.assertEqual(report.items[2].reason_code, "model_limit_reached")


if __name__ == "__main__":
    unittest.main()
