"""Synthetic cases for fail-closed machine disposition; no runtime authority."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import unittest

from workers.automatic_publication_gate import (
    CandidateChecks,
    EvidenceReceipt,
    MachineDecisionInput,
    RouteQualification,
    propose_machine_disposition,
)


def qualified_item() -> MachineDecisionInput:
    return MachineDecisionInput(
        candidate_id="candidate-1",
        mode="publish_eligible",
        policy_id="policy-v1",
        policy_status="active",
        source_status="approved",
        source_fetch_enabled=True,
        candidate_source_id="source-1",
        change_class="structured_observation",
        parser_version="parser-v1",
        semantic_contract_sha256="c" * 64,
        evidence=EvidenceReceipt(
            source_id="source-1",
            source_version_id="22222222-2222-4222-8222-222222222222",
            source_url="https://example.org/data/table",
            content_sha256="a" * 64,
            locator="period=2025;measure=share",
            retrieved_at=datetime(2026, 9, 29, 12, tzinfo=timezone.utc),
        ),
        qualification=RouteQualification(
            qualification_id="qualification-v1",
            policy_id="policy-v1",
            source_id="source-1",
            source_url="https://example.org/data/table",
            public_citation_url="https://example.org/table",
            change_class="structured_observation",
            parser_version="parser-v1",
            status="active",
            public_use_allowed=True,
            qualification_expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            reviewed_sample_count=3,
            unresolved_sample_errors=0,
            semantic_contract_sha256="c" * 64,
        ),
        checks=CandidateChecks(*(True for _ in range(9))),
        evaluated_at=datetime(2026, 9, 29, 12, 1, tzinfo=timezone.utc),
    )


class MachineDispositionTests(unittest.TestCase):
    def test_qualified_structured_change_needs_activation_recheck(self) -> None:
        result = propose_machine_disposition(qualified_item())
        self.assertEqual(result.disposition, "eligible_for_activation_check")
        self.assertEqual(result.reason_codes, ("qualified_checks_passed",))
        self.assertEqual(result.source_version_id, "22222222-2222-4222-8222-222222222222")
        self.assertEqual(result.evidence_locator, "period=2025;measure=share")
        self.assertEqual(len(result.check_trace), 9)
        self.assertTrue(all(passed for _, passed in result.check_trace))

    def test_shadow_never_approves_public_activation(self) -> None:
        result = propose_machine_disposition(replace(qualified_item(), mode="shadow"))
        self.assertEqual(result.disposition, "shadow_only")

    def test_changed_source_and_parser_require_requalification(self) -> None:
        item = qualified_item()
        changed = replace(
            item,
            parser_version="parser-v2",
            checks=replace(item.checks, source_version_current=False),
        )
        result = propose_machine_disposition(changed)
        self.assertEqual(result.disposition, "held")
        self.assertIn("parser_version_mismatch", result.reason_codes)
        self.assertIn("source_version_not_current", result.reason_codes)

    def test_rights_loss_and_conflict_hold_even_with_valid_evidence(self) -> None:
        item = qualified_item()
        changed = replace(
            item,
            qualification=replace(item.qualification, public_use_allowed=False),
            checks=replace(item.checks, no_material_conflict=False),
        )
        result = propose_machine_disposition(changed)
        self.assertEqual(result.disposition, "held")
        self.assertIn("public_use_not_allowed", result.reason_codes)
        self.assertIn("material_conflict", result.reason_codes)

    def test_model_prose_cannot_use_structured_qualification(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(item, change_class="official_announcement"))
        self.assertEqual(result.disposition, "held")
        self.assertIn("change_class_not_automatable", result.reason_codes)
        self.assertIn("change_class_mismatch", result.reason_codes)

    def test_invented_locator_or_invalid_receipt_holds(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(
            replace(
                item,
                evidence=replace(item.evidence, source_url="http://example.org/data", locator=""),
                checks=replace(item.checks, evidence_locator_verified=False),
            )
        )
        self.assertEqual(result.disposition, "held")
        self.assertIn("evidence_receipt_invalid", result.reason_codes)
        self.assertIn("evidence_locator_unverified", result.reason_codes)

    def test_stale_head_and_sensitive_content_hold(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(
            replace(
                item,
                checks=replace(item.checks, expected_predecessor_current=False, no_sensitive_data=False),
            )
        )
        self.assertEqual(result.disposition, "held")
        self.assertIn("predecessor_changed", result.reason_codes)
        self.assertIn("sensitive_data_present", result.reason_codes)

    def test_inactive_policy_and_unknown_mode_fail_closed(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(item, mode="force", policy_status="proposed"))
        self.assertEqual(result.disposition, "held")
        self.assertIn("mode_unsupported", result.reason_codes)
        self.assertIn("policy_not_active", result.reason_codes)

    def test_changed_endpoint_and_unapproved_source_hold(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(
            replace(
                item,
                source_status="candidate",
                evidence=replace(item.evidence, source_url="https://example.org/data/other"),
            )
        )
        self.assertEqual(result.disposition, "held")
        self.assertIn("source_not_approved", result.reason_codes)
        self.assertIn("source_endpoint_mismatch", result.reason_codes)

    def test_disabled_fetch_and_future_receipt_hold(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(
            replace(
                item,
                source_fetch_enabled=False,
                evaluated_at=datetime(2026, 9, 29, 11, 59, tzinfo=timezone.utc),
            )
        )
        self.assertEqual(result.disposition, "held")
        self.assertIn("source_fetch_disabled", result.reason_codes)
        self.assertIn("decision_time_invalid", result.reason_codes)

    def test_malformed_https_url_holds_without_exception(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(
            replace(item, evidence=replace(item.evidence, source_url="https://[bad"))
        )
        self.assertEqual(result.disposition, "held")
        self.assertIn("evidence_receipt_invalid", result.reason_codes)

    def test_non_boolean_check_cannot_be_treated_as_passed(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, checks=replace(item.checks, identity_resolved="true")
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("identity_unresolved", result.reason_codes)

    def test_non_boolean_rights_and_fetch_flags_hold(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, source_fetch_enabled="yes",
            qualification=replace(item.qualification, public_use_allowed="yes"),
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("source_fetch_disabled", result.reason_codes)
        self.assertIn("public_use_not_allowed", result.reason_codes)

    def test_expired_or_insufficiently_sampled_route_holds(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item,
            qualification=replace(
                item.qualification,
                qualification_expires_at=item.evaluated_at,
                reviewed_sample_count=2,
                unresolved_sample_errors=1,
            ),
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("qualification_expired_or_invalid", result.reason_codes)
        self.assertIn("qualification_samples_invalid", result.reason_codes)

    def test_changed_semantic_contract_holds(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, semantic_contract_sha256="d" * 64
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("semantic_contract_mismatch", result.reason_codes)

    def test_malformed_qualification_values_hold_without_exception(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, qualification=replace(
                item.qualification, qualification_expires_at="later",
                reviewed_sample_count=True, semantic_contract_sha256="wrong",
            )
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("qualification_expired_or_invalid", result.reason_codes)
        self.assertIn("qualification_samples_invalid", result.reason_codes)
        self.assertIn("semantic_contract_mismatch", result.reason_codes)

    def test_malformed_runtime_receipt_types_hold_without_exception(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item,
            evidence=replace(item.evidence, source_url=123, retrieved_at="yesterday"),
            evaluated_at="today",
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("evidence_receipt_invalid", result.reason_codes)
        self.assertIn("decision_time_invalid", result.reason_codes)

    def test_naive_receipt_time_holds_without_comparison_error(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, evidence=replace(
                item.evidence, retrieved_at=datetime(2026, 9, 29, 12)),
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("evidence_receipt_invalid", result.reason_codes)
        self.assertIn("decision_time_invalid", result.reason_codes)

    def test_nontext_identity_and_parser_cannot_be_eligible(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, candidate_id=42, policy_id=42, parser_version=42,
            qualification=replace(
                item.qualification, policy_id=42, parser_version=42,
                qualification_id=42,
            ),
            evidence=replace(item.evidence, source_id=42),
            candidate_source_id=42,
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("decision_identity_missing", result.reason_codes)
        self.assertIn("qualification_not_active", result.reason_codes)
        self.assertIn("parser_version_invalid", result.reason_codes)
        self.assertIn("evidence_receipt_invalid", result.reason_codes)

    def test_private_or_credentialed_public_citation_holds(self) -> None:
        item = qualified_item()
        result = propose_machine_disposition(replace(
            item, qualification=replace(
                item.qualification,
                public_citation_url="https://example.org/table?key=redacted"),
        ))
        self.assertEqual(result.disposition, "held")
        self.assertIn("public_citation_invalid", result.reason_codes)


if __name__ == "__main__":
    unittest.main()
