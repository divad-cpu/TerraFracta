"""Calculate a private descriptive SSB difference without interpreting cause.

This arithmetic is a review aid. It does not test statistical significance,
qualify comparable public wording, evaluate policy effects or publish content.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from workers.ssb_14059 import _exact_share_context

from workers.ssb_14059_batch import PrivateCollectionBatch
from workers.ssb_14059_candidates import (
    SSB14059CandidateError,
    build_private_ssb_14059_candidates,
)
from workers.ssb_14059_capture import SSB14059CaptureError, require_matching_metadata


class SSB14059ComparisonError(ValueError):
    """A batch cannot support a trustworthy private difference."""


@dataclass(frozen=True)
class PrivateDescriptiveDifference:
    from_year: Literal[2024]
    to_year: Literal[2025]
    from_share_percent: Decimal
    to_share_percent: Decimal
    change_percentage_points: Decimal
    from_respondent_count: int
    to_respondent_count: int
    # Preserve the sample count without resolving the table/article unit wording.
    respondent_count_basis: Literal["ssb_response_count_unreconciled"]
    # These compare each measure with the last accepted source capture. The
    # percentage-point difference above compares the two survey years.
    share_change_state: Literal["baseline", "changed", "unchanged"]
    response_count_change_state: Literal["baseline", "changed", "unchanged"]
    data_response_sha256: str
    metadata_response_sha256: str
    review_state: Literal["unreviewed", "held"]
    hold_reason: str | None
    interpretation_limit: Literal["descriptive_only_no_significance_or_policy_effect"]


def build_private_ssb_14059_difference(
    batch: PrivateCollectionBatch,
) -> PrivateDescriptiveDifference | None:
    """Return a reviewable percentage-point calculation for changed cells."""
    try:
        require_matching_metadata(batch.data, batch.metadata)
    except SSB14059CaptureError as exc:
        raise SSB14059ComparisonError("Data and metadata do not match") from exc
    plan = batch.reconciliation
    if plan.current_raw_sha256 != batch.data.raw_sha256:
        raise SSB14059ComparisonError("Reconciliation belongs to another data response")
    try:
        expected_candidates = build_private_ssb_14059_candidates(
            batch.data, plan, batch.metadata
        )
    except SSB14059CandidateError as exc:
        raise SSB14059ComparisonError("Invalid private numerical candidates") from exc
    if batch.candidates != expected_candidates:
        raise SSB14059ComparisonError("Candidates differ from the validated response pair")
    if not plan.changed_years:
        return None
    if plan.state not in ("new", "changed", "held"):
        raise SSB14059ComparisonError("Changed cells need a reviewable plan")
    if tuple(candidate.survey_year for candidate in batch.candidates) != plan.changed_years:
        raise SSB14059ComparisonError("Candidate years do not match the plan")
    expected_state = "held" if plan.state == "held" else "unreviewed"
    if any(candidate.review_state != expected_state for candidate in batch.candidates):
        raise SSB14059ComparisonError("Candidate review state conflicts with plan")
    observations = {item.year: item for item in batch.data.observations}
    if len(batch.data.observations) != 2 or set(observations) != {2024, 2025}:
        raise SSB14059ComparisonError("Both survey years are required")
    first = observations[2024]
    second = observations[2025]
    return PrivateDescriptiveDifference(
        from_year=2024,
        to_year=2025,
        from_share_percent=first.combined_share_ge_40_percent,
        to_share_percent=second.combined_share_ge_40_percent,
        change_percentage_points=_exact_share_context().subtract(
            second.combined_share_ge_40_percent, first.combined_share_ge_40_percent
        ),
        from_respondent_count=first.respondent_count,
        to_respondent_count=second.respondent_count,
        respondent_count_basis="ssb_response_count_unreconciled",
        share_change_state=(
            "baseline" if plan.state == "new"
            else "changed" if plan.changed_share_years else "unchanged"
        ),
        response_count_change_state=(
            "baseline" if plan.state == "new"
            else "changed" if plan.changed_response_count_years else "unchanged"
        ),
        data_response_sha256=batch.data.raw_sha256,
        metadata_response_sha256=batch.metadata.raw_sha256,
        review_state=expected_state,
        hold_reason=plan.hold_reason,
        interpretation_limit="descriptive_only_no_significance_or_policy_effect",
    )
