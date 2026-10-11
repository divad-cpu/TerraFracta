"""Bounded deterministic extraction from a qualified structured JSON shape.

This is an offline source-format exercise, not the SSB 14059 adapter. The
qualification and receipt are caller-supplied; this module cannot establish
rights, source identity, public wording or publication eligibility.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
from re import fullmatch

from workers.public_source_url import public_https_source_url


MAX_SOURCE_BYTES = 64 * 1024
MAX_ROWS = 100
MAX_ABSOLUTE_VALUE = Decimal("10000000")
# Computational representation bounds, not an accepted source range or precision.
MAX_BOUND_DIGITS = 4096
MAX_BOUND_EXPONENT = 4096


class ObservationError(ValueError):
    """A structured observation could not be verified against its mapping."""


@dataclass(frozen=True)
class StructuredMapping:
    status: str
    source_url: str
    series_id: str
    geography: str
    unit: str
    valid_from: datetime
    valid_until: datetime
    minimum: Decimal
    maximum: Decimal
    decimal_places: int
    accepted_contract_sha256: str


@dataclass(frozen=True)
class StructuredReceipt:
    source_version_id: str
    source_url: str
    content_sha256: str
    retrieved_at: datetime


@dataclass(frozen=True)
class StructuredObservation:
    source_version_id: str
    content_sha256: str
    series_id: str
    geography: str
    period: str
    unit: str
    value: Decimal
    locator: str
    semantic_contract_sha256: str


def _numeric_bound_valid(value: object) -> bool:
    if not isinstance(value, Decimal) or not value.is_finite():
        return False
    if value.is_zero():
        return True
    parts = value.as_tuple()
    return (
        len(parts.digits) <= MAX_BOUND_DIGITS
        and -MAX_BOUND_EXPONENT <= parts.exponent <= MAX_BOUND_EXPONENT
        and value.copy_abs() <= MAX_ABSOLUTE_VALUE
    )


def _canonical_decimal_bound(value: Decimal) -> str:
    """Preserve the exact finite bound without ambient-context arithmetic."""
    if value.is_zero():
        # Retain the established signed-zero identity, without exponent expansion.
        return "-0" if value.is_signed() else "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def semantic_contract_fingerprint(mapping: StructuredMapping) -> str:
    """Hash the exact mapping fields that a future qualification must bind."""

    if any(not _numeric_bound_valid(value) for value in (mapping.minimum, mapping.maximum)):
        raise ObservationError("mapping_numeric_bounds_invalid")

    payload = {
        "source_url": mapping.source_url,
        "series_id": mapping.series_id,
        "geography": mapping.geography,
        "unit": mapping.unit,
        "valid_from": mapping.valid_from.isoformat(),
        "valid_until": mapping.valid_until.isoformat(),
        "minimum": _canonical_decimal_bound(mapping.minimum),
        "maximum": _canonical_decimal_bound(mapping.maximum),
        "decimal_places": mapping.decimal_places,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(canonical.encode("utf-8")).hexdigest()


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ObservationError("duplicate_json_key")
        result[key] = value
    return result


def _utc(value: object) -> bool:
    return (
        isinstance(value, datetime) and value.tzinfo is not None
        and value.utcoffset() == timezone.utc.utcoffset(value)
    )


def _mapping_valid(mapping: StructuredMapping, receipt: StructuredReceipt) -> bool:
    return (
        mapping.status == "qualified"
        and public_https_source_url(mapping.source_url)
        and mapping.source_url == receipt.source_url
        and all(isinstance(value, str) and fullmatch(r"[a-z0-9-]{1,80}", value)
                for value in (mapping.series_id, mapping.geography, mapping.unit))
        and _utc(mapping.valid_from) and _utc(mapping.valid_until)
        and _utc(receipt.retrieved_at)
        and mapping.valid_from <= receipt.retrieved_at < mapping.valid_until
        and _numeric_bound_valid(mapping.minimum)
        and _numeric_bound_valid(mapping.maximum)
        and mapping.minimum <= mapping.maximum
        and type(mapping.decimal_places) is int and 0 <= mapping.decimal_places <= 4
        and isinstance(mapping.accepted_contract_sha256, str)
        and bool(fullmatch(r"[0-9a-f]{64}", mapping.accepted_contract_sha256))
        and semantic_contract_fingerprint(mapping) == mapping.accepted_contract_sha256
    )


def extract_structured_observation(
    raw: bytes, receipt: StructuredReceipt, mapping: StructuredMapping,
    *, period: str,
) -> StructuredObservation:
    """Read one exact period from a small JSON document without public wording."""

    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ObservationError("source_bytes_invalid")
    if (
        not _mapping_valid(mapping, receipt)
        or not isinstance(receipt.source_version_id, str)
        or not fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", receipt.source_version_id)
    ):
        raise ObservationError("mapping_or_receipt_invalid")
    if (
        not isinstance(receipt.content_sha256, str)
        or not fullmatch(r"[0-9a-f]{64}", receipt.content_sha256)
        or sha256(raw).hexdigest() != receipt.content_sha256
    ):
        raise ObservationError("source_hash_mismatch")
    if not isinstance(period, str) or not fullmatch(r"[0-9]{4}", period):
        raise ObservationError("period_invalid")
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
    except ObservationError:
        # The duplicate-key hook already supplied its established refusal.
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise ObservationError("source_json_invalid") from exc
    if (
        not isinstance(document, dict)
        or set(document) != {"schema_version", "series_id", "geography", "unit", "rows"}
        or type(document["schema_version"]) is not int
        or document["schema_version"] != 1
        or document["series_id"] != mapping.series_id
        or document["geography"] != mapping.geography
        or document["unit"] != mapping.unit
        or not isinstance(document["rows"], list)
        or not 1 <= len(document["rows"]) <= MAX_ROWS
    ):
        raise ObservationError("source_schema_or_semantics_changed")

    selected: Decimal | None = None
    seen: set[str] = set()
    for row in document["rows"]:
        if not isinstance(row, dict) or set(row) != {"period", "value"}:
            raise ObservationError("source_row_invalid")
        row_period = row["period"]
        value_text = row["value"]
        if (
            not isinstance(row_period, str)
            or not fullmatch(r"[0-9]{4}", row_period)
            or row_period in seen
            or not isinstance(value_text, str)
            or not fullmatch(r"-?(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,4})?", value_text)
        ):
            raise ObservationError("source_row_invalid")
        seen.add(row_period)
        value = Decimal(value_text)
        if (
            value < mapping.minimum or value > mapping.maximum
            or max(0, -value.as_tuple().exponent) > mapping.decimal_places
        ):
            raise ObservationError("source_value_outside_mapping")
        if row_period == period:
            selected = value
    if selected is None:
        raise ObservationError("requested_period_missing")
    locator = f"series={mapping.series_id};geography={mapping.geography};period={period}"
    return StructuredObservation(
        source_version_id=receipt.source_version_id,
        content_sha256=receipt.content_sha256,
        series_id=mapping.series_id,
        geography=mapping.geography,
        period=period,
        unit=mapping.unit,
        value=selected,
        locator=locator,
        semantic_contract_sha256=mapping.accepted_contract_sha256,
    )
