"""Closed private diagnostics; exception bodies are never accepted or inspected."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat
import sys
from uuid import uuid4

CAPACITY = 1000
FILE_BYTES = 512
WORKER_CODES = frozenset({'update_worker', 'collector_worker'})


def _identity(info):
    return tuple(getattr(info, field) for field in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid',
                 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def record_worker_error(code: str, *, directory: Path | None = None) -> bool:
    """Use the explicit trusted sink, or the same development-only local archive.

    Logging never takes an error object and never changes worker stdout/results.
    A production operator must separately bind and accept the NAS directory.
    """
    if type(code) is not str or code not in WORKER_CODES or sys.platform != 'linux':
        return False
    if directory is None:
        if os.environ.get('NODE_ENV') != 'development':
            return False
        directory = Path.cwd() / '.local-error-log'
    held = None
    lock_stat = None
    try:
        directory = Path(directory)
        if not directory.is_absolute() or str(directory) != os.path.normpath(str(directory)) or directory == Path('/'):
            return False
        for parent in reversed(directory.parents):
            if not stat.S_ISDIR(parent.lstat().st_mode):
                return False
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass
        held = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(held)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            return False
        try:
            os.mkdir('.write-lock', 0o700, dir_fd=held)
        except FileExistsError:
            return False
        lock_stat = os.stat('.write-lock', dir_fd=held, follow_symlinks=False)
        if len(os.listdir(held)) - 1 >= CAPACITY:
            return False
        event_id = str(uuid4())
        event = {'schemaVersion': 1, 'eventId': event_id,
                 'occurredAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                 'origin': 'worker', 'code': code}
        raw = (json.dumps(event, separators=(',', ':')) + '\n').encode('utf-8')
        if len(raw) > FILE_BYTES:
            return False
        name = event_id + '.json'
        file = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=held)
        try:
            view = memoryview(raw)
            while view:
                written = os.write(file, view)
                if written <= 0:
                    raise OSError('Diagnostic write incomplete')
                view = view[written:]
            os.fsync(file)
            written = os.fstat(file)
            observed = os.pread(file, FILE_BYTES + 1, 0)
            named = os.stat(name, dir_fd=held, follow_symlinks=False)
            if not stat.S_ISREG(written.st_mode) or written.st_nlink != 1 or written.st_uid != os.getuid() \
                    or written.st_mode & 0o077 or written.st_size != len(raw) or observed != raw \
                    or _identity(written) != _identity(os.fstat(file)) or _identity(written) != _identity(named):
                return False
        finally:
            os.close(file)
        os.fsync(held)
        after = directory.lstat()
        return (after.st_dev, after.st_ino) == (info.st_dev, info.st_ino) and stat.S_ISDIR(after.st_mode) \
            and after.st_uid == os.getuid() and not after.st_mode & 0o077 \
            and _identity(written) == _identity(os.stat(name, dir_fd=held, follow_symlinks=False))
    except Exception:
        return False
    finally:
        if held is not None:
            if lock_stat is not None:
                try:
                    now = os.stat('.write-lock', dir_fd=held, follow_symlinks=False)
                    if (now.st_dev, now.st_ino) == (lock_stat.st_dev, lock_stat.st_ino):
                        os.rmdir('.write-lock', dir_fd=held)
                except OSError:
                    pass
            try:
                os.close(held)
            except OSError:
                pass


@contextmanager
def diagnostic_worker(code: str, *, directory: Path | None = None):
    """Preserve the original exception and outcome; expected held data is no fault."""
    try:
        yield
    except Exception:
        try:
            record_worker_error(code, directory=directory)
        except Exception:
            pass  # Preserve the original exception even if the reporter is defective.
        raise
