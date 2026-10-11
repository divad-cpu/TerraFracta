"""Plan private reconciliation of two validated SSB 14059 captures.

No source approval, persistence, checkpoint advancement or publication occurs
here. A changed response is a candidate for review, never an eligibility vote.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from workers.ssb_14059 import HousingCostObservation
from workers.ssb_14059_capture import DATA_URL, ParsedCapture


ReconciliationState = Literal["new", "unchanged", "changed", "held"]
HoldReason = Literal["source_time_regressed", "unmarked_numeric_revision"]


class SSB14059ReconciliationError(ValueError):
    """The capture pair cannot be compared safely."""


@dataclass(frozen=True)
class ReconciliationPlan:
    state: ReconciliationState
    changed_years: tuple[int, ...]
    raw_version_changed: bool
    current_raw_sha256: str
    hold_reason: HoldReason | None = None
    changed_share_years: tuple[int, ...] = ()
    changed_response_count_years: tuple[int, ...] = ()


def _measurements(capture: ParsedCapture) -> dict[int, tuple[object, ...]]:
    if capture.query_url != DATA_URL or len(capture.observations) != 2:
        raise SSB14059ReconciliationError("Capture is outside the fixed query")
    by_year: dict[int, tuple[object, ...]] = {}
    for item in capture.observations:
        if not isinstance(item, HousingCostObservation) or item.source_updated_at != capture.source_updated_at:
            raise SSB14059ReconciliationError("Inconsistent capture observation")
        if item.year in by_year:
            raise SSB14059ReconciliationError("Duplicate survey year")
        by_year[item.year] = (
            item.share_40_59_percent,
            item.share_upper_band_percent,
            item.combined_share_ge_40_percent,
            item.respondent_count,
        )
    if set(by_year) != {2024, 2025}:
        raise SSB14059ReconciliationError("Unexpected survey year")
    return by_year


def reconcile_ssb_14059(
    previous: ParsedCapture | None, current: ParsedCapture
) -> ReconciliationPlan:
    """Describe source/measurement changes without mutating accepted state."""
    current_values = _measurements(current)
    if previous is None:
        return ReconciliationPlan(
            "new", (2024, 2025), True, current.raw_sha256,
            changed_share_years=(2024, 2025),
            changed_response_count_years=(2024, 2025),
        )

    previous_values = _measurements(previous)
    if current.retrieved_at < previous.retrieved_at:
        raise SSB14059ReconciliationError("Retrieval chronology regressed")
    changed_share_years = tuple(
        year for year in (2024, 2025)
        if current_values[year][:3] != previous_values[year][:3]
    )
    changed_response_count_years = tuple(
        year for year in (2024, 2025)
        if current_values[year][3] != previous_values[year][3]
    )
    changed_years = tuple(
        year for year in (2024, 2025)
        if year in changed_share_years or year in changed_response_count_years
    )
    raw_version_changed = current.raw_sha256 != previous.raw_sha256
    if not raw_version_changed:
        if changed_years or current.source_updated_at != previous.source_updated_at:
            raise SSB14059ReconciliationError("Same raw hash has conflicting parsed content")
        return ReconciliationPlan("unchanged", (), False, current.raw_sha256)
    if current.source_updated_at < previous.source_updated_at:
        return ReconciliationPlan(
            "held", changed_years, True, current.raw_sha256, "source_time_regressed",
            changed_share_years, changed_response_count_years,
        )
    if changed_years and current.source_updated_at == previous.source_updated_at:
        return ReconciliationPlan(
            "held", changed_years, True, current.raw_sha256, "unmarked_numeric_revision",
            changed_share_years, changed_response_count_years,
        )
    return ReconciliationPlan(
        "changed", changed_years, True, current.raw_sha256,
        changed_share_years=changed_share_years,
        changed_response_count_years=changed_response_count_years,
    )
