"""Fetch the fixed SSB pair under one parent-enforced wall-clock budget.

This is a transport primitive, not an approved collector. It has no storage,
database writer, source registration, schedule, retry or public output. The
parent runs each exact request in a short-lived child so a slow stream cannot
extend the socket-operation timeout indefinitely. Python cannot interrupt
process creation on every platform; the parent rejects any result that arrives
after the deadline. Each child waits for a bounded startup packet before any
network request. OS creation and cleanup are still not hard real-time guarantees.
"""

from __future__ import annotations

from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from fractions import Fraction
import json
import os
from pathlib import Path
from math import isfinite
import subprocess
import sys
from time import monotonic
from typing import Literal, cast

from workers.exact_timestamp import parse_exact_timestamp
from workers.ssb_14059_capture import (
    CapturedResponse,
    DATA_URL,
    MAX_RESPONSE_BYTES,
    METADATA_URL,
    parse_captured_ssb_14059,
    parse_captured_ssb_14059_metadata,
    require_bounded_pair_chronology,
    require_matching_metadata,
)
from workers.bounded_worker_process import BoundedWorkerError, communicate_bounded
from workers.ssb_14059_transport import SSB14059TransportError, fetch_ssb_14059_once
from workers.linux_parent_lifetime import arm_parent_lifetime


PAIR_DEADLINE_SECONDS = 10
PROJECT_ROOT = Path(__file__).resolve().parents[1]
_MAX_WIRE_BYTES = 4 * ((MAX_RESPONSE_BYTES + 2) // 3) + 2048
_STARTUP_WIRE_LIMIT = 256
_WIRE_KEYS = {
    "kind", "requested_url", "final_url", "redirect_count", "status",
    "content_type", "retrieved_at", "body_base64",
}


class SSB14059PairTransportError(ValueError):
    """The two fixed responses were not captured within their shared limit."""


class _PairClock:
    """Keep native finite ticks nondecreasing across both owned requests."""

    def __init__(self):
        self.previous: Fraction | None = None

    def tick(self) -> int | float:
        try:
            tick = monotonic()
            valid = type(tick) in (int, float) and isfinite(tick)
        except Exception as exc:
            raise SSB14059PairTransportError("Invalid pair monotonic clock") from exc
        if not valid:
            raise SSB14059PairTransportError("Invalid pair monotonic clock")
        exact = Fraction(tick)
        if self.previous is not None and exact < self.previous:
            raise SSB14059PairTransportError("Pair monotonic clock moved backward")
        self.previous = exact
        return tick

    def remaining(self, deadline: int | float, message: str) -> float:
        budget = Fraction(deadline) - Fraction(self.tick())
        if not 0 < budget <= PAIR_DEADLINE_SECONDS:
            raise SSB14059PairTransportError(message)
        return float(budget)


def _encode_capture(kind: Literal["metadata", "data"], capture: CapturedResponse) -> bytes:
    return json.dumps(
        {
            "kind": kind,
            "requested_url": capture.requested_url,
            "final_url": capture.final_url,
            "redirect_count": capture.redirect_count,
            "status": capture.status,
            "content_type": capture.content_type,
            "retrieved_at": capture.retrieved_at.isoformat(),
            "body_base64": b64encode(capture.body).decode("ascii"),
        },
        separators=(",", ":"),
    ).encode("ascii")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate child packet field")
        result[key] = value
    return result


def _closed_json(wire):
    return json.loads(wire.decode("ascii"), object_pairs_hook=_unique_object,
        parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("Nonfinite packet value")))


def _decode_capture(kind: Literal["metadata", "data"], wire: bytes) -> CapturedResponse:
    if type(wire) is not bytes or len(wire) > _MAX_WIRE_BYTES:
        raise SSB14059PairTransportError("Child response exceeds its wire limit")
    try:
        record = _closed_json(wire)
        if type(record) is not dict or set(record) != _WIRE_KEYS or record["kind"] != kind:
            raise ValueError("Unexpected child response fields")
        if any(type(record[key]) is not str for key in (
            "requested_url", "final_url", "content_type", "retrieved_at", "body_base64"
        )):
            raise ValueError("Unexpected child response field type")
        if type(record["redirect_count"]) is not int or type(record["status"]) is not int:
            raise ValueError("Unexpected child response status type")
        body = b64decode(record["body_base64"], validate=True)
        if b64encode(body).decode("ascii") != record["body_base64"]:
            raise ValueError("Noncanonical child body encoding")
        if not 0 < len(body) <= MAX_RESPONSE_BYTES:
            raise ValueError("Unexpected child response body size")
        capture = CapturedResponse(
            requested_url=record["requested_url"],
            final_url=record["final_url"],
            redirect_count=record["redirect_count"],
            status=record["status"],
            content_type=record["content_type"],
            retrieved_at=parse_exact_timestamp(record["retrieved_at"]),
            body=body,
        )
    except (UnicodeError, ValueError, TypeError, KeyError, Base64Error) as exc:
        raise SSB14059PairTransportError("Malformed child response") from exc
    expected_url = METADATA_URL if kind == "metadata" else DATA_URL
    if capture.requested_url != expected_url or capture.final_url != expected_url:
        raise SSB14059PairTransportError("Child response is outside the fixed URL")
    return capture


