"""Canonical identity for a future authenticated update operation.

Both manual and scheduled entry points can use this shape. A trusted runtime
must resolve the actor, code and policy versions, and a database must enforce
the unique request key atomically. This module has no writer or authority.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from hashlib import sha256
import json
from re import fullmatch

from workers.missing_run_monitor import oslo_window_key


@dataclass(frozen=True)
class RunLimits:
    max_items: int
    max_response_bytes: int
    max_model_calls: int
    max_model_input_tokens: int
    max_model_output_tokens: int
    max_retries: int
    max_duration_seconds: int
    run_cap_usd: Decimal
    month_cap_usd: Decimal


@dataclass(frozen=True)
class UpdateRequest:
    request_key: str
    trigger: str
    scheduled_due_at: datetime | None
    actor_id: str
    scope: str
    mode: str
    strategy: str
    code_version: str
    policy_version: str
    limits: RunLimits


@dataclass(frozen=True)
class RequestIdentity:
    request_key: str
    request_fingerprint: str


# Technical ceilings for the first slice. Accepted runtime policy may be lower.
MAX_ITEMS = 50
MAX_RESPONSE_BYTES = 50_000_000
MAX_MODEL_CALLS = 1_000
MAX_MODEL_TOKENS = 1_000_000
MAX_RETRIES = 5
MAX_DURATION_SECONDS = 3_600
MAX_MONEY_USD = Decimal("1000000")
MAX_MONEY_FRACTIONAL_DIGITS = 9


def scheduled_request_key(scope: str, due_at: datetime) -> str:
    """Derive one idempotency key from the accepted Oslo weekly window."""

    if (
        not isinstance(scope, str)
        or not fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", scope)
        or len(scope) > 80
    ):
        raise ValueError("Scope is invalid")
    window = oslo_window_key(due_at).replace("-W", "w")
    return f"weekly:{window}:{scope}"


def _int_at_least(value: object, minimum: int) -> bool:
    return type(value) is int and value >= minimum


def _nonnegative_decimal(value: object) -> bool:
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
        return False
    if value == 0:
        return True
    digits = value.as_tuple().digits
    trailing_zeroes = 0
    for digit in reversed(digits):
        if digit != 0:
            break
        trailing_zeroes += 1
    return value.as_tuple().exponent + trailing_zeroes >= -MAX_MONEY_FRACTIONAL_DIGITS


def _canonical_money(value: Decimal) -> str:
    # Zero can carry an enormous exponent or a sign. Never expand that
    # exponent, and give all equivalent zero amounts one identity.
    if value == 0:
        return "0"
    parts = value.as_tuple()
    end = len(parts.digits)
    while end > 1 and parts.digits[end-1] == 0:
        end -= 1
    digits = "".join(str(digit) for digit in parts.digits[:end])
    exponent = parts.exponent + len(parts.digits) - end
    if exponent >= 0:
        return digits + "0" * exponent
    point = len(digits) + exponent
    if point > 0:
        return digits[:point] + "." + digits[point:]
    return "0." + "0" * -point + digits


def canonical_update_request(request: UpdateRequest) -> str:
    """Validate and encode the bounded non-secret admission payload."""

    if not isinstance(request, UpdateRequest):
        raise ValueError("Update request is invalid")

    if not isinstance(request.request_key, str) or not fullmatch(
        r"[a-z0-9][a-z0-9:_-]{0,159}", request.request_key
    ):
        raise ValueError("Request key is invalid")
    if request.trigger not in {"manual", "scheduled"}:
        raise ValueError("Trigger is invalid")
    if request.trigger == "scheduled":
        if request.request_key != scheduled_request_key(
            request.scope, request.scheduled_due_at
        ):
            raise ValueError("Scheduled request key does not match its Oslo due window")
    elif request.scheduled_due_at is not None:
        raise ValueError("Manual request has an unexpected scheduled due time")
    if request.mode not in {"shadow", "publish_eligible"}:
        raise ValueError("Mode is invalid")
    if request.strategy not in {"incremental", "reconcile"}:
        raise ValueError("Strategy is invalid")
    if not isinstance(request.scope, str) or not fullmatch(
        r"[a-z0-9]+(?:-[a-z0-9]+)*", request.scope
    ) or len(request.scope) > 80:
        raise ValueError("Scope is invalid")
    for field in (request.actor_id, request.code_version, request.policy_version):
        if not isinstance(field, str) or not fullmatch(r"[A-Za-z0-9][A-Za-z0-9:_.\/-]{0,119}", field):
            raise ValueError("Trusted actor or version is invalid")

    limits = request.limits
    if (
        not isinstance(limits, RunLimits)
        or not _int_at_least(limits.max_items, 1)
        or limits.max_items > MAX_ITEMS
        or not _int_at_least(limits.max_response_bytes, 1)
        or limits.max_response_bytes > MAX_RESPONSE_BYTES
        or not _int_at_least(limits.max_model_calls, 0)
        or limits.max_model_calls > MAX_MODEL_CALLS
        or not _int_at_least(limits.max_model_input_tokens, 0)
        or limits.max_model_input_tokens > MAX_MODEL_TOKENS
        or not _int_at_least(limits.max_model_output_tokens, 0)
        or limits.max_model_output_tokens > MAX_MODEL_TOKENS
        or not _int_at_least(limits.max_retries, 0)
        or limits.max_retries > MAX_RETRIES
        or not _int_at_least(limits.max_duration_seconds, 1)
        or limits.max_duration_seconds > MAX_DURATION_SECONDS
        or not _nonnegative_decimal(limits.run_cap_usd)
        or limits.run_cap_usd > MAX_MONEY_USD
        or not _nonnegative_decimal(limits.month_cap_usd)
        or limits.month_cap_usd > MAX_MONEY_USD
        or (limits.max_model_calls > 0 and (
            limits.max_model_input_tokens == 0
            or limits.max_model_output_tokens == 0
            or limits.run_cap_usd == 0
            or limits.month_cap_usd == 0
        ))
    ):
        raise ValueError("Run limits are missing or invalid")
    if limits.max_model_calls == 0 and (
        limits.max_model_input_tokens != 0 or limits.max_model_output_tokens != 0
    ):
        raise ValueError("Model token budget exists without model calls")

    payload = {
        "actor_id": request.actor_id,
        "code_version": request.code_version,
        "limits": {
            "max_duration_seconds": limits.max_duration_seconds,
            "max_items": limits.max_items,
            "max_model_calls": limits.max_model_calls,
            "max_model_input_tokens": limits.max_model_input_tokens,
            "max_model_output_tokens": limits.max_model_output_tokens,
            "max_response_bytes": limits.max_response_bytes,
            "max_retries": limits.max_retries,
            "month_cap_usd": _canonical_money(limits.month_cap_usd),
            "run_cap_usd": _canonical_money(limits.run_cap_usd),
        },
        "mode": request.mode,
        "policy_version": request.policy_version,
        "scheduled_due_at": (request.scheduled_due_at.isoformat()
                             if request.scheduled_due_at is not None else None),
        "scope": request.scope,
        "strategy": request.strategy,
        "trigger": request.trigger,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def identify_update_request(request: UpdateRequest) -> RequestIdentity:
    """Hash the same bytes that the database admission must retain."""

    canonical = canonical_update_request(request)
    return RequestIdentity(request.request_key, sha256(canonical.encode("utf-8")).hexdigest())


def compare_existing_request(
    proposed: RequestIdentity, existing_fingerprint: str | None
) -> str:
    """Classify a database key lookup result; lookup/locking belongs to runtime."""

    if existing_fingerprint is None:
        return "new"
    if not isinstance(existing_fingerprint, str) or not fullmatch(
        r"[0-9a-f]{64}", existing_fingerprint
    ):
        return "invalid_existing_record"
    if proposed.request_fingerprint == existing_fingerprint:
        return "same_request"
    return "request_key_conflict"
