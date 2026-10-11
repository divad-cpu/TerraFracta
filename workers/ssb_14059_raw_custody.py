"""Coordinated local custody of already validated private fixture pairs.

Explicit caller-selected private root, no network, database, timer or activation.
One advisory lock coordinates clients using this boundary. It does not constrain
hostile same-user code, prove backup exclusion or guarantee shutdown deletion.
Runtime reads withhold expired bytes before opening either raw response file.
"""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from hashlib import sha256
from math import isfinite
from time import monotonic
import fcntl
import json
import os
from pathlib import Path
import re
from stat import S_IMODE, S_ISREG
import threading

from workers.exact_timestamp import parse_exact_timestamp
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.ssb_14059_raw_store import (
    SSB14059RawStoreError, _check_path, _unique_manifest_object, _utc,
    inspect_private_ssb_14059_pairs, prune_expired_ssb_14059_pairs,
    store_private_ssb_14059_pair,
)


class PrivateRawCustodyError(ValueError):
    """Generic local refusal, with no raw content or filesystem detail."""


@dataclass(frozen=True)
class RetainedRawPair:
    attempt_id: str
    metadata_response: CapturedResponse
    data_response: CapturedResponse
    expires_at: datetime
    stored_at: datetime


class PrivateRawCustody:
    """No default live root: trusted caller must provide its owned private path.

    Hold the context across a coordinated filesystem/database observation when
    both clients use it. Fail immediately on contention; never block admission
    indefinitely. The persistent empty lock lives outside the raw store so its
    strict inventory remains unchanged and a crash releases only the OS lock.
    """
    def __init__(self, root: Path, *, utc_now=lambda:datetime.now(timezone.utc)):
        if type(root) is not type(Path('/')) or not callable(utc_now):
            raise PrivateRawCustodyError('Invalid private custody configuration')
        self.root = root
        # The trusted custodian selects this clock; runtime callers use the
        # real UTC default. A historical observation is not a replacement clock.
        # Explicit injection keeps offline tests independent of today's date.
        self._utc_now = utc_now
        self._descriptor = None
        self._root_identity = None
        self._state_lock = threading.RLock()

    def _ready(self):
        if self._descriptor is None:
            raise PrivateRawCustodyError('Private custody is not held')
        _check_path(self.root, create=False)
        root_info = self.root.stat()
        lock_info = os.fstat(self._descriptor)
        path_info = self._lock_path.lstat()
        if (
            (root_info.st_dev, root_info.st_ino) != self._root_identity
            or not S_ISREG(path_info.st_mode) or lock_info.st_nlink != 1
            or lock_info.st_uid != os.getuid() or S_IMODE(lock_info.st_mode) != 0o600 or lock_info.st_size != 0
            or (path_info.st_dev, path_info.st_ino) != (lock_info.st_dev, lock_info.st_ino)
        ):
            raise PrivateRawCustodyError('Private custody identity changed')

    def __enter__(self):
        with self._state_lock:
            return self._enter_locked()

    def _enter_locked(self):
        if self._descriptor is not None:
            raise PrivateRawCustodyError('Private custody is already held')
        descriptor = None
        try:
            _check_path(self.root, create=True)
            # Hash the full path to avoid collisions between roots whose names
            # differ only in unsupported filename characters or length.
            suffix = sha256(str(self.root).encode()).hexdigest()[:24]
            self._lock_path = self.root.parent / ('.terrafracta-raw-' + suffix + '.lock')
            descriptor = os.open(self._lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            info = os.fstat(descriptor)
            if not S_ISREG(info.st_mode) or info.st_uid != os.getuid() or S_IMODE(info.st_mode) != 0o600 \
                    or info.st_nlink != 1 or info.st_size != 0:
                raise PrivateRawCustodyError('Invalid private custody lock')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            root_info = self.root.stat()
            self._root_identity = (root_info.st_dev, root_info.st_ino)
            self._descriptor = descriptor
            self._ready()
            return self
        except (OSError, SSB14059RawStoreError, PrivateRawCustodyError):
            if descriptor is not None: os.close(descriptor)
            self._descriptor = None
            raise PrivateRawCustodyError('Private custody unavailable') from None

    def __exit__(self, *_error):
        with self._state_lock:
            descriptor, self._descriptor = self._descriptor, None
            self._root_identity = None
            if descriptor is not None: os.close(descriptor)

    @contextmanager
    def _operation(self):
        held_descriptor=None
        try:
            with self._state_lock:
                self._ready()
                # flock belongs to the open file description. A non-inherited
                # duplicate retains that same lock while this already started
                # operation completes, even if caller cleanup closes custody.
                # No new operation is admitted after __exit__ clears the state.
                held_descriptor=os.dup(self._descriptor)
            yield
        except (OSError, SSB14059RawStoreError, ValueError, TypeError, KeyError):
            raise PrivateRawCustodyError('Private custody operation refused') from None
        finally:
            if held_descriptor is not None:os.close(held_descriptor)

    def inventory(self, *, now=None):
        with self._operation():
            return inspect_private_ssb_14059_pairs(root=self.root, now=now)

    def is_empty(self):
        """Admission observation without opening any prior manifest or body."""
        with self._operation():
            with os.scandir(self.root) as entries:
                return next(entries,None) is None

    def attempt_names(self):
        """Bounded directory identities only; no response or manifest is read."""
        with self._operation():
            names=[]
            with os.scandir(self.root) as entries:
                for entry in entries:
                    if len(names)>=1000 or re.fullmatch(r'(?:\.pending-)?[0-9a-f]{32}',entry.name) is None:
                        raise PrivateRawCustodyError('Private attempt namespace is unavailable')
                    info=entry.stat(follow_symlinks=False)
                    if not entry.is_dir(follow_symlinks=False) or info.st_uid!=os.getuid() or S_IMODE(info.st_mode)!=0o700:
                        raise PrivateRawCustodyError('Private attempt namespace is unavailable')
                    names.append(entry.name)
            return tuple(sorted(names))

    def store(self, metadata_response, data_response, *, now=None):
        with self._operation():
            return store_private_ssb_14059_pair(metadata_response, data_response, root=self.root, now=now)

    def prune(self, *, now=None, dry_run=False):
        with self._operation():
            return prune_expired_ssb_14059_pairs(root=self.root, now=now, dry_run=dry_run)

    def read(self, attempt_id: str, *, now: datetime | None = None):
        with self._operation():
            if type(attempt_id) is not str or re.fullmatch('[0-9a-f]{32}', attempt_id) is None:
                raise PrivateRawCustodyError('Invalid private attempt identity')
            def checked_tick(previous=None):
                tick=monotonic()
                try:
                    valid=type(tick) in (int,float) and isfinite(tick)
                except OverflowError:
                    valid=False
                if not valid or (previous is not None and tick<previous):
                    raise PrivateRawCustodyError('Private read clock unavailable')
                return tick
            started_tick=checked_tick()
            previous_tick=started_tick
            now = _utc(self._utc_now() if now is None else now)
            directory = self.root / attempt_id
            # All inventory preflight is metadata-only. Its work may cross the
            # deadline; it must not open selected or unrelated raw responses.
            manifest_path = directory / 'manifest.json'
            if directory.is_symlink() or manifest_path.is_symlink() or manifest_path.stat().st_size > 4096:
                raise PrivateRawCustodyError('Private attempt unavailable')
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'), object_pairs_hook=_unique_manifest_object)
            if type(manifest) is not dict or type(manifest.get('expires_at')) is not str:
                raise PrivateRawCustodyError('Private expiry unavailable')
            expiry = _utc(parse_exact_timestamp(manifest['expires_at']))
            if now >= expiry:
                raise PrivateRawCustodyError('Private response pair expired')
            remaining=expiry-now
            approximate_deadline=started_tick+remaining.total_seconds()
            if not isfinite(approximate_deadline) or approximate_deadline<=started_tick:
                raise PrivateRawCustodyError('Private read interval unavailable')
            exact_seconds=remaining.days*86400+remaining.seconds+Fraction(remaining.microseconds,1_000_000)
            deadline=Fraction(started_tick)+exact_seconds
            def require_unexpired():
                nonlocal previous_tick
                tick=checked_tick(previous_tick)
                if Fraction(tick)>=deadline or _utc(self._utc_now())>=expiry:
                    raise PrivateRawCustodyError('Private response pair expired during read')
                previous_tick=tick
            require_unexpired()
            entries = inspect_private_ssb_14059_pairs(root=self.root, now=now,verify_response_bytes=False)
            matches = [entry for entry in entries if entry.attempt_id == attempt_id and not entry.pending and not entry.expired]
            if len(matches) != 1:
                raise PrivateRawCustodyError('Private response pair unavailable')
            entry = matches[0]
            if entry.stored_at > now:
                raise PrivateRawCustodyError('Private response pair is not yet observable')
            bodies={}
            for kind in ('metadata','data'):
                require_unexpired()
                bodies[kind]=(directory / (kind + '.json')).read_bytes()
            require_unexpired()
            if sha256(bodies['metadata']).hexdigest() != entry.metadata_sha256 \
                    or sha256(bodies['data']).hexdigest() != entry.data_sha256:
                raise PrivateRawCustodyError('Private response pair changed')
            require_unexpired()
            return RetainedRawPair(attempt_id,
                CapturedResponse(METADATA_URL,METADATA_URL,0,200,'application/json',bodies['metadata'],entry.metadata_retrieved_at),
                CapturedResponse(DATA_URL,DATA_URL,0,200,'application/json',bodies['data'],entry.data_retrieved_at),entry.expires_at,entry.stored_at)
