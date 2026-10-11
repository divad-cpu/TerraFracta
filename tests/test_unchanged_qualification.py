"""Identical content cannot hide an explicitly supplied unsafe qualification."""
from dataclasses import replace
from datetime import timedelta
import unittest
from unittest.mock import patch

from tests import test_offline_update_run as support
from workers.offline_update_run import rehearse_update_run


def unchanged():
    item = support.structured_item()
    return replace(item, captured=replace(item.captured, previous_sha256=item.captured.current_sha256))


def run(item, trigger="manual"):
    return rehearse_update_run(replace(support.request(trigger), items=(item,)))


class UnchangedQualificationTests(unittest.TestCase):
    def test_semantic_mismatch_is_held_even_when_source_bytes_are_identical(self):
        item = unchanged()
        result = run(replace(item, structured_candidate=replace(item.structured_candidate,
            semantic_contract_sha256="d" * 64)))
        self.assertEqual(result.items[0].outcome, "held")
        self.assertEqual(result.items[0].reason_codes, ("semantic_contract_mismatch",))
        self.assertIsNotNone(result.items[0].decision)
        self.assertEqual(result.public_changes, 0)

    def test_revocation_expiry_and_unqualified_mapping_are_not_hidden_by_a_skip(self):
        item = unchanged()
        candidate = item.structured_candidate
        for change, code in (({"status": "revoked"}, "qualification_not_active"),
                             ({"public_use_allowed": False}, "public_use_not_allowed"),
                             ({"qualification_expires_at": candidate.evaluated_at}, "qualification_expired_or_invalid"),
                             ({"semantic_contract_sha256": "d" * 64}, "semantic_contract_mismatch"),
                             ({"unresolved_sample_errors": 1}, "qualification_samples_invalid")):
            with self.subTest(change=change):
                result = run(replace(item, structured_candidate=replace(candidate,
                    qualification=replace(candidate.qualification, **change))))
                self.assertEqual(result.items[0].outcome, "held")
                self.assertIn(code, result.items[0].reason_codes)

    def test_new_failed_safety_checks_are_held_without_new_public_changes(self):
        item = unchanged()
        for name in item.structured_candidate.checks.__dataclass_fields__:
            with self.subTest(check=name):
                candidate = replace(item.structured_candidate,
                    checks=replace(item.structured_candidate.checks, **{name: False}))
                result = run(replace(item, structured_candidate=candidate))
                self.assertEqual(result.items[0].outcome, "held")
                self.assertEqual(result.public_changes, 0)

    def test_explicit_policy_or_source_refusal_is_held(self):
        item = unchanged()
        for change, code in (({"policy_status": "inactive"}, "policy_not_active"),
                             ({"source_status": "proposed"}, "source_not_approved"),
                             ({"source_fetch_enabled": False}, "source_fetch_disabled"),
                             ({"parser_version": "other-parser"}, "parser_version_mismatch")):
            with self.subTest(change=change):
                result = run(replace(item, structured_candidate=replace(item.structured_candidate, **change)))
                self.assertEqual(result.items[0].outcome, "held")
                self.assertIn(code, result.items[0].reason_codes)

    def test_supplied_candidate_binding_mismatch_is_partial_and_not_covered(self):
        item = unchanged()
        candidate = item.structured_candidate
        alternatives = [replace(candidate, candidate_id="foreign"), replace(candidate, mode="shadow"),
            replace(candidate, policy_id="other-policy"), replace(candidate,
                evidence=replace(candidate.evidence, content_sha256="d" * 64)),
            replace(candidate, evidence=replace(candidate.evidence, locator="foreign-location"))]
        for value in alternatives:
            with self.subTest(candidate=value.candidate_id, policy=value.policy_id):
                result = run(replace(item, structured_candidate=value))
                self.assertEqual(result.items[0].reason_codes, ("candidate_binding_invalid",))
                self.assertFalse(result.items[0].source_binding_valid)
                self.assertEqual((result.state, result.covered_source_keys), ("partial", ()))

    def test_passing_supplied_candidate_stays_unchanged_without_a_decision_or_activation(self):
        result = run(unchanged())
        self.assertEqual(result.items[0].outcome, "unchanged")
        self.assertEqual(result.items[0].reason_codes, ("content_hash_unchanged",))
        self.assertIsNone(result.items[0].decision)
        self.assertEqual((result.model_items, result.estimated_model_input_tokens, result.public_changes), (0, 0, 0))

    def test_passing_shadow_candidate_stays_unchanged(self):
        item = unchanged()
        item = replace(item, structured_candidate=replace(item.structured_candidate, mode="shadow"))
        request = support.request()
        result = rehearse_update_run(replace(request, invocation=replace(request.invocation, mode="shadow"), items=(item,)))
        self.assertEqual(result.items[0].outcome, "unchanged")
        self.assertIsNone(result.items[0].decision)
        self.assertEqual(result.public_changes, 0)

    def test_legacy_missing_candidate_skip_is_unchanged_and_performs_no_gate_call(self):
        with patch("workers.offline_update_run.propose_machine_disposition", side_effect=AssertionError("unexpected decision")):
            result = run(replace(unchanged(), structured_candidate=None))
        self.assertEqual(result.items[0].outcome, "unchanged")
        self.assertIsNone(result.items[0].decision)

    def test_no_gate_call_when_item_limit_already_defers_the_row(self):
        item = unchanged()
        other = replace(item, captured=replace(item.captured, item_key="other"), structured_candidate=None)
        request = support.request()
        with patch("workers.offline_update_run.propose_machine_disposition", side_effect=AssertionError("unexpected decision")):
            result = rehearse_update_run(replace(request, items=(other, item),
                routing_limits=replace(request.routing_limits, max_items=1)))
        self.assertEqual([x.outcome for x in result.items], ["unchanged", "deferred"])
        self.assertEqual(result.items[1].reason_codes, ("item_limit_reached",))

    def test_unsupported_route_is_not_promoted_by_a_supplied_structured_candidate(self):
        item = unchanged()
        with patch("workers.offline_update_run.propose_machine_disposition", side_effect=AssertionError("unexpected decision")):
            result = run(replace(item, captured=replace(item.captured, extraction_route="qualified_prose")))
        self.assertEqual(result.items[0].outcome, "unchanged")
        self.assertEqual(result.model_items, 0)

    def test_manual_and_scheduled_paths_expose_the_same_semantic_hold(self):
        item = unchanged()
        item = replace(item, structured_candidate=replace(item.structured_candidate, semantic_contract_sha256="d" * 64))
        manual, scheduled = run(item), run(item, "scheduled")
        self.assertEqual(manual.items, scheduled.items)
        self.assertEqual(manual.items[0].outcome, "held")
        self.assertEqual([manual.public_changes, scheduled.public_changes], [0, 0])


if __name__ == "__main__":
    unittest.main()
