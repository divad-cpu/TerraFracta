"""Validate a bounded SSB table 14059 JSON-stat response without network access.

This parser covers the two-year six-cell TF-003 sample only. It does not approve
the source, fetch data, persist observations, or authorize publication.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import (
    Context, Decimal, DivisionByZero, Inexact, InvalidOperation,
    MAX_EMAX, MIN_EMIN, Overflow, ROUND_HALF_EVEN,
)
from typing import Any, Mapping

from workers.exact_timestamp import parse_exact_timestamp

from workers.ssb_14059_metadata import (
    SSB14059MetadataError,
    validate_optional_data_annotations,
)


class SSB14059ShapeError(ValueError):
    """The response no longer matches the reviewed query shape or safe value rules."""


@dataclass(frozen=True)
class HousingCostObservation:
    year: int
    share_40_59_percent: Decimal
    share_upper_band_percent: Decimal
    combined_share_ge_40_percent: Decimal
    respondent_count: int
    source_updated_at: datetime


_EXPECTED_DIMENSIONS = ["EierStatus", "ContentsCode", "Tid"]
_EXPECTED_CONTENTS = {"Boutg4", "Boutg5", "AntHushSvar"}
_EXPECTED_YEARS = {"2024", "2025"}


def _exact_share_context() -> Context:
    """Four digits cover sums/differences of the admitted one-decimal shares."""
    # Each share is in (0,100] with at most one fractional place. Even the
    # rejected two-band maximum200.0 fits exactly, before the <=100 check.
    return Context(
        prec=4, rounding=ROUND_HALF_EVEN, Emin=MIN_EMIN, Emax=MAX_EMAX, clamp=0,
        traps=[InvalidOperation, DivisionByZero, Overflow, Inexact],
    )


def _category_index(
    response: Mapping[str, Any], dimension: str, expected_codes: set[str]
) -> dict[str, int]:
    try:
        index = response["dimension"][dimension]["category"]["index"]
    except (KeyError, TypeError) as exc:
        raise SSB14059ShapeError(f"Missing {dimension} category index") from exc
    if not isinstance(index, dict) or set(index) != expected_codes:
        raise SSB14059ShapeError(f"Unexpected {dimension} category codes")
    positions = list(index.values())
    if any(type(position) is not int for position in positions) or sorted(positions) != list(
        range(len(expected_codes))
    ):
        raise SSB14059ShapeError(f"Invalid {dimension} category positions")
    return index


def _percent(value: Any, name: str) -> Decimal:
    if type(value) not in (int, Decimal):
        raise SSB14059ShapeError(f"Missing or nonnumeric {name}")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise SSB14059ShapeError(f"Invalid {name}") from exc
    if not result.is_finite() or not Decimal(0) <= result <= Decimal(100):
        raise SSB14059ShapeError(f"Out-of-range {name}")
    if result.is_zero() and result.is_signed():
        raise SSB14059ShapeError(f"Negative zero is invalid for {name}")
    if result.is_zero():
        raise SSB14059ShapeError(f"Unexpected zero share requires review for {name}")
    if result.as_tuple().exponent < -1:
        raise SSB14059ShapeError(f"Unexpected precision for {name}")
    return result


def parse_ssb_14059(response: Mapping[str, Any]) -> tuple[HousingCostObservation, ...]:
    """Return the reviewed 2024/2025 household shares or fail closed on drift."""
    if not isinstance(response, Mapping):
        raise SSB14059ShapeError("Response must be an object")
    if response.get("class") != "dataset" or response.get("version") != "2.0":
        raise SSB14059ShapeError("Unexpected JSON-stat response version")
    if response.get("source") != "Statistics Norway":
        raise SSB14059ShapeError("Unexpected publisher")
    sizes = response.get("size")
    if response.get("id") != _EXPECTED_DIMENSIONS or type(sizes) is not list \
            or any(type(size) is not int for size in sizes) or sizes != [1, 3, 2]:
        raise SSB14059ShapeError("Unexpected dimension order or size")
    dimensions = response.get("dimension")
    if not isinstance(dimensions, dict) or set(dimensions) != set(_EXPECTED_DIMENSIONS):
        raise SSB14059ShapeError("Unexpected data dimensions")
    try:
        validate_optional_data_annotations(response)
    except SSB14059MetadataError as exc:
        raise SSB14059ShapeError("Contradictory embedded data definition") from exc
    if response.get("status") not in (None, {}):
        raise SSB14059ShapeError("Cell status requires manual review")

    values = response.get("value")
    if not isinstance(values, list) or len(values) != 6:
        raise SSB14059ShapeError("Expected exactly six cells")
    tenure_index = _category_index(response, "EierStatus", {"0"})
    contents_index = _category_index(response, "ContentsCode", _EXPECTED_CONTENTS)
    year_index = _category_index(response, "Tid", _EXPECTED_YEARS)
    if tenure_index["0"] != 0:
        raise SSB14059ShapeError("Unexpected total-tenure position")

    updated = response.get("updated")
    if not isinstance(updated, str) or not updated.endswith("Z"):
        raise SSB14059ShapeError("Missing UTC source-update timestamp")
    try:
        source_updated_at = parse_exact_timestamp(updated)
    except ValueError as exc:
        raise SSB14059ShapeError("Invalid source-update timestamp") from exc
    if source_updated_at.tzinfo != timezone.utc:
        raise SSB14059ShapeError("Source-update timestamp is not UTC")

    def cell(content: str, year: str) -> Any:
        # JSON-stat values follow the dimension order, with the final axis fastest.
        flat_index = contents_index[content] * 2 + year_index[year]
        return values[flat_index]

    observations: list[HousingCostObservation] = []
    for year in ("2024", "2025"):
        lower_band = _percent(cell("Boutg4", year), f"Boutg4 {year}")
        upper_band = _percent(cell("Boutg5", year), f"Boutg5 {year}")
        combined = _exact_share_context().add(lower_band, upper_band)
        if combined > 100:
            raise SSB14059ShapeError(f"Combined share exceeds 100 percent in {year}")
        respondent_count = cell("AntHushSvar", year)
        if type(respondent_count) is not int or respondent_count <= 0:
            raise SSB14059ShapeError(f"Invalid respondent count in {year}")
        observations.append(
            HousingCostObservation(
                year=int(year),
                share_40_59_percent=lower_band,
                share_upper_band_percent=upper_band,
                combined_share_ge_40_percent=combined,
                respondent_count=respondent_count,
                source_updated_at=source_updated_at,
            )
        )
    return tuple(observations)
