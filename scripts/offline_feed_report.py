"""Read one bounded private JSON envelope from stdin; print discovery metadata.

Offline only: no URLs, archive paths, credentials, dotenv, network or database
are opened. The caller supplies exact already-held bytes and asserted receipts.
The output remains unverified and must stay private pending separate review.
"""

from __future__ import annotations

import base64
import binascii
from datetime import datetime
import json
from re import fullmatch
import sys

from workers.error_diagnostics import diagnostic_worker
from workers.feed_discovery import FeedDiscoveryError, FeedReceipt, MAX_FEED_BYTES
from workers.feed_discovery_report import feed_discovery_report

MAX_INPUT_BYTES = 192 * 1024
MAX_OUTPUT_BYTES = 512 * 1024
HELP = "Offline feed discovery: supply a private_feed_window_input v1 JSON envelope on stdin. Output is private unverified metadata; no collection, approval, checkpoint or publication occurs.\n"


class OfflineFeedInputError(ValueError):
    """Expected envelope/source refusal, distinct from an internal adapter fault."""


def _constant(_):
    raise ValueError("json_constant")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_key")
        result[key] = value
    return result


def _window(value):
    if type(value) is not dict or set(value) != {"raw_base64", "receipt"}:
        raise ValueError("window_fields")
    encoded, receipt = value["raw_base64"], value["receipt"]
    if type(encoded) is not str or not 1 <= len(encoded) <= 4 * ((MAX_FEED_BYTES + 2) // 3):
        raise ValueError("window_bytes")
    raw = base64.b64decode(encoded, validate=True)
    if base64.b64encode(raw).decode("ascii") != encoded or not 1 <= len(raw) <= MAX_FEED_BYTES:
        raise ValueError("window_bytes")
    fields = {"source_key", "source_version_id", "feed_url", "content_sha256", "retrieved_at"}
    if type(receipt) is not dict or set(receipt) != fields or any(type(item) is not str for item in receipt.values()):
        raise ValueError("receipt_fields")
    instant = receipt["retrieved_at"]
    if not fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z", instant):
        raise ValueError("receipt_time")
    return raw, FeedReceipt(**{**receipt, "retrieved_at": datetime.fromisoformat(instant)})


def _decode_envelope(raw: bytes):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES:
        raise ValueError("input_bytes")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=_constant)
    if (type(value) is not dict or set(value) != {"schema_version", "kind", "format", "current", "previous"}
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["kind"] != "private_feed_window_input" or value["format"] not in ("rss20", "atom10")):
        raise ValueError("input_fields")
    current_raw, current = _window(value["current"])
    old_raw, old = (None, None) if value["previous"] is None else _window(value["previous"])
    return current_raw, current, value["format"], old_raw, old


def report_from_envelope(raw: bytes) -> bytes:
    """Refuse the whole envelope before producing any partial report."""
    try:
        current_raw, current, format, old_raw, old = _decode_envelope(raw)
    except (ValueError, TypeError, UnicodeError, RecursionError, binascii.Error) as error:
        raise OfflineFeedInputError("input_envelope_invalid") from error
    try:
        report = feed_discovery_report(current_raw, current, expected_format=format,
            previous_raw=old_raw, previous_receipt=old)
    except FeedDiscoveryError as error:
        raise OfflineFeedInputError("input_source_invalid") from error
    output = (json.dumps(report, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
    if len(output) > MAX_OUTPUT_BYTES:
        raise OfflineFeedInputError("output_bytes")
    return output


def main(*, args=None, stdin=None, stdout=None, stderr=None) -> int:
    args = sys.argv[1:] if args is None else args
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout.buffer if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker("collector_worker"):
            if args == ["--help"]:
                stderr.write(HELP)
                return 0
            if args:
                stderr.write("offline_feed_report_arguments_refused\n")
                return 2
            try:
                output = report_from_envelope(stdin.read(MAX_INPUT_BYTES + 1))
            except OfflineFeedInputError:
                stderr.write("offline_feed_report_input_refused\n")
                return 2
            if stdout.write(output) != len(output):
                raise OSError("offline_feed_report_output_incomplete")
            stdout.flush()
            return 0
    except Exception:
        # The existing diagnostic boundary sees only its fixed worker code.
        # Neither traceback, source content nor exception text reaches stderr.
        try:
            stderr.write("offline_feed_report_unavailable\n")
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
