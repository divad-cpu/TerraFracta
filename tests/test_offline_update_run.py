"""Manual and scheduled triggers share one offline decision path."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import unittest

from tests.test_automatic_publication_gate import qualified_item
from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.offline_update_run import (
    OfflineRunRequest,
    OfflineSourceRef,
    OfflineUpdateItem,
    rehearse_update_run,
)
from workers.update_request_identity import RunLimits, UpdateRequest, scheduled_request_key
from workers.missing_run_monitor import oslo_weekly_due_at_utc


def structured_item() -> OfflineUpdateItem:
    candidate = qualified_item()
    return OfflineUpdateItem(
        captured=CapturedWorkItem(
            item_key="candidate-1",
            source_status="approved",
            fetch_enabled=True,
            current_sha256="a" * 64,
            previous_sha256="b" * 64,
            extraction_route="structured",
            model_processing_allowed=False,
            estimated_model_input_tokens=0,
        ),
        source=OfflineSourceRef(
            source_version_id=candidate.evidence.source_version_id,
            publisher="Fictional publisher", title="Fictional table",
            url="https://example.org/table",
            retrieval_url=candidate.evidence.source_url,
            locator=candidate.evidence.locator,
            content_sha256=candidate.evidence.content_sha256,
            source_key="source-1",
        ),
        structured_candidate=candidate,
    )


def request(trigger: str = "manual") -> OfflineRunRequest:
    return OfflineRunRequest(
        invocation=UpdateRequest(
            request_key=(scheduled_request_key(
                "fictional-country", oslo_weekly_due_at_utc(2026, 40))
                if trigger == "scheduled" else "fictional:manual:2026w40"),
            trigger=trigger,
            scheduled_due_at=(oslo_weekly_due_at_utc(2026, 40)
                              if trigger == "scheduled" else None),
            actor_id="runner:fictional", scope="fictional-country",
            mode="publish_eligible", strategy="incremental",
            code_version="local-rehearsal-v1", policy_version="policy-v1",
            limits=RunLimits(
                max_items=2, max_response_bytes=100_000,
                max_model_calls=1, max_model_input_tokens=200,
                max_model_output_tokens=100, max_retries=0,
                max_duration_seconds=60,
                run_cap_usd=Decimal("0.01"), month_cap_usd=Decimal("0.10"),
            ),
        ),
        run_id="11111111-1111-4111-8111-111111111111",
        started_at=datetime(2026, 9, 29, 12, tzinfo=timezone.utc),
        finished_at=datetime(2026, 9, 29, 12, 1, tzinfo=timezone.utc),
        items=(structured_item(),),
        due_source_keys=("source-1",),
        routing_limits=RoutingLimits(max_items=2, max_model_items=1, max_model_input_tokens=200),
    )


class OfflineUpdateRunTests(unittest.TestCase):
    def test_manual_and_scheduled_triggers_get_same_decision(self) -> None:
        manual = rehearse_update_run(request())
        scheduled = rehearse_update_run(request("scheduled"))
        self.assertEqual(manual.items, scheduled.items)
        self.assertEqual(manual.items[0].outcome, "eligible_for_activation_check")
        self.assertEqual(manual.public_changes, 0)
        self.assertEqual(scheduled.public_changes, 0)
        self.assertEqual(manual.state, "partial")
        self.assertEqual(scheduled.due_source_keys, ("source-1",))
        self.assertEqual(scheduled.covered_source_keys, ("source-1",))

    def test_unexpected_or_duplicate_due_source_is_rejected(self) -> None:
        original = request()
        for keys in (("fictional-other",), ("source-1", "source-1")):
            with self.assertRaises(ValueError):
                rehearse_update_run(replace(original, due_source_keys=keys))

    def test_uncovered_due_source_stays_visible_in_report(self) -> None:
        original = request()
        result = rehearse_update_run(replace(
            original, due_source_keys=("source-1", "fictional-uncovered")))
        self.assertEqual(result.due_source_keys,
                         ("source-1", "fictional-uncovered"))
        self.assertEqual(result.covered_source_keys, ("source-1",))

    def test_valid_item_cannot_hide_invalid_binding_from_the_same_source(self) -> None:
        original = request()
        valid = original.items[0]
        invalid = replace(valid, captured=replace(valid.captured, item_key="candidate-2"),
                          source=replace(valid.source, url="http://127.0.0.1/private"))
        result = rehearse_update_run(replace(original, items=(valid, invalid)))
        self.assertEqual(result.covered_source_keys, ())
        self.assertEqual(result.state, "partial")
        self.assertTrue(result.items[0].source_binding_valid)
        self.assertFalse(result.items[1].source_binding_valid)

        self.assertEqual(result.state, "partial")

    def test_shadow_run_cannot_become_publicly_eligible(self) -> None:
        original = request()
        shadow_item = replace(structured_item(),
                              structured_candidate=replace(qualified_item(), mode="shadow"))
        result = rehearse_update_run(replace(
            original, invocation=replace(original.invocation, mode="shadow"),
            items=(shadow_item,),
        ))
        self.assertEqual(result.items[0].outcome, "shadow_only")

    def test_mismatched_hash_is_held_before_decision(self) -> None:
        original = request()
        changed = replace(structured_item(), captured=replace(
            structured_item().captured, current_sha256="c" * 64))
        result = rehearse_update_run(replace(original, items=(changed,)))
        self.assertEqual(result.items[0].reason_codes, ("source_reference_invalid",))
        self.assertIsNone(result.items[0].decision)
        self.assertEqual(result.covered_source_keys, ())

    def test_candidate_cannot_change_displayed_source_locator(self) -> None:
        original = request()
        changed = replace(structured_item(), source=replace(
            structured_item().source, locator="invented-location"))
        result = rehearse_update_run(replace(original, items=(changed,)))
        self.assertEqual(result.items[0].reason_codes, ("candidate_binding_invalid",))

    def test_public_citation_and_exact_retrieval_url_have_separate_roles(self) -> None:
        original = request()
        self.assertEqual(rehearse_update_run(original).items[0].outcome,
                         "eligible_for_activation_check")
        changed = replace(structured_item(), source=replace(
            structured_item().source, retrieval_url="https://example.org/other-data"))
        result = rehearse_update_run(replace(original, items=(changed,)))
        self.assertEqual(result.items[0].reason_codes, ("candidate_binding_invalid",))
        changed_link = replace(structured_item(), source=replace(
            structured_item().source, url="https://example.org/unapproved-table"))
        result = rehearse_update_run(replace(original, items=(changed_link,)))
        self.assertEqual(result.items[0].reason_codes, ("candidate_binding_invalid",))

    def test_source_coverage_key_cannot_replace_candidate_source(self) -> None:
        original = request()
        altered = replace(structured_item(), source=replace(
            structured_item().source, source_key="fictional-other"))
        result = rehearse_update_run(replace(
            original, due_source_keys=("fictional-other",), items=(altered,)))
        self.assertEqual(result.items[0].reason_codes, ("candidate_binding_invalid",))
        self.assertEqual(result.covered_source_keys, ())

    def test_fictional_rehearsal_rejects_real_source_address(self) -> None:
        original = request()
        changed = replace(structured_item(), source=replace(
            structured_item().source, url="https://www.ssb.no/statbank"))
        result = rehearse_update_run(replace(original, items=(changed,)))
        self.assertEqual(result.items[0].reason_codes, ("source_reference_invalid",))

    def test_candidate_cannot_change_admitted_policy(self) -> None:
        original = request()
        candidate = replace(qualified_item(), policy_id="other-policy")
        changed = replace(structured_item(), structured_candidate=candidate)
        result = rehearse_update_run(replace(original, items=(changed,)))
        self.assertEqual(result.items[0].reason_codes, ("candidate_binding_invalid",))

    def test_model_candidate_is_not_called_or_published(self) -> None:
        original = request()
        prose = replace(structured_item(), captured=replace(
            structured_item().captured,
            extraction_route="qualified_prose",
            model_processing_allowed=True,
            estimated_model_input_tokens=120,
        ), structured_candidate=None)
        result = rehearse_update_run(replace(original, items=(prose,)))
        self.assertEqual(result.items[0].outcome, "model_candidate")
        self.assertEqual(result.model_items, 1)
        self.assertEqual(result.public_changes, 0)

    def test_unbounded_scope_is_rejected(self) -> None:
        original = request()
        with self.assertRaises(ValueError):
            rehearse_update_run(replace(
                original, invocation=replace(original.invocation, scope="")))

    def test_routing_cannot_raise_admitted_model_limit(self) -> None:
        original = request()
        with self.assertRaises(ValueError):
            rehearse_update_run(replace(
                original,
                routing_limits=RoutingLimits(2, 2, 200),
            ))

    def test_run_duration_and_report_size_follow_admitted_boundaries(self) -> None:
        original = request()
        with self.assertRaises(ValueError):
            rehearse_update_run(replace(
                original, finished_at=original.started_at + timedelta(seconds=61)))
        with self.assertRaises(ValueError):
            rehearse_update_run(replace(
                original, items=(structured_item(),) * 51))

    def test_scheduled_run_cannot_start_before_its_due_window(self) -> None:
        scheduled = request("scheduled")
        with self.assertRaisesRegex(ValueError, "before its due"):
            rehearse_update_run(replace(
                scheduled, started_at=oslo_weekly_due_at_utc(2026, 40) - timedelta(seconds=1)))


if __name__ == "__main__":
    unittest.main()
