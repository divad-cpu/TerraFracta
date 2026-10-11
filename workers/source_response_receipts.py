"""Strict private response receipts, independently bound to trusted inputs.

These pure checks do not authenticate a backend or make a dispatch durable.
The driver requires an adapter whose methods return only after COMMIT. Never
send reservation IDs/work claims through a public source or website report.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from re import fullmatch
from uuid import RFC_4122, UUID

from workers.public_source_url import public_https_source_url
from workers.update_request_identity import UpdateRequest, identify_update_request
from workers.update_run_work import WorkClaim, remaining_work_seconds
from workers.exact_timestamp import parse_exact_timestamp

MAX_RECEIPT_BYTES = 4096
BASE = frozenset({'schemaVersion', 'status', 'reservationId', 'runId',
                  'requestFingerprint', 'workClaimId'})
RESERVATION_FIELDS = BASE | {'registrationId', 'requestKey', 'maxBodyBytes',
                            'reservedBytes', 'endpointSha256', 'reservedAt'}
DISPATCH_FIELDS = BASE | {'dispatchedAt'}
SETTLEMENT_FIELDS = BASE | {'outcome', 'bodyBytes', 'chargedBytes', 'contentSha256', 'settledAt'}


@dataclass(frozen=True)
class ResponseRequest:
    invocation: UpdateRequest
    work: WorkClaim
    registration_id: str
    request_key: str
    endpoint: str
    max_body_bytes: int


@dataclass(frozen=True)
class ResponseReservation:
    reservation_id: str
    status: str
    reserved_at: datetime
    reserved_bytes: int


@dataclass(frozen=True)
class ResponseDispatch:
    reservation_id: str
    status: str
    dispatched_at: datetime


@dataclass(frozen=True)
class ResponseSettlement:
    reservation_id: str
    status: str
    outcome: str
    body_bytes: int
    charged_bytes: int
    content_sha256: str | None
    settled_at: datetime


def _uuid(value):
    if type(value) is not str:
        raise ValueError
    parsed = UUID(value)
    if str(parsed) != value or parsed.version != 4 or parsed.variant != RFC_4122:
        raise ValueError
    return value


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _time(value, now):
    instant = parse_exact_timestamp(value).astimezone(timezone.utc)
    if instant > now:
        raise ValueError
    return instant


def validate_response_request(expected: ResponseRequest, now: datetime):
    """A trusted origin-specific adapter, not this URL-shape check, prevents SSRF."""
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() != timedelta(0) \
       or not isinstance(expected, ResponseRequest) or not isinstance(expected.work, WorkClaim):
        raise ValueError('Response context is invalid or expired')
    identify_update_request(expected.invocation)
    _uuid(expected.registration_id)
    _uuid(str(expected.work.run_id))
    _uuid(str(expected.work.lease_id))
    if expected.work.status not in {'claimed', 'existing_claim', 'renewed'} \
       or expected.work.observed_at is None or expected.work.observed_at > now \
       or remaining_work_seconds(expected.work, now) < 1 \
       or type(expected.request_key) is not str or not fullmatch(r'[a-z0-9][a-z0-9:_-]{0,159}', expected.request_key) \
       or not public_https_source_url(expected.endpoint) \
       or type(expected.max_body_bytes) is not int or not 1 <= expected.max_body_bytes \
       or expected.max_body_bytes + 1 > expected.invocation.limits.max_response_bytes:
        raise ValueError('Response context is invalid or expired')


def _decode(data, fields, expected, now, reservation_id=None):
    validate_response_request(expected, now)
    if type(data) is not bytes or not 2 <= len(data) <= MAX_RECEIPT_BYTES:
        raise ValueError
    p = json.loads(data.decode('utf-8'), object_pairs_hook=_unique)
    if type(p) is not dict or frozenset(p) != fields or type(p['schemaVersion']) is not int \
       or p['schemaVersion'] != 1 or type(p['status']) is not str \
       or p['runId'] != str(expected.work.run_id) \
       or p['workClaimId'] != str(expected.work.lease_id) \
       or p['requestFingerprint'] != identify_update_request(expected.invocation).request_fingerprint:
        raise ValueError
    _uuid(p['reservationId'])
    if reservation_id is not None and p['reservationId'] != reservation_id:
        raise ValueError
    return p


def parse_response_reservation(data: bytes, expected: ResponseRequest, *, now: datetime) -> ResponseReservation:
    try:
        p = _decode(data, RESERVATION_FIELDS, expected, now)
        if p['status'] not in {'reserved', 'existing'} or p['registrationId'] != expected.registration_id \
           or p['requestKey'] != expected.request_key or type(p['maxBodyBytes']) is not int \
           or p['maxBodyBytes'] != expected.max_body_bytes or type(p['reservedBytes']) is not int \
           or p['reservedBytes'] != expected.max_body_bytes + 1 \
           or p['endpointSha256'] != sha256(expected.endpoint.encode('utf-8')).hexdigest():
            raise ValueError
        reserved_at = _time(p['reservedAt'], now)
        # A renewed claim keeps its original fencing ID and whole-run deadline.
        # Existing reservations may precede the renewal, but never the run's
        # independently bounded start. A new reservation must follow its claim.
        earliest = (expected.work.deadline_at - timedelta(seconds=expected.invocation.limits.max_duration_seconds)
                    if p['status'] == 'existing' else expected.work.observed_at)
        if reserved_at < earliest:
            raise ValueError
        return ResponseReservation(p['reservationId'], p['status'], reserved_at, p['reservedBytes'])
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError) as exc:
        raise ValueError('Response reservation receipt is invalid or expired') from exc


def parse_response_dispatch(data: bytes, expected: ResponseRequest, reservation: ResponseReservation,
                            *, now: datetime) -> ResponseDispatch:
    try:
        if not isinstance(reservation, ResponseReservation):
            raise ValueError
        p = _decode(data, DISPATCH_FIELDS, expected, now, reservation.reservation_id)
        if p['status'] not in {'dispatched', 'existing'}:
            raise ValueError
        dispatched_at = _time(p['dispatchedAt'], now)
        if dispatched_at < reservation.reserved_at:
            raise ValueError
        return ResponseDispatch(p['reservationId'], p['status'], dispatched_at)
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError) as exc:
        raise ValueError('Response dispatch receipt is invalid or expired') from exc


def parse_response_settlement(data: bytes, expected: ResponseRequest, reservation: ResponseReservation,
                              dispatch: ResponseDispatch, *, outcome: str, body_bytes: int,
                              content_sha256: str | None, now: datetime) -> ResponseSettlement:
    try:
        if not isinstance(reservation, ResponseReservation) or not isinstance(dispatch, ResponseDispatch) \
           or dispatch.reservation_id != reservation.reservation_id \
           or type(outcome) is not str or outcome not in {'measured', 'uncertain'} \
           or type(body_bytes) is not int or not 0 <= body_bytes <= reservation.reserved_bytes \
           or (outcome == 'uncertain' and (body_bytes != reservation.reserved_bytes or content_sha256 is not None)) \
           or (outcome == 'measured' and (type(content_sha256) is not str or not fullmatch(r'[0-9a-f]{64}', content_sha256))):
            raise ValueError
        p = _decode(data, SETTLEMENT_FIELDS, expected, now, reservation.reservation_id)
        if p['status'] not in {'settled', 'existing'} or p['outcome'] != outcome \
           or type(p['bodyBytes']) is not int or p['bodyBytes'] != body_bytes \
           or type(p['chargedBytes']) is not int or p['chargedBytes'] != body_bytes \
           or p['contentSha256'] != content_sha256:
            raise ValueError
        settled_at = _time(p['settledAt'], now)
        if settled_at < dispatch.dispatched_at:
            raise ValueError
        return ResponseSettlement(p['reservationId'], p['status'], outcome, body_bytes,
                                  p['chargedBytes'], content_sha256, settled_at)
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError) as exc:
        raise ValueError('Response settlement receipt is invalid or expired') from exc
