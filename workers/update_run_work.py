"""Bounded pure work-lease response checks for a future trusted driver.

Fencing IDs are private worker metadata, not authentication credentials.
Never export these responses through the public page or source projection.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from uuid import UUID, RFC_4122

from workers.update_request_identity import UpdateRequest, identify_update_request
from workers.update_run_admission import RunAdmission
from workers.exact_timestamp import parse_exact_timestamp


MAX_WORK_RECEIPT_BYTES=4096
HELD_STATUSES=frozenset({"busy","stale_claim","deadline_reached","attempt_limit","finished"})
BASE_FIELDS=frozenset({"schemaVersion","status","runId"})
CLAIM_FIELDS=BASE_FIELDS|{"leaseId","attempt","leaseExpiresAt","deadlineAt","observedAt"}
RENEW_FIELDS=BASE_FIELDS|{"leaseId","leaseExpiresAt","deadlineAt","observedAt"}


@dataclass(frozen=True)
class WorkClaim:
    status: str
    run_id: UUID
    lease_id: UUID | None = None
    attempt: int | None = None
    lease_expires_at: datetime | None = None
    deadline_at: datetime | None = None
    observed_at: datetime | None = None


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:
            raise ValueError
        result[key]=value
    return result


def _decode(data: bytes) -> dict:
    if type(data) is not bytes or not 2<=len(data)<=MAX_WORK_RECEIPT_BYTES:
        raise ValueError
    payload=json.loads(data.decode("utf-8"),object_pairs_hook=_unique)
    if not isinstance(payload,dict) or type(payload.get("schemaVersion")) is not int \
       or payload["schemaVersion"]!=1 or type(payload.get("status")) is not str:
        raise ValueError
    return payload


def _uuid(value) -> UUID:
    if type(value) is not str:
        raise ValueError
    parsed=UUID(value)
    if str(parsed)!=value or parsed.version!=4 or parsed.variant!=RFC_4122:
        raise ValueError
    return parsed


def _time(value) -> datetime:
    return parse_exact_timestamp(value).astimezone(timezone.utc)


def _now(now: datetime) -> None:
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset()!=timedelta(0):
        raise ValueError


def _check_window(payload: dict,request: UpdateRequest,now: datetime):
    observed=_time(payload["observedAt"])
    expires=_time(payload["leaseExpiresAt"])
    deadline=_time(payload["deadlineAt"])
    # A trusted runtime needs synchronized clocks. A future-looking receipt
    # is held rather than silently granting extra execution time.
    if observed>now or expires<=now or deadline<=now \
       or expires>deadline or expires>observed+timedelta(seconds=30) \
       or deadline>observed+timedelta(seconds=request.limits.max_duration_seconds):
        raise ValueError
    return expires,deadline,observed


def parse_work_claim(data: bytes,request: UpdateRequest,admission: RunAdmission,
                     now: datetime) -> WorkClaim:
    """Validate private lease metadata against the prior admission and clock."""
    try:
        _now(now)
        identity=identify_update_request(request)
        if not isinstance(admission,RunAdmission) or \
           admission.request_key!=identity.request_key or \
           admission.request_fingerprint!=identity.request_fingerprint:
            raise ValueError
        payload=_decode(data)
        run_id=_uuid(payload.get("runId"))
        if run_id!=admission.run_id:
            raise ValueError
        if payload["status"] in HELD_STATUSES:
            if frozenset(payload)!=BASE_FIELDS:
                raise ValueError
            return WorkClaim(payload["status"],run_id)
        if payload["status"] not in {"claimed","existing_claim"} or frozenset(payload)!=CLAIM_FIELDS:
            raise ValueError
        lease_id=_uuid(payload["leaseId"])
        attempt=payload["attempt"]
        if type(attempt) is not int or not 1<=attempt<=request.limits.max_retries+1:
            raise ValueError
        expires,deadline,observed=_check_window(payload,request,now)
        return WorkClaim(payload["status"],run_id,lease_id,attempt,expires,deadline,observed)
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError) as exc:
        raise ValueError("Work receipt is invalid or expired") from exc


def parse_work_renewal(data: bytes,request: UpdateRequest,current: WorkClaim,
                       now: datetime) -> WorkClaim:
    """Renewal preserves the fencing ID and original whole-run deadline."""
    try:
        _now(now)
        identify_update_request(request)
        if not isinstance(current,WorkClaim) or current.lease_id is None or current.deadline_at is None:
            raise ValueError
        payload=_decode(data)
        if frozenset(payload)!=RENEW_FIELDS or payload["status"]!="renewed" \
           or _uuid(payload["runId"])!=current.run_id or _uuid(payload["leaseId"])!=current.lease_id:
            raise ValueError
        expires,deadline,observed=_check_window(payload,request,now)
        if deadline!=current.deadline_at or expires<current.lease_expires_at \
           or observed<current.observed_at or observed>=current.lease_expires_at:
            raise ValueError
        return WorkClaim("renewed",current.run_id,current.lease_id,current.attempt,expires,deadline,observed)
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError) as exc:
        raise ValueError("Work receipt is invalid or expired") from exc


def remaining_work_seconds(claim: WorkClaim,now: datetime) -> int:
    """Give no work time after expiry, including subsecond residual windows."""
    _now(now)
    if not isinstance(claim,WorkClaim) or claim.lease_expires_at is None or claim.deadline_at is None:
        return 0
    return max(0,int((min(claim.lease_expires_at,claim.deadline_at)-now).total_seconds()))
