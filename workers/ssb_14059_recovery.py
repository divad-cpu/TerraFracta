"""Read-only comparison of verified raw attempts with future database references.

A private pair-linked raw artifact table now exists, but this pure module
still accepts references supplied by its caller. A separate local-only audit
can load them read-only. This module never opens a database, deletes
files, advances a checkpoint, approves a source or publishes material.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from typing import Iterable, Literal

from workers.ssb_14059_capture import MAX_PAIR_SPAN
from workers.ssb_14059_raw_store import (
    DEFAULT_ROOT,
    RETENTION,
    inspect_private_ssb_14059_pairs,
)


_ATTEMPT_ID = re.compile(r"[0-9a-f]{32}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_COMPLETE_FILES = ("data.json", "manifest.json", "metadata.json")

RecoveryState = Literal[
    "matched", "matched_expired", "database_only", "expired_local_absent", "local_only_complete",
    "local_only_pending", "local_only_expired", "inconsistent",
]


class SSB14059RecoveryError(ValueError):
    """A proposed database reference cannot be compared safely."""


@dataclass(frozen=True)
class ExpectedRawPair:
    """Shape required from a later committed pair-linked artifact record."""

    attempt_id: str
    metadata_sha256: str
    data_sha256: str
    expires_at: datetime
    metadata_retrieved_at: datetime
    data_retrieved_at: datetime
    stored_at: datetime


@dataclass(frozen=True)
class RawPairRecoveryFinding:
    attempt_id: str
    state: RecoveryState
    issues: tuple[str, ...]


def _require_utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.utcoffset() != timedelta(0):
        raise SSB14059RecoveryError("Database expiry must be a timezone-aware UTC time")
    return value.astimezone(timezone.utc)


def reconcile_private_ssb_14059_pairs(
    database_pairs: Iterable[ExpectedRawPair],
    *,
    root: Path = DEFAULT_ROOT,
    now: datetime | None = None,
) -> tuple[RawPairRecoveryFinding, ...]:
    """Classify mismatches without repairing them or assuming publication rights."""
    now = _require_utc(datetime.now(timezone.utc) if now is None else now)
    expected: dict[str, ExpectedRawPair] = {}
    for pair in database_pairs:
        if not isinstance(pair, ExpectedRawPair):
            raise SSB14059RecoveryError("Unexpected database pair reference")
        if (
            not isinstance(pair.attempt_id, str)
            or not _ATTEMPT_ID.fullmatch(pair.attempt_id)
            or not isinstance(pair.metadata_sha256, str)
            or not _HASH.fullmatch(pair.metadata_sha256)
            or not isinstance(pair.data_sha256, str)
            or not _HASH.fullmatch(pair.data_sha256)
        ):
            raise SSB14059RecoveryError("Invalid database pair identity or hash")
        for value in (
            pair.expires_at, pair.metadata_retrieved_at,
            pair.data_retrieved_at, pair.stored_at,
        ):
            _require_utc(value)
        if not (
            pair.metadata_retrieved_at <= pair.data_retrieved_at
            <= pair.stored_at < pair.expires_at
        ):
            raise SSB14059RecoveryError("Invalid database attempt chronology")
        if pair.data_retrieved_at - pair.metadata_retrieved_at > MAX_PAIR_SPAN:
            raise SSB14059RecoveryError("Database response pair exceeds its five-minute span")
        if pair.expires_at != pair.metadata_retrieved_at + RETENTION:
            raise SSB14059RecoveryError("Database raw expiry differs from the 30-day limit")
        if pair.attempt_id in expected:
            raise SSB14059RecoveryError("Duplicate database attempt identity")
        expected[pair.attempt_id] = pair

    local = {
        entry.attempt_id: entry
        for entry in inspect_private_ssb_14059_pairs(root=root, now=now)
    }
    findings: list[RawPairRecoveryFinding] = []
    for attempt_id in sorted(set(expected) | set(local)):
        db_pair = expected.get(attempt_id)
        local_pair = local.get(attempt_id)
        if db_pair is None:
            assert local_pair is not None
            if local_pair.expired:
                state: RecoveryState = "local_only_expired"
            elif local_pair.pending:
                state = "local_only_pending"
            else:
                state = "local_only_complete"
            findings.append(RawPairRecoveryFinding(
                attempt_id, state, ("database_reference_missing",)
            ))
            continue
        if local_pair is None:
            # Absence after expiry is an expected state, but cannot prove when
            # the files were removed or whether an external copy still exists.
            findings.append(RawPairRecoveryFinding(
                attempt_id,
                "expired_local_absent" if db_pair.expires_at <= now else "database_only",
                () if db_pair.expires_at <= now else ("local_pair_missing",),
            ))
            continue
        issues: list[str] = []
        if local_pair.pending:
            issues.append("pending_local_attempt")
        if local_pair.present_files != _COMPLETE_FILES:
            issues.append("incomplete_local_attempt")
        if local_pair.metadata_sha256 != db_pair.metadata_sha256:
            issues.append("metadata_hash_mismatch")
        if local_pair.data_sha256 != db_pair.data_sha256:
            issues.append("data_hash_mismatch")
        if local_pair.expires_at != db_pair.expires_at:
            issues.append("expiry_mismatch")
        if local_pair.metadata_retrieved_at != db_pair.metadata_retrieved_at:
            issues.append("metadata_retrieval_mismatch")
        if local_pair.data_retrieved_at != db_pair.data_retrieved_at:
            issues.append("data_retrieval_mismatch")
        if local_pair.stored_at != db_pair.stored_at:
            issues.append("storage_time_mismatch")
        state = "inconsistent" if issues else (
            "matched_expired" if local_pair.expired else "matched"
        )
        findings.append(RawPairRecoveryFinding(attempt_id, state, tuple(issues)))
    return tuple(findings)
