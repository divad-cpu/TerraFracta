"""Pure, fail-closed proposal for a qualified machine publication decision.

The trusted runtime must derive these fields from stored source/policy records and
independent validators. Model output must never populate the check results.
This module cannot grant publication rights or write to the public database.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from re import fullmatch

from workers.public_source_url import public_https_source_url


AUTO_CHANGE_CLASSES = frozenset({"structured_observation"})


def _identity(value: object, limit: int) -> bool:
    return (
        isinstance(value, str) and 1 <= len(value) <= limit
        and bool(fullmatch(r"[A-Za-z0-9][A-Za-z0-9:_.-]*", value))
    )


@dataclass(frozen=True)
class EvidenceReceipt:
    source_id: str
    source_version_id: str
    source_url: str
    content_sha256: str
    locator: str
    retrieved_at: datetime


@dataclass(frozen=True)
class RouteQualification:
    qualification_id: str
    policy_id: str
    source_id: str
    source_url: str
    public_citation_url: str
    change_class: str
    parser_version: str
    status: str
    public_use_allowed: bool
    qualification_expires_at: datetime
    reviewed_sample_count: int
    unresolved_sample_errors: int
    semantic_contract_sha256: str


@dataclass(frozen=True)
class CandidateChecks:
    source_version_current: bool
    evidence_locator_verified: bool
    identity_resolved: bool
    fields_dates_units_verified: bool
    semantics_qualified: bool
    no_material_conflict: bool
    public_snapshot_consistent: bool
    expected_predecessor_current: bool
    no_sensitive_data: bool


@dataclass(frozen=True)
class MachineDecisionInput:
    candidate_id: str
    mode: str
    policy_id: str
    policy_status: str
    source_status: str
    source_fetch_enabled: bool
    candidate_source_id: str
    change_class: str
    parser_version: str
    semantic_contract_sha256: str
    evidence: EvidenceReceipt
    qualification: RouteQualification
    checks: CandidateChecks
    evaluated_at: datetime


@dataclass(frozen=True)
class MachineDecisionProposal:
    candidate_id: str
    disposition: str
    reason_codes: tuple[str, ...]
    policy_id: str
    qualification_id: str
    source_version_id: str
    content_sha256: str
    semantic_contract_sha256: str
    public_citation_url: str
    evidence_locator: str
    source_retrieved_at: datetime
    check_trace: tuple[tuple[str, bool], ...]
    evaluated_at: datetime


def _valid_receipt(receipt: EvidenceReceipt) -> bool:
    if (
        not isinstance(receipt.source_url, str)
        or not isinstance(receipt.content_sha256, str)
        or not isinstance(receipt.retrieved_at, datetime)
    ):
        return False
    return (
        _identity(receipt.source_id, 160)
        and isinstance(receipt.source_version_id, str)
        and bool(fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            receipt.source_version_id,
        ))
        and isinstance(receipt.locator, str)
        and 1 <= len(receipt.locator) <= 400
        and public_https_source_url(receipt.source_url)
        and bool(fullmatch(r"[0-9a-f]{64}", receipt.content_sha256))
        and receipt.retrieved_at.tzinfo is not None
        and receipt.retrieved_at.utcoffset() == timezone.utc.utcoffset(receipt.retrieved_at)
    )


def _utc_datetime(value: object) -> bool:
    return (
        isinstance(value, datetime) and value.tzinfo is not None
        and value.utcoffset() == timezone.utc.utcoffset(value)
    )


def propose_machine_disposition(item: MachineDecisionInput) -> MachineDecisionProposal:
    """Return a proposal; a trusted writer must recheck current DB state at commit."""

    reasons: list[str] = []
    if not _identity(item.candidate_id, 160) or not _identity(item.policy_id, 120):
        reasons.append("decision_identity_missing")
    if item.mode not in {"shadow", "publish_eligible"}:
        reasons.append("mode_unsupported")
    if item.policy_status != "active":
        reasons.append("policy_not_active")
    if item.source_status != "approved":
        reasons.append("source_not_approved")
    if item.source_fetch_enabled is not True:
        reasons.append("source_fetch_disabled")
    if item.qualification.status != "active" or not _identity(
        item.qualification.qualification_id, 160
    ):
        reasons.append("qualification_not_active")
    if item.qualification.policy_id != item.policy_id:
        reasons.append("qualification_policy_mismatch")
    if item.change_class not in AUTO_CHANGE_CLASSES:
        reasons.append("change_class_not_automatable")
    if item.change_class != item.qualification.change_class:
        reasons.append("change_class_mismatch")
    if item.parser_version != item.qualification.parser_version:
        reasons.append("parser_version_mismatch")
    if not _identity(item.parser_version, 120):
        reasons.append("parser_version_invalid")
    if item.qualification.public_use_allowed is not True:
        reasons.append("public_use_not_allowed")
    if not public_https_source_url(item.qualification.public_citation_url):
        reasons.append("public_citation_invalid")
    if (
        not _utc_datetime(item.qualification.qualification_expires_at)
        or not _utc_datetime(item.evaluated_at)
        or item.evaluated_at >= item.qualification.qualification_expires_at
    ):
        reasons.append("qualification_expired_or_invalid")
    if (
        type(item.qualification.reviewed_sample_count) is not int
        or item.qualification.reviewed_sample_count < 3
        or item.qualification.reviewed_sample_count > 1000
        or type(item.qualification.unresolved_sample_errors) is not int
        or item.qualification.unresolved_sample_errors != 0
    ):
        reasons.append("qualification_samples_invalid")
    if (
        not isinstance(item.semantic_contract_sha256, str)
        or not isinstance(item.qualification.semantic_contract_sha256, str)
        or not fullmatch(r"[0-9a-f]{64}", item.semantic_contract_sha256)
        or item.semantic_contract_sha256 != item.qualification.semantic_contract_sha256
    ):
        reasons.append("semantic_contract_mismatch")
    if not _valid_receipt(item.evidence):
        reasons.append("evidence_receipt_invalid")
    if (
        not _utc_datetime(item.evaluated_at)
        or not _utc_datetime(item.evidence.retrieved_at)
        or item.evidence.retrieved_at > item.evaluated_at
    ):
        reasons.append("decision_time_invalid")
    if item.evidence.source_url != item.qualification.source_url:
        reasons.append("source_endpoint_mismatch")
    if (
        not item.candidate_source_id
        or item.candidate_source_id != item.qualification.source_id
        or item.candidate_source_id != item.evidence.source_id
    ):
        reasons.append("source_identity_mismatch")

    trace = (
        ("source_version_current", item.checks.source_version_current),
        ("evidence_locator_verified", item.checks.evidence_locator_verified),
        ("identity_resolved", item.checks.identity_resolved),
        ("fields_dates_units_verified", item.checks.fields_dates_units_verified),
        ("semantics_qualified", item.checks.semantics_qualified),
        ("no_material_conflict", item.checks.no_material_conflict),
        ("public_snapshot_consistent", item.checks.public_snapshot_consistent),
        ("expected_predecessor_current", item.checks.expected_predecessor_current),
        ("no_sensitive_data", item.checks.no_sensitive_data),
    )
    failure_codes = (
        "source_version_not_current", "evidence_locator_unverified",
        "identity_unresolved", "fields_dates_units_unverified",
        "semantics_unqualified", "material_conflict", "snapshot_inconsistent",
        "predecessor_changed", "sensitive_data_present",
    )
    for (name, passed), failure_code in zip(trace, failure_codes, strict=True):
        if passed is not True:
            reasons.append(failure_code)

    if reasons:
        disposition = "held"
    elif item.mode == "shadow":
        disposition = "shadow_only"
        reasons.append("shadow_mode")
    else:
        disposition = "eligible_for_activation_check"
        reasons.append("qualified_checks_passed")

    return MachineDecisionProposal(
        candidate_id=item.candidate_id,
        disposition=disposition,
        reason_codes=tuple(reasons),
        policy_id=item.policy_id,
        qualification_id=item.qualification.qualification_id,
        source_version_id=item.evidence.source_version_id,
        content_sha256=item.evidence.content_sha256,
        semantic_contract_sha256=item.semantic_contract_sha256,
        public_citation_url=item.qualification.public_citation_url,
        evidence_locator=item.evidence.locator,
        source_retrieved_at=item.evidence.retrieved_at,
        check_trace=trace,
        evaluated_at=item.evaluated_at,
    )
