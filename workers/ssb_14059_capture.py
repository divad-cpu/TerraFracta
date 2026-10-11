"""Validate an already captured SSB 14059 response before offline parsing.

This module has no HTTP client or persistence path. The caller is responsible
for making the transport record truthful; these checks cannot prove TLS origin.
The fixed query and byte cap are candidate TF-005 limits, not source approval.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
from typing import Any

from workers.ssb_14059 import HousingCostObservation, parse_ssb_14059
from workers.ssb_14059_metadata import validate_ssb_14059_metadata


DATA_URL = (
    "https://data.ssb.no/api/pxwebapi/v2/tables/14059/data?lang=en"
    "&valueCodes%5BEierStatus%5D=0"
    "&valueCodes%5BContentsCode%5D=Boutg4%2CBoutg5%2CAntHushSvar"
    "&valueCodes%5BTid%5D=2024%2C2025"
)
METADATA_URL = "https://data.ssb.no/api/pxwebapi/v2/tables/14059/metadata?lang=en"
MAX_RESPONSE_BYTES = 64 * 1024
MAX_PAIR_SPAN = timedelta(minutes=5)


class SSB14059CaptureError(ValueError):
    """The recorded response cannot safely enter the private parser."""


@dataclass(frozen=True)
class CapturedResponse:
    requested_url: str
    final_url: str
    redirect_count: int
    status: int
    content_type: str
    body: bytes
    retrieved_at: datetime


@dataclass(frozen=True)
class ParsedCapture:
    query_url: str
    retrieved_at: datetime
    source_updated_at: datetime
    raw_sha256: str
    observations: tuple[HousingCostObservation, ...]


@dataclass(frozen=True)
class ParsedMetadataCapture:
    metadata_url: str
    retrieved_at: datetime
    source_updated_at: datetime
    raw_sha256: str


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise SSB14059CaptureError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise SSB14059CaptureError(f"Invalid JSON number: {value}")


def _parse_json_integer(token: str) -> int:
    if token == "-0":
        raise SSB14059CaptureError("Negative-zero JSON integer is invalid")
    return int(token)


def _is_json_content_type(value: str) -> bool:
    parts = [part.strip().lower() for part in value.split(";")]
    return parts == ["application/json"] or parts == ["application/json", "charset=utf-8"]


def _read_captured_json(capture: CapturedResponse, expected_url: str) -> Any:
    if capture.requested_url != expected_url or capture.final_url != expected_url:
        raise SSB14059CaptureError("Request or final URL is outside the exact query")
    if type(capture.redirect_count) is not int or capture.redirect_count != 0:
        raise SSB14059CaptureError("Redirected response is not allowed")
    if type(capture.status) is not int or capture.status != 200:
        raise SSB14059CaptureError("Source response was not HTTP 200")
    if not isinstance(capture.content_type, str) or not _is_json_content_type(capture.content_type):
        raise SSB14059CaptureError("Unexpected response content type")
    if type(capture.body) is not bytes or not 0 < len(capture.body) <= MAX_RESPONSE_BYTES:
        raise SSB14059CaptureError("Empty, oversized or non-byte response body")
    if not isinstance(capture.retrieved_at, datetime) or capture.retrieved_at.utcoffset() != timedelta(0):
        raise SSB14059CaptureError("Retrieval time must be timezone-aware UTC")

    try:
        response = json.loads(
            capture.body.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
            parse_float=Decimal,
            parse_int=_parse_json_integer,
        )
    except SSB14059CaptureError:
        raise
    except (UnicodeDecodeError, ValueError, InvalidOperation, RecursionError) as exc:
        raise SSB14059CaptureError("Invalid UTF-8 or JSON response") from exc
    return response


def parse_captured_ssb_14059(capture: CapturedResponse) -> ParsedCapture:
    """Check a bounded transport record and parse its fixed six-cell response."""
    observations = parse_ssb_14059(_read_captured_json(capture, DATA_URL))
    if observations[0].source_updated_at > capture.retrieved_at:
        raise SSB14059CaptureError("Source-update time is later than retrieval")
    return ParsedCapture(
        query_url=DATA_URL,
        retrieved_at=capture.retrieved_at,
        source_updated_at=observations[0].source_updated_at,
        raw_sha256=sha256(capture.body).hexdigest(),
        observations=observations,
    )


def parse_captured_ssb_14059_metadata(capture: CapturedResponse) -> ParsedMetadataCapture:
    """Check a recorded metadata response and the selected table meanings."""
    definition = validate_ssb_14059_metadata(_read_captured_json(capture, METADATA_URL))
    if definition.source_updated_at > capture.retrieved_at:
        raise SSB14059CaptureError("Metadata-update time is later than retrieval")
    return ParsedMetadataCapture(
        metadata_url=METADATA_URL,
        retrieved_at=capture.retrieved_at,
        source_updated_at=definition.source_updated_at,
        raw_sha256=sha256(capture.body).hexdigest(),
    )


def require_matching_metadata(
    data: ParsedCapture, metadata: ParsedMetadataCapture
) -> None:
    """Hold a data capture until a reviewed definition for its version exists."""
    if data.query_url != DATA_URL or metadata.metadata_url != METADATA_URL:
        raise SSB14059CaptureError("Data or metadata belongs to another query")
    if data.source_updated_at != metadata.source_updated_at:
        raise SSB14059CaptureError("Data and table-definition versions differ")


def require_bounded_pair_chronology(
    data: ParsedCapture, metadata: ParsedMetadataCapture
) -> None:
    """Require one metadata-first retrieval attempt, not two distant captures."""
    if metadata.retrieved_at > data.retrieved_at:
        raise SSB14059CaptureError("Metadata was retrieved after the data response")
    if data.retrieved_at - metadata.retrieved_at > MAX_PAIR_SPAN:
        raise SSB14059CaptureError("Response pair spans more than five minutes")
