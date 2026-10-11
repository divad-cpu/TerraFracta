"""A held source reference cannot occupy otherwise available model capacity."""
from dataclasses import replace
import unittest
from unittest.mock import patch

from tests import test_offline_update_run as support
from workers.offline_update_run import rehearse_update_run


def prose(key="candidate-1", tokens=120):
    base = support.structured_item()
    return replace(base, captured=replace(base.captured, item_key=key,
        extraction_route="qualified_prose", model_processing_allowed=True,
        estimated_model_input_tokens=tokens), structured_candidate=None)


def invalid(item):
    return replace(item, source=replace(item.source, url="http://127.0.0.1/private"))


class OfflineSourceCapacityTests(unittest.TestCase):
    def test_held_source_leaves_capacity_for_later_valid_prose(self):
        result = rehearse_update_run(replace(support.request(),
            items=(invalid(prose()), prose("candidate-2"))))
        self.assertEqual([x.outcome for x in result.items], ["held", "model_candidate"])
        self.assertEqual(result.items[0].reason_codes, ("source_reference_invalid",))
        self.assertFalse(result.items[0].source_binding_valid)
        self.assertEqual((result.model_items, result.estimated_model_input_tokens), (1, 120))
        self.assertEqual(result.covered_source_keys, ())
        self.assertEqual((result.state, result.public_changes), ("partial", 0))

    def test_all_held_sources_report_zero_model_capacity(self):
        result = rehearse_update_run(replace(support.request(),
            items=(invalid(prose()), invalid(prose("candidate-2")))))
        self.assertEqual([x.outcome for x in result.items], ["held", "held"])
        self.assertEqual((result.model_items, result.estimated_model_input_tokens), (0, 0))
        self.assertEqual(result.state, "partial")

    def test_held_source_does_not_refund_the_overall_item_position(self):
        request = support.request()
        result = rehearse_update_run(replace(request, items=(invalid(prose()), prose("candidate-2")),
            routing_limits=replace(request.routing_limits, max_items=1)))
        self.assertEqual([x.outcome for x in result.items], ["held", "deferred"])
        self.assertEqual(result.items[1].reason_codes, ("item_limit_reached",))
        self.assertEqual((result.model_items, result.estimated_model_input_tokens), (0, 0))

    def test_held_source_does_not_refund_its_seen_identity(self):
        result = rehearse_update_run(replace(support.request(), items=(invalid(prose()), prose())))
        self.assertEqual([x.outcome for x in result.items], ["held", "held"])
        self.assertEqual(result.items[1].reason_codes, ("item_identity_invalid",))
        self.assertEqual((result.model_items, result.estimated_model_input_tokens), (0, 0))

    def test_held_source_leaves_token_capacity_without_raising_token_limit(self):
        request = support.request()
        request = replace(request, invocation=replace(request.invocation,
            limits=replace(request.invocation.limits, max_model_calls=2)),
            routing_limits=replace(request.routing_limits, max_model_items=2))
        result = rehearse_update_run(replace(request,
            items=(invalid(prose(tokens=150)), prose("candidate-2", 100))))
        self.assertEqual([x.outcome for x in result.items], ["held", "model_candidate"])
        self.assertEqual((result.model_items, result.estimated_model_input_tokens), (1, 100))

    def test_existing_source_reference_refusals_do_not_consume_capacity(self):
        base = prose()
        for change in ({"url": "https://www.ssb.no/statbank"}, {"publisher": ""}, {"title": ""},
                       {"locator": ""}, {"content_sha256": "b" * 64},
                       {"source_version_id": "not-a-version"}):
            with self.subTest(change=change):
                bad = replace(base, source=replace(base.source, **change))
                result = rehearse_update_run(replace(support.request(), items=(bad, prose("candidate-2"))))
                self.assertEqual([x.outcome for x in result.items], ["held", "model_candidate"])
                self.assertEqual((result.model_items, result.estimated_model_input_tokens), (1, 120))

    def test_valid_first_prose_still_consumes_the_original_model_limit(self):
        result = rehearse_update_run(replace(support.request(), items=(prose(), prose("candidate-2"))))
        self.assertEqual([x.outcome for x in result.items], ["model_candidate", "deferred"])
        self.assertEqual(result.items[1].reason_codes, ("model_limit_reached",))
        self.assertEqual((result.model_items, result.estimated_model_input_tokens), (1, 120))

    def test_valid_source_cannot_bypass_existing_router_qualification(self):
        base = prose()
        for change, reason in (({"source_status": "proposed"}, "source_not_enabled"),
                               ({"fetch_enabled": False}, "source_not_enabled"),
                               ({"model_processing_allowed": False}, "model_route_not_qualified")):
            with self.subTest(change=change):
                first = replace(base, captured=replace(base.captured, **change))
                result = rehearse_update_run(replace(support.request(), items=(first, prose("candidate-2"))))
                self.assertEqual(result.items[0].reason_codes, (reason,))
                self.assertEqual([x.outcome for x in result.items], ["held", "model_candidate"])

    def test_invalid_structured_reference_stops_before_machine_decision(self):
        with patch("workers.offline_update_run.propose_machine_disposition", side_effect=AssertionError("unexpected decision")):
            result = rehearse_update_run(replace(support.request(), items=(invalid(support.structured_item()),)))
        self.assertEqual(result.items[0].reason_codes, ("source_reference_invalid",))
        self.assertIsNone(result.items[0].decision)
        self.assertEqual(result.public_changes, 0)

    def test_internal_screen_does_not_rewrite_caller_capture_or_source(self):
        first, second = invalid(prose()), prose("candidate-2")
        before = (first, second, first.captured, second.captured)
        request = replace(support.request(), items=(first, second))
        rehearse_update_run(request)
        self.assertEqual(before, (first, second, first.captured, second.captured))
        self.assertIs(request.items[0], first)
        self.assertEqual(first.captured.source_status, "approved")

    def test_manual_and_scheduled_paths_share_the_same_capacity_screen(self):
        results = [rehearse_update_run(replace(support.request(trigger),
            items=(invalid(prose()), prose("candidate-2")))) for trigger in ("manual", "scheduled")]
        self.assertEqual(results[0].items, results[1].items)
        self.assertEqual([x.outcome for x in results[0].items], ["held", "model_candidate"])
        self.assertEqual([x.public_changes for x in results], [0, 0])


if __name__ == "__main__":
    unittest.main()