def _run_one(
    kind: Literal["metadata", "data"], *, deadline: float, _clock: _PairClock | None = None
) -> CapturedResponse:
    return _run_child(kind, deadline=deadline, fixture=False, _clock=_clock)


def _run_child(kind: Literal["metadata", "data"], *, deadline: float, fixture: bool,
               _clock: _PairClock | None = None) -> CapturedResponse:
    # Only trusted repository code can select the fixed fictional child. No
    # startup packet contains a module, executable, endpoint or path selector.
    try:
        valid = type(fixture) is bool and kind in ('metadata', 'data') \
            and type(deadline) in (int, float) and isfinite(deadline)
    except OverflowError as exc:
        raise SSB14059PairTransportError('Invalid fixed child context') from exc
    if not valid:
        raise SSB14059PairTransportError('Invalid fixed child context')
    clock = _PairClock() if _clock is None else _clock
    module = 'scripts.ssb_transport_fixture_child' if fixture else 'workers.ssb_14059_pair_transport'
    clock.remaining(deadline, "Pair deadline expired before the next request")
    process = None
    try:
        process = subprocess.Popen(
            [sys.executable, "-E", "-s", "-m",
             module, "--single-response-child", kind],
            cwd=PROJECT_ROOT, env={}, close_fds=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        # The child waits for stdin. Slow OS creation cannot authorize a
        # request after the parent's shared deadline has expired.
        remaining = clock.remaining(deadline, "Pair deadline expired before child authorization")
        startup = json.dumps({"kind": kind, "deadline": deadline, "parentPid": os.getpid()}, separators=(",", ":")).encode("ascii")
        remaining = clock.remaining(deadline, "Pair deadline expired during child authorization encoding")
        result = communicate_bounded(process, startup, timeout=remaining,
            max_stdout=_MAX_WIRE_BYTES, max_stderr=1024)
    except BoundedWorkerError as exc:
        raise SSB14059PairTransportError("Fixed request child exceeded its I/O or time limits") from exc
    except OSError as exc:
        raise SSB14059PairTransportError("Could not start the isolated request") from exc
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            for name in ("stdin", "stdout", "stderr"):
                stream = getattr(process, name)
                if stream is not None and not stream.closed:
                    stream.close()
    clock.remaining(deadline, "Pair deadline expired before result acceptance")
    if result.returncode != 0 or result.stderr:
        raise SSB14059PairTransportError("Fixed source request failed; no retry was attempted")
    capture = _decode_capture(kind, result.stdout)
    clock.remaining(deadline, "Pair deadline expired during result decoding")
    return capture


def fetch_ssb_14059_pair_with_deadline() -> tuple[CapturedResponse, CapturedResponse]:
    """Capture metadata then data, at most two requests within one ten-second budget.

    No caller currently connects this function to a run, storage or database.
    Source review and operational retention remain prerequisites to a live run.
    """
    clock = _PairClock()
    started = clock.tick()
    try:
        deadline = started + PAIR_DEADLINE_SECONDS
        valid = isfinite(deadline) and Fraction(deadline) == Fraction(started) + PAIR_DEADLINE_SECONDS
    except OverflowError as exc:
        raise SSB14059PairTransportError("Invalid pair deadline interval") from exc
    if not valid:
        raise SSB14059PairTransportError("Invalid pair deadline interval")
    metadata_response = _run_one("metadata", deadline=deadline, _clock=clock)
    metadata = parse_captured_ssb_14059_metadata(metadata_response)
    data_response = _run_one("data", deadline=deadline, _clock=clock)
    data = parse_captured_ssb_14059(data_response)
    require_matching_metadata(data, metadata)
    require_bounded_pair_chronology(data, metadata)
    clock.remaining(deadline, "Pair deadline expired during validation")
    return metadata_response, data_response


def _child_main(argv: list[str]) -> int:
    return _serve_child(argv, fetch_ssb_14059_once)


def _serve_child(argv: list[str], fixed_fetcher) -> int:
    if len(argv) != 2 or argv[0] != "--single-response-child" or argv[1] not in ("metadata", "data"):
        return 2
    kind = cast(Literal["metadata", "data"], argv[1])
    try:
        wire = sys.stdin.buffer.read(_STARTUP_WIRE_LIMIT + 1)
        if not 0 < len(wire) <= _STARTUP_WIRE_LIMIT:
            return 2
        startup = _closed_json(wire)
        if type(startup) is not dict or set(startup) != {"kind", "deadline", "parentPid"} or startup["kind"] != kind:
            return 2
        deadline = startup["deadline"]
        if type(deadline) not in (int, float) or not isfinite(deadline):
            return 2
        clock = _PairClock()
        clock.remaining(deadline, "Pair child deadline expired before arming")
        arm_parent_lifetime(startup['parentPid'])
        clock.remaining(deadline, "Pair child deadline expired before transport")
        capture = fixed_fetcher(kind, deadline=deadline)
        clock.remaining(deadline, "Pair child deadline expired after transport")
        packet = _encode_capture(kind, capture)
        clock.remaining(deadline, "Pair child deadline expired during encoding")
    except (SSB14059TransportError, UnicodeError, ValueError, TypeError, OverflowError):
        return 1
    sys.stdout.buffer.write(packet)
    return 0


if __name__ == "__main__":
    raise SystemExit(_child_main(sys.argv[1:]))
