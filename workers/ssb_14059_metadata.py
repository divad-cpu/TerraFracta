"""Validate selected SSB 14059 table definitions without network access.

The comparison deliberately holds changed labels, units or survey periods for
human review. A matching metadata response is not source or publication approval.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from workers.exact_timestamp import parse_exact_timestamp


class SSB14059MetadataError(ValueError):
    """The selected table definition differs from the reviewed meaning."""


@dataclass(frozen=True)
class VerifiedTableDefinition:
    source_updated_at: datetime


_CONTENT_MEANINGS = {
    "Boutg4": (
        "Housing expences make up 40-59 prosent of income (per cent)",
        "per cent",
        1,
        "Data collection between January and May",
        "Average",
    ),
    "Boutg5": (
        "Housing expences make up more than 60 prosent of income (per cent)",
        "per cent",
        1,
        "Data collection between January and May",
        "Average",
    ),
    "AntHushSvar": (
        "Number of households that responded",
        "number",
        0,
        "Data collection between January and May",
        "Stock",
    ),
}
_EXPECTED_TABLE_NOTE = (
    "Break in time series in 2015 and 2021 due to new imputation method of housing expenses."
)


def _reviewed_unit(value: object, base: str, decimals: int) -> bool:
    # Python dictionary equality treats True as 1 and Decimal('1.0') as 1.
    # Source definitions must retain their exact declared JSON types.
    return (type(value) is dict and set(value) == {'base', 'decimals'}
            and type(value['base']) is str and value['base'] == base
            and type(value['decimals']) is int and value['decimals'] == decimals)


def validate_optional_data_annotations(response: Mapping[str, Any]) -> None:
    """Hold embedded data definitions that contradict the reviewed table."""
    dimensions = response.get("dimension")
    if not isinstance(dimensions, dict):
        raise SSB14059MetadataError("Missing data dimensions")
    try:
        tenure = dimensions["EierStatus"]["category"]
        contents = dimensions["ContentsCode"]["category"]
        years = dimensions["Tid"]["category"]
        content_dimension = dimensions["ContentsCode"]
    except (KeyError, TypeError) as exc:
        raise SSB14059MetadataError("Invalid data definition structure") from exc
    if any(not isinstance(entry, dict) for entry in (tenure, contents, years, content_dimension)):
        raise SSB14059MetadataError("Invalid data definition structure")

    if "label" in tenure and tenure["label"] != {"0": "Total"}:
        raise SSB14059MetadataError("Contradictory tenure label in data")
    if "label" in years and years["label"] != {"2024": "2024", "2025": "2025"}:
        raise SSB14059MetadataError("Contradictory survey-year label in data")
    if "label" in contents and contents["label"] != {
        code: meaning[0] for code, meaning in _CONTENT_MEANINGS.items()
    }:
        raise SSB14059MetadataError("Contradictory content labels in data")
    if "unit" in contents:
        units = contents["unit"]
        if type(units) is not dict or set(units) != set(_CONTENT_MEANINGS) or any(
            not _reviewed_unit(units[code], meaning[1], meaning[2])
            for code, meaning in _CONTENT_MEANINGS.items()
        ):
            raise SSB14059MetadataError("Contradictory units in data")
    if "extension" in content_dimension:
        extension = content_dimension["extension"]
        if not isinstance(extension, dict):
            raise SSB14059MetadataError("Invalid data content extension")
        for field, position in (("refperiod", 3), ("measuringType", 4), ("alternativeText", 0)):
            if field in extension and extension[field] != {
                code: meaning[position] for code, meaning in _CONTENT_MEANINGS.items()
            }:
                raise SSB14059MetadataError(f"Contradictory {field} in data")
        for field, expected in (("priceType", "NotApplicable"), ("adjustment", "None")):
            if field in extension and extension[field] != {
                code: expected for code in _CONTENT_MEANINGS
            }:
                raise SSB14059MetadataError(f"Contradictory {field} in data")
    if "note" in response and response["note"] != [_EXPECTED_TABLE_NOTE]:
        raise SSB14059MetadataError("Contradictory time-series note in data")
    if "extension" in response:
        root_extension = response["extension"]
        if not isinstance(root_extension, dict):
            raise SSB14059MetadataError("Invalid data extension")
        if "px" in root_extension:
            px = root_extension["px"]
            if not isinstance(px, dict) or px.get("tableid") != "14059" or px.get("language") != "en":
                raise SSB14059MetadataError("Contradictory table identity in data")


def _category(response: Mapping[str, Any], dimension: str) -> Mapping[str, Any]:
    try:
        entry = response["dimension"][dimension]["category"]
        index = entry["index"]
        if not isinstance(index, dict) or not index:
            raise TypeError
        positions = list(index.values())
        if any(type(position) is not int for position in positions):
            raise TypeError
        if sorted(positions) != list(range(len(positions))):
            raise TypeError
        if not isinstance(entry["label"], dict):
            raise TypeError
    except (KeyError, TypeError) as exc:
        raise SSB14059MetadataError(f"Invalid {dimension} code list") from exc
    return entry


def validate_ssb_14059_metadata(response: Mapping[str, Any]) -> VerifiedTableDefinition:
    """Check the exact selected meanings while allowing unrelated new codes."""
    if not isinstance(response, Mapping):
        raise SSB14059MetadataError("Metadata must be an object")
    if (
        response.get("class") != "dataset"
        or response.get("version") != "2.0"
        or response.get("source") != "Statistics Norway"
        or response.get("id") != ["EierStatus", "ContentsCode", "Tid"]
    ):
        raise SSB14059MetadataError("Unexpected table identity or JSON-stat version")
    try:
        px = response["extension"]["px"]
        if px.get("tableid") != "14059" or px.get("language") != "en":
            raise SSB14059MetadataError("Changed table identity or language")
    except (KeyError, TypeError, AttributeError) as exc:
        raise SSB14059MetadataError("Missing table identity metadata") from exc
    if response.get("note") != [_EXPECTED_TABLE_NOTE]:
        raise SSB14059MetadataError("Changed table comparability note")
    dimensions = response.get("dimension")
    if not isinstance(dimensions, dict) or set(dimensions) != {"EierStatus", "ContentsCode", "Tid"}:
        raise SSB14059MetadataError("Unexpected table dimensions")
    sizes = response.get("size")
    if (
        not isinstance(sizes, list)
        or len(sizes) != 3
        or any(type(size) is not int or size <= 0 for size in sizes)
    ):
        raise SSB14059MetadataError("Invalid table dimension sizes")
    tenure = _category(response, "EierStatus")
    contents = _category(response, "ContentsCode")
    years = _category(response, "Tid")
    for size, category in zip(sizes, (tenure, contents, years), strict=True):
        if size != len(category["index"]):
            raise SSB14059MetadataError("Table size and code list disagree")
    if tenure["label"].get("0") != "Total" or "0" not in tenure["index"]:
        raise SSB14059MetadataError("Total tenure meaning changed")
    for year in ("2024", "2025"):
        if year not in years["index"] or years["label"].get(year) != year:
            raise SSB14059MetadataError(f"Survey year {year} changed")

    try:
        extension = dimensions["ContentsCode"]["extension"]
        units = contents["unit"]
        periods = extension["refperiod"]
        measuring_types = extension["measuringType"]
        price_types = extension["priceType"]
        adjustments = extension["adjustment"]
        alternative_text = extension["alternativeText"]
        for code, (label, base, decimals, period, measuring_type) in _CONTENT_MEANINGS.items():
            if code not in contents["index"]:
                raise SSB14059MetadataError(f"Missing {code} code")
            if (
                contents["label"].get(code) != label
                or not _reviewed_unit(units[code], base, decimals)
                or periods.get(code) != period
                or measuring_types.get(code) != measuring_type
                or price_types.get(code) != "NotApplicable"
                or adjustments.get(code) != "None"
                or alternative_text.get(code) != label
            ):
                raise SSB14059MetadataError(f"Changed {code} definition")
    except (KeyError, TypeError, AttributeError) as exc:
        raise SSB14059MetadataError("Missing selected unit or definition") from exc

    updated = response.get("updated")
    if not isinstance(updated, str) or not updated.endswith("Z"):
        raise SSB14059MetadataError("Missing UTC metadata-update timestamp")
    try:
        source_updated_at = parse_exact_timestamp(updated)
    except ValueError as exc:
        raise SSB14059MetadataError("Invalid metadata-update timestamp") from exc
    if source_updated_at.tzinfo != timezone.utc:
        raise SSB14059MetadataError("Metadata-update timestamp is not UTC")
    return VerifiedTableDefinition(source_updated_at)
