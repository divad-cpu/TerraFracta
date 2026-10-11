"""Private local retention for one validated SSB 14059 response pair.

No caller currently invokes this from a collector. There is no background
deletion job, database write, source activation or publication path here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from stat import S_IMODE
from uuid import uuid4

from workers.exact_timestamp import parse_exact_timestamp
from workers.ssb_14059_capture import (
    CapturedResponse,
    DATA_URL,
    MAX_RESPONSE_BYTES,
    MAX_PAIR_SPAN,
    METADATA_URL,
    SSB14059CaptureError,
    parse_captured_ssb_14059,
    parse_captured_ssb_14059_metadata,
    require_bounded_pair_chronology,
    require_matching_metadata,
)


SOURCE_ID = "SSB-14059-NO-HOUSING-COSTS"
RETENTION = timedelta(days=30)
DEFAULT_ROOT = Path.home() / ".local/state/terrafracta/ssb-14059-raw"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
_ATTEMPT_NAME = re.compile(r"(?:\.pending-)?[0-9a-f]{32}\Z")
# Keep the expiration manifest until both raw files are gone. An interrupted
# prune can then identify and finish a partially deleted attempt.
_FILES = ("data.json", "metadata.json", "manifest.json")
_MAX_MANIFEST_BYTES = 4096
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_MANIFEST_KEYS = {
    "format_version", "source_id", "attempt_id", "stored_at",
    "expires_at", "source_updated_at", "metadata", "data",
}
_RESPONSE_KEYS = {"url", "retrieved_at", "sha256", "bytes"}


class SSB14059RawStoreError(ValueError):
    """The response pair or private storage path fails the retention rules."""


def _unique_manifest_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate raw attempt manifest field")
        result[key] = value
    return result


@dataclass(frozen=True)
class StoredRawPair:
    attempt_id: str
    directory: Path
    expires_at: datetime


@dataclass(frozen=True)
class RawPairInventoryEntry:
    """Verified local attempt identity for future cross-store reconciliation."""

    attempt_id: str
    directory: Path
    expires_at: datetime
    expired: bool
    pending: bool
    present_files: tuple[str, ...]
    metadata_sha256: str
    data_sha256: str
    metadata_retrieved_at: datetime
    data_retrieved_at: datetime
    stored_at: datetime


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.utcoffset() != timedelta(0):
        raise SSB14059RawStoreError("A timezone-aware UTC time is required")
    return value.astimezone(timezone.utc)


def _check_path(root: Path, *, create: bool) -> None:
    if not root.is_absolute() or ".." in root.parts or root.is_relative_to(PROJECT_ROOT):
        raise SSB14059RawStoreError("Raw storage must be an absolute path outside the repository")
    for part in (root, *root.parents):
        if part.is_symlink():
            raise SSB14059RawStoreError("Raw storage path may not contain a symbolic link")
    if create:
        root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        root.mkdir(mode=0o700, exist_ok=True)
    if not root.exists():
        return
    for directory in (root.parent, root):
        info = directory.stat()
        if not directory.is_dir() or info.st_uid != os.getuid() or S_IMODE(info.st_mode) != 0o700:
            raise SSB14059RawStoreError("Raw storage directories must be owned by this user and mode 0700")


def _write_exclusive(path: Path, contents: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(contents)
        handle.flush()
        os.fsync(handle.fileno())


def _sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def store_private_ssb_14059_pair(
    metadata_response: CapturedResponse,
    data_response: CapturedResponse,
    *,
    root: Path = DEFAULT_ROOT,
    now: datetime | None = None,
) -> StoredRawPair:
    """Write validated raw bytes together in a private, 30-day attempt folder."""
    now = _utc(datetime.now(timezone.utc) if now is None else now)
    metadata = parse_captured_ssb_14059_metadata(metadata_response)
    data = parse_captured_ssb_14059(data_response)
    require_matching_metadata(data, metadata)
    try:
        require_bounded_pair_chronology(data, metadata)
    except SSB14059CaptureError as exc:
        raise SSB14059RawStoreError("Response pair is not one recent bounded attempt") from exc
    first_retrieval = metadata.retrieved_at
    if data.retrieved_at > now:
        raise SSB14059RawStoreError("Response pair is not one recent bounded attempt")
    expires_at = first_retrieval + RETENTION
    if expires_at <= now:
        raise SSB14059RawStoreError("Response pair is already outside its retention window")
    _check_path(root, create=True)
    attempt_id = uuid4().hex
    pending = root / f".pending-{attempt_id}"
    final = root / attempt_id
    if final.exists():
        raise SSB14059RawStoreError("Attempt identity already exists")
    pending.mkdir(mode=0o700)
    manifest = {
        "format_version": 1,
        "source_id": SOURCE_ID,
        "attempt_id": attempt_id,
        "stored_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "source_updated_at": data.source_updated_at.isoformat(),
        "metadata": {
            "url": metadata.metadata_url,
            "retrieved_at": metadata.retrieved_at.isoformat(),
            "sha256": metadata.raw_sha256,
            "bytes": len(metadata_response.body),
        },
        "data": {
            "url": data.query_url,
            "retrieved_at": data.retrieved_at.isoformat(),
            "sha256": data.raw_sha256,
            "bytes": len(data_response.body),
        },
    }
    try:
        _write_exclusive(pending / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
        _write_exclusive(pending / "metadata.json", metadata_response.body)
        _write_exclusive(pending / "data.json", data_response.body)
        _sync_directory(pending)
        if final.exists():
            raise SSB14059RawStoreError("Attempt identity already exists")
        pending.rename(final)
        _sync_directory(root)
    except Exception:
        if pending.exists():
            for name in _FILES:
                (pending / name).unlink(missing_ok=True)
            pending.rmdir()
        raise
    return StoredRawPair(attempt_id, final, expires_at)


def inspect_private_ssb_14059_pairs(
    *, root: Path = DEFAULT_ROOT, now: datetime | None = None, verify_response_bytes: bool = True
) -> tuple[RawPairInventoryEntry, ...]:
    """Inspect metadata and optionally hashes; never claim database linkage.

    Runtime custody uses metadata-only preflight, then checks its deadline
    immediately before each selected body read and validates both hashes.
    The default full inventory retains existing audit/prune integrity semantics.
    Metadata-only entries do not establish response-content integrity.
    """
    if type(verify_response_bytes) is not bool:
        raise SSB14059RawStoreError('Invalid raw inventory verification mode')
    now = _utc(datetime.now(timezone.utc) if now is None else now)
    _check_path(root, create=False)
    if not root.exists():
        return ()
    # Validate the entire root before returning any entry. A later unknown
    # item must not leave an earlier folder appearing safely reconciled.
    entries: list[RawPairInventoryEntry] = []
    seen_attempts: set[str] = set()
    for directory in sorted(root.iterdir()):
        if not _ATTEMPT_NAME.fullmatch(directory.name) or directory.is_symlink():
            raise SSB14059RawStoreError("Unknown item in private raw storage")
        directory_info = directory.stat()
        if not directory.is_dir() or directory_info.st_uid != os.getuid() or S_IMODE(directory_info.st_mode) != 0o700:
            raise SSB14059RawStoreError("Unexpected attempt directory")
        children = {item.name: item for item in directory.iterdir()}
        if not children:
            # A crash after manifest deletion may leave an empty directory, but
            # its expiry can no longer be proven. Never infer it from the name.
            raise SSB14059RawStoreError("Empty raw attempt has no verifiable expiry")
        if "manifest.json" not in children or not children.keys() <= set(_FILES):
            raise SSB14059RawStoreError("Unknown or incomplete raw attempt")
        if any(item.is_symlink() or not item.is_file() for item in children.values()):
            raise SSB14059RawStoreError("Raw attempt contains a non-file")
        if any(
            item.stat().st_uid != os.getuid() or S_IMODE(item.stat().st_mode) != 0o600
            for item in children.values()
        ):
            raise SSB14059RawStoreError("Raw attempt files must be owned by this user and mode 0600")
        if children["manifest.json"].stat().st_size > _MAX_MANIFEST_BYTES:
            raise SSB14059RawStoreError("Raw attempt manifest is too large")
        try:
            manifest = json.loads(
                children["manifest.json"].read_text(encoding="utf-8"),
                object_pairs_hook=_unique_manifest_object,
            )
            if type(manifest) is not dict or set(manifest) != _MANIFEST_KEYS:
                raise ValueError("Unexpected manifest fields")
            if any(
                type(manifest[kind]) is not dict or set(manifest[kind]) != _RESPONSE_KEYS
                for kind in ("metadata", "data")
            ):
                raise ValueError("Unexpected response fields")
            metadata_time = _utc(parse_exact_timestamp(manifest["metadata"]["retrieved_at"]))
            data_time = _utc(parse_exact_timestamp(manifest["data"]["retrieved_at"]))
            stored_at = _utc(parse_exact_timestamp(manifest["stored_at"]))
            expiry = _utc(parse_exact_timestamp(manifest["expires_at"]))
            source_updated_at = _utc(parse_exact_timestamp(manifest["source_updated_at"]))
            if (
                type(manifest["format_version"]) is not int
                or manifest["format_version"] != 1
                or manifest["source_id"] != SOURCE_ID
                or type(manifest["attempt_id"]) is not str
                or not re.fullmatch(r"[0-9a-f]{32}", manifest["attempt_id"])
                or directory.name not in (manifest["attempt_id"], f".pending-{manifest['attempt_id']}")
                or manifest["metadata"]["url"] != METADATA_URL
                or manifest["data"]["url"] != DATA_URL
                or any(
                    type(manifest[kind]["sha256"]) is not str
                    or not _HASH.fullmatch(manifest[kind]["sha256"])
                    or type(manifest[kind]["bytes"]) is not int
                    or not 0 < manifest[kind]["bytes"] <= MAX_RESPONSE_BYTES
                    for kind in ("metadata", "data")
                )
                or not metadata_time <= data_time <= stored_at < expiry
                or source_updated_at > metadata_time
                or data_time - metadata_time > MAX_PAIR_SPAN
                or expiry != metadata_time + RETENTION
            ):
                raise ValueError("Invalid attempt manifest")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise SSB14059RawStoreError("Invalid raw attempt manifest") from exc
        if manifest["attempt_id"] in seen_attempts:
            raise SSB14059RawStoreError("Duplicate raw attempt identity")
        seen_attempts.add(manifest["attempt_id"])
        pending = directory.name.startswith(".pending-")
        if expiry > now and not pending and set(children) != set(_FILES):
            raise SSB14059RawStoreError("Unexpired completed raw attempt is incomplete")
        for kind in ("metadata", "data"):
            raw = children.get(f"{kind}.json")
            if raw is not None:
                if (
                    raw.stat().st_size != manifest[kind]["bytes"]
                    or (verify_response_bytes and sha256(raw.read_bytes()).hexdigest() != manifest[kind]["sha256"])
                ):
                    raise SSB14059RawStoreError("Raw response differs from its manifest")
        entries.append(RawPairInventoryEntry(
            attempt_id=manifest["attempt_id"],
            directory=directory,
            expires_at=expiry,
            expired=expiry <= now,
            pending=pending,
            present_files=tuple(sorted(children)),
            metadata_sha256=manifest["metadata"]["sha256"],
            data_sha256=manifest["data"]["sha256"],
            metadata_retrieved_at=metadata_time,
            data_retrieved_at=data_time,
            stored_at=stored_at,
        ))
    return tuple(entries)


def prune_expired_ssb_14059_pairs(
    *, root: Path = DEFAULT_ROOT, now: datetime | None = None, dry_run: bool = False
) -> int:
    """Count or delete only expired, identifiable attempt folders; never recurse."""
    entries = inspect_private_ssb_14059_pairs(root=root, now=now)
    expired = [entry for entry in entries if entry.expired]
    if not dry_run:
        for entry in expired:
            for name in _FILES:
                if name in entry.present_files:
                    (entry.directory / name).unlink()
            entry.directory.rmdir()
    if expired and not dry_run:
        _sync_directory(root)
    return len(expired)
