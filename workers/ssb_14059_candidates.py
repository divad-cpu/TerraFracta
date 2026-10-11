"""Build private, unreviewed numeric evidence candidates from SSB cells.

This is a deterministic mapping of a validated response, not an indicator
definition approval, a claim assessment, or a publication decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from workers.ssb_14059_capture import (
    DATA_URL,
    ParsedCapture,
    ParsedMetadataCapture,
    SSB14059CaptureError,
    require_matching_metadata,
)
from workers.ssb_14059_reconcile import ReconciliationPlan


ReviewState = Literal["unreviewed", "held"]


class SSB14059CandidateError(ValueError):
    """The capture and reconciliation plan do not form a valid private batch."""


@dataclass(frozen=True)
class NumericalEvidenceCandidate:
    survey_year: int
    period_precision: Literal["year"]
    share_40_59_percent: Decimal
    share_upper_band_percent: Decimal
    combined_share_ge_40_percent: Decimal
    respondent_count: int
    share_unit: Literal["percent"]
    # The table labels households; the publisher's article describes respondents as people.
    respondent_count_basis: Literal["ssb_response_count_unreconciled"]
    lower_band_locator: str
    upper_band_locator: str
    respondent_count_locator: str
    query_url: str
    raw_response_sha256: str
    metadata_response_sha256: str
    source_updated_at: datetime
    retrieved_at: datetime
    review_state: ReviewState
    hold_reason: str | None


def build_private_ssb_14059_candidates(
    capture: ParsedCapture, plan: ReconciliationPlan, metadata: ParsedMetadataCapture
) -> tuple[NumericalEvidenceCandidate, ...]:
    """Return only changed-year candidates, preserving private review status."""
    try:
        require_matching_metadata(capture, metadata)
    except SSB14059CaptureError as exc:
        raise SSB14059CandidateError("Matching table definition is required") from exc
    if capture.query_url != DATA_URL:
        raise SSB14059CandidateError("Capture is outside the fixed query")
    if plan.current_raw_sha256 != capture.raw_sha256:
        raise SSB14059CandidateError("Plan belongs to another captured response")
    observations = {item.year: item for item in capture.observations}
    if len(capture.observations) != 2 or set(observations) != {2024, 2025}:
        raise SSB14059CandidateError("Capture does not contain both reviewed years")
    if any(item.source_updated_at != capture.source_updated_at for item in observations.values()):
        raise SSB14059CandidateError("Observation and capture source dates differ")
    if any(year not in observations for year in plan.changed_years):
        raise SSB14059CandidateError("Plan references an unknown survey year")
    if tuple(sorted(set(plan.changed_years))) != plan.changed_years:
        raise SSB14059CandidateError("Plan years must be unique and ordered")
    if (
        tuple(sorted(set(plan.changed_share_years))) != plan.changed_share_years
        or tuple(sorted(set(plan.changed_response_count_years))) != plan.changed_response_count_years
        or tuple(sorted(set(plan.changed_share_years) | set(plan.changed_response_count_years)))
        != plan.changed_years
    ):
        raise SSB14059CandidateError("Changed share/count years do not match the plan")
    if plan.state not in ("new", "unchanged", "changed", "held"):
        raise SSB14059CandidateError("Unknown reconciliation state")
    if plan.state == "new" and plan.changed_years != (2024, 2025):
        raise SSB14059CandidateError("First capture must include both years")
    if plan.state == "new" and (
        plan.changed_share_years != (2024, 2025)
        or plan.changed_response_count_years != (2024, 2025)
    ):
        raise SSB14059CandidateError("First capture must include both measures")
    if plan.state == "unchanged" and plan.raw_version_changed:
        raise SSB14059CandidateError("Unchanged plan cannot contain a new raw version")
    if plan.state in ("changed", "held") and not plan.raw_version_changed:
        raise SSB14059CandidateError("Changed plan requires a new raw version")
    if plan.changed_years and (plan.state == "unchanged" or not plan.raw_version_changed):
        raise SSB14059CandidateError("Plan claims changed values without a new raw version")
    if plan.state == "held" and plan.hold_reason is None:
        raise SSB14059CandidateError("Held plan requires a reason")
    if plan.state != "held" and plan.hold_reason is not None:
        raise SSB14059CandidateError("Non-held plan cannot carry a hold reason")

    candidates: list[NumericalEvidenceCandidate] = []
    for year in plan.changed_years:
        item = observations[year]
        def locator(code: str) -> str:
            return f"EierStatus=0;ContentsCode={code};Tid={year}"

        candidates.append(
            NumericalEvidenceCandidate(
                survey_year=year,
                period_precision="year",
                share_40_59_percent=item.share_40_59_percent,
                share_upper_band_percent=item.share_upper_band_percent,
                combined_share_ge_40_percent=item.combined_share_ge_40_percent,
                respondent_count=item.respondent_count,
                share_unit="percent",
                respondent_count_basis="ssb_response_count_unreconciled",
                lower_band_locator=locator("Boutg4"),
                upper_band_locator=locator("Boutg5"),
                respondent_count_locator=locator("AntHushSvar"),
                query_url=capture.query_url,
                raw_response_sha256=capture.raw_sha256,
                metadata_response_sha256=metadata.raw_sha256,
                source_updated_at=capture.source_updated_at,
                retrieved_at=capture.retrieved_at,
                review_state="held" if plan.state == "held" else "unreviewed",
                hold_reason=plan.hold_reason,
            )
        )
    return tuple(candidates)
