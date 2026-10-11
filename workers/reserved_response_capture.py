"""Single bounded response driver using a caller-supplied durable backend.

No URL is opened here. A trusted source-specific opener receives only the
accepted exact endpoint and residual duration; it must prohibit redirects,
retries, arbitrary origins and reads past its network timeout. The backend
must COMMIT each operation before returning a receipt. This adapter does not
create a login, store source bytes, infer a source check or publish anything.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from hashlib import sha256
from math import isfinite
import time
from typing import BinaryIO, Callable, Protocol

from workers.source_response_receipts import (
    ResponseRequest, ResponseReservation, ResponseDispatch, ResponseSettlement,
    parse_response_dispatch, parse_response_reservation, parse_response_settlement,
    validate_response_request,
)
from workers.update_run_work import remaining_work_seconds


class DurableResponseBackend(Protocol):
    """Trusted adapter: the marker commits before any transport invocation."""
    def reserve(self, expected: ResponseRequest) -> bytes: ...
    def dispatch(self, expected: ResponseRequest, reservation: ResponseReservation) -> bytes: ...
    def settle(self, expected: ResponseRequest, reservation: ResponseReservation, *,
               outcome: str, body_bytes: int, content_sha256: str | None) -> bytes: ...


class ReservedCaptureError(ValueError):
    """Generic private driver failure; uncertain reservations are not refunded."""


@dataclass(frozen=True)
class ReservedCapture:
    body: bytes
    reservation: ResponseReservation
    settlement: ResponseSettlement
    dispatch: ResponseDispatch


def capture_reserved_response(expected: ResponseRequest, backend: DurableResponseBackend,
                              opener: Callable[[str, int], BinaryIO], *,
                              utc_now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                              monotonic: Callable[[], float] = time.monotonic) -> ReservedCapture | None:
    """Exact durable dispatch replay performs no transport or new settlement.

    A reservation without a dispatch can be resumed by its original current
    claim. A dispatched reservation, including a crash before any network
    call, cannot be resent. Any opener/read/close/cancellation error retains
    the entire allocation. A stale worker may fail settlement; its durable
    reservation still consumes full capacity until an authorized resolution.
    """
    initial_now = utc_now()
    validate_response_request(expected, initial_now)
    previous_tick = None
    def tick():
        nonlocal previous_tick
        value = monotonic()
        try:
            valid = type(value) in (int, float) and isfinite(value)
        except OverflowError:
            valid = False
        if not valid or (previous_tick is not None and value < previous_tick):
            raise ReservedCaptureError('Response capture clock is invalid or moved backwards')
        previous_tick = value
        return value
    started = tick()
    duration = remaining_work_seconds(expected.work, initial_now)
    try:
        approximate_deadline=started+duration
        valid_interval=isfinite(approximate_deadline) and approximate_deadline>started
    except OverflowError:
        valid_interval=False
    if not valid_interval:
        raise ReservedCaptureError('Response capture clock cannot represent its work duration')
    # Exact admitted int/binary64 arithmetic; uv/source/lease policy is unchanged.
    original_deadline = Fraction(started) + duration
    reservation = parse_response_reservation(backend.reserve(expected), expected, now=utc_now())
    dispatch = parse_response_dispatch(backend.dispatch(expected, reservation), expected, reservation, now=utc_now())
    if dispatch.status == 'existing':
        return None
    observed_tick = tick()
    if observed_tick >= original_deadline:
        raise ReservedCaptureError('Response capture has no remaining work time')
    residual = min(remaining_work_seconds(expected.work, utc_now()), int(original_deadline - Fraction(observed_tick)))
    if residual < 1:
        raise ReservedCaptureError('Response capture has no remaining work time')
    deadline = min(Fraction(observed_tick) + residual, original_deadline)
    # The opener receives the same bound as the read loop. A wall-clock rollback
    # cannot restore time already spent obtaining committed receipts.
    outcome, charged, content_hash = 'uncertain', reservation.reserved_bytes, None
    stream = None
    body = bytearray()
    error = None
    cancelled = None
    try:
        stream = opener(expected.endpoint, residual)
        while True:
            validate_response_request(expected, utc_now())
            if tick() >= deadline:
                raise ReservedCaptureError('Response capture exceeded its work duration')
            size = min(8192, reservation.reserved_bytes - len(body))
            chunk = stream.read(size)
            if tick() >= deadline:
                raise ReservedCaptureError('Response capture exceeded its work duration')
            if type(chunk) is not bytes or len(chunk) > size:
                raise ReservedCaptureError('Response stream violated its bounded byte contract')
            body.extend(chunk)
            if len(body) > expected.max_body_bytes:
                outcome, charged, content_hash = 'measured', len(body), sha256(body).hexdigest()
                raise ReservedCaptureError('Response body exceeded its byte bound')
            if not chunk:
                outcome, charged, content_hash = 'measured', len(body), sha256(body).hexdigest()
                break
    except Exception:
        error = ReservedCaptureError('Response capture failed; reserved capacity is retained')
    except BaseException as exc:
        cancelled = exc
    finally:
        if stream is not None:
            try:
                stream.close()
            except BaseException as exc:
                outcome, charged, content_hash = 'uncertain', reservation.reserved_bytes, None
                if isinstance(exc, Exception):
                    error = ReservedCaptureError('Response capture failed; reserved capacity is retained')
                else:
                    cancelled = cancelled or exc
        try:
            settlement = parse_response_settlement(backend.settle(expected, reservation,
                outcome=outcome, body_bytes=charged, content_sha256=content_hash), expected,
                reservation, dispatch, outcome=outcome, body_bytes=charged,
                content_sha256=content_hash, now=utc_now())
        except Exception:
            error = ReservedCaptureError('Response settlement is unavailable or invalid; reserved capacity is retained')
    if cancelled is not None:
        raise cancelled
    if error is not None:
        raise error from None
    if tick() >= deadline:
        raise ReservedCaptureError('Response completed after its work duration; no body returned')
    return ReservedCapture(bytes(body), reservation, settlement, dispatch)
