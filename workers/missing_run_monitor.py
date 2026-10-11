"""Pure health classification for a scheduled update window.

A separate monitor must read durable run records to call this function; a job
cannot report that it never started.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from re import fullmatch
from zoneinfo import ZoneInfo


OSLO = ZoneInfo("Europe/Oslo")
MAX_GRACE = timedelta(hours=24)


def oslo_weekly_due_at_utc(iso_year: int, iso_week: int) -> datetime:
    """The accepted Monday 08:00 Oslo window, expressed as a UTC instant."""

    if type(iso_year) is not int or type(iso_week) is not int:
        raise ValueError("ISO year and week must be integers")
    monday = datetime.fromisocalendar(iso_year, iso_week, 1)
    return monday.replace(hour=8, tzinfo=OSLO).astimezone(timezone.utc)


def oslo_window_key(due_at: datetime) -> str:
    """Bind a run receipt to the specific local ISO week it was due."""

    if not _utc(due_at):
        raise ValueError("Due time must be UTC")
    local = due_at.astimezone(OSLO)
    year, week, _ = local.isocalendar()
    if oslo_weekly_due_at_utc(year, week) != due_at:
        raise ValueError("Due time is not Monday 08:00 Europe/Oslo")
    return f"{year}-W{week:02d}"


@dataclass(frozen=True)
class CompletedRunReceipt:
    trigger: str
    scope: str
    window_key: str
    finished_at: datetime
    run_state: str
    covered_source_keys: tuple[str, ...]
    visibility_state: str


@dataclass(frozen=True)
class ScheduledWindow:
    scope: str
    due_at: datetime
    grace: timedelta
    now: datetime
    due_source_keys: tuple[str, ...]
    latest_scheduled_run: CompletedRunReceipt | None
    latest_manual_run: CompletedRunReceipt | None = None


@dataclass(frozen=True)
class ScheduleHealth:
    state: str
    reason_code: str
    coverage_state: str


def _utc(value: datetime) -> bool:
    return (
        isinstance(value, datetime) and value.tzinfo is not None
        and value.utcoffset() == timezone.utc.utcoffset(value)
    )


def _source_keys_valid(keys: object) -> bool:
    return (
        isinstance(keys, tuple) and len(keys) <= 50
        and all(isinstance(key, str) and fullmatch(r"[a-z0-9][a-z0-9:-]{0,119}", key)
                for key in keys)
        and len(set(keys)) == len(keys)
    )


def _scope_valid(scope: object) -> bool:
    return isinstance(scope, str) and len(scope) <= 80 and bool(
        fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", scope)
    )


def _valid_receipt(receipt: CompletedRunReceipt, expected_trigger: str, now: datetime) -> bool:
    return (
        receipt.trigger == expected_trigger
        and _scope_valid(receipt.scope)
        and isinstance(receipt.window_key, str)
        and bool(fullmatch(r"[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])", receipt.window_key))
        and _utc(receipt.finished_at)
        and receipt.finished_at <= now
        and _source_keys_valid(receipt.covered_source_keys)
    )


def assess_scheduled_window(window: ScheduledWindow) -> ScheduleHealth:
    """Classify one due window without fabricating a successful collection."""

    if (
        not _scope_valid(window.scope) or not _utc(window.due_at) or not _utc(window.now)
        or not isinstance(window.grace, timedelta)
        or not timedelta(0) <= window.grace <= MAX_GRACE
        or not _source_keys_valid(window.due_source_keys)
    ):
        return ScheduleHealth("invalid", "window_invalid", "unknown")
    try:
        expected_key = oslo_window_key(window.due_at)
    except ValueError:
        return ScheduleHealth("invalid", "window_invalid", "unknown")
    if window.now < window.due_at:
        return ScheduleHealth("pending", "not_due", "unknown")
    receipt = window.latest_scheduled_run
    manual = window.latest_manual_run
    if (
        (receipt is not None and not _valid_receipt(receipt, "scheduled", window.now))
        or (manual is not None and not _valid_receipt(manual, "manual", window.now))
    ):
        return ScheduleHealth("invalid", "run_receipt_invalid", "unknown")

    if (receipt is not None and receipt.scope == window.scope
        and receipt.window_key == expected_key and receipt.finished_at >= window.due_at):
        if receipt.run_state != "completed":
            return ScheduleHealth("attention", "run_not_completed", "unknown")
        if set(receipt.covered_source_keys) != set(window.due_source_keys):
            return ScheduleHealth("attention", "due_source_coverage_incomplete", "incomplete")
        if receipt.visibility_state not in {"verified", "not_required"}:
            return ScheduleHealth("attention", "visibility_unverified", "complete")
        if receipt.finished_at > window.due_at + window.grace:
            return ScheduleHealth("attention", "scheduled_run_late", "complete")
        return ScheduleHealth("healthy", "due_window_completed", "complete")

    if window.now <= window.due_at + window.grace:
        return ScheduleHealth("pending", "within_grace_window", "unknown")
    if (manual is not None and manual.scope == window.scope
        and manual.window_key == expected_key and manual.finished_at >= window.due_at):
        if (manual.run_state == "completed"
            and set(manual.covered_source_keys) == set(window.due_source_keys)
            and manual.visibility_state in {"verified", "not_required"}):
            return ScheduleHealth(
                "attention", "scheduled_run_missing_manual_catchup_complete", "complete"
            )
        return ScheduleHealth(
            "attention", "scheduled_run_missing_manual_catchup_incomplete", "incomplete"
        )
    return ScheduleHealth("attention", "scheduled_run_missing", "unknown")
