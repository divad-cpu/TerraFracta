"""Exclusive, fsynced private admission evidence; never execution authority."""
import os
from pathlib import Path
import stat

from scripts.check_private_attempt_readiness import private_read
from workers.private_attempt_recovery import historical_admission

FILENAME='PRIVATE_NATIVE_ADMISSION.json'


def record_private_admission(directory,raw):
    """Validate and preserve one admission with exact fsynced readback."""
    historical_admission(raw)
    return _record_private_record(directory,FILENAME,raw)


def _record_private_record(directory,filename,raw,*,expected_directory=None):
    """Return exact reopened bytes only after file and directory fsync.

    The trusted caller supplies an existing owner-only journal directory. A
    failed/ambiguous file remains for inspection; nothing is erased or replayed.
    This observes local filesystem acknowledgement, not power-loss durability
    on every filesystem, hardware, backup or hostile same-user environment.
    """
    descriptor=None
    try:
        if filename not in (FILENAME,'PRIVATE_CUSTODIAN_START.json','PRIVATE_CUSTODIAN_FINISH.json') \
                or type(raw) is not bytes or not 2<=len(raw)<=16384:raise ValueError
        if not isinstance(directory,Path) or not directory.is_absolute() or '..' in directory.parts \
                or any(path.is_symlink() for path in (directory,*directory.parents)):raise ValueError
        descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        before=os.fstat(descriptor)
        if not stat.S_ISDIR(before.st_mode) or before.st_uid!=os.geteuid() or stat.S_IMODE(before.st_mode)!=0o700:
            raise ValueError
        if expected_directory is not None and (before.st_dev,before.st_ino)!=expected_directory:raise ValueError
        fd=os.open(filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
        with os.fdopen(fd,'wb') as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
            saved=os.fstat(stream.fileno())
        os.fsync(descriptor)
        after=directory.stat()
        if (before.st_dev,before.st_ino,before.st_uid,stat.S_IMODE(before.st_mode)) \
                !=(after.st_dev,after.st_ino,after.st_uid,stat.S_IMODE(after.st_mode)):raise ValueError
        reopened=private_read(directory/filename,limit=16384)
        stable=lambda item:(item.st_dev,item.st_ino,item.st_mode,item.st_uid,item.st_gid,
            item.st_nlink,item.st_size,item.st_mtime_ns,item.st_ctime_ns)
        final_directory=directory.lstat()
        if reopened!=raw or stable((directory/filename).lstat())!=stable(saved) \
                or (before.st_dev,before.st_ino,before.st_uid,stat.S_IMODE(before.st_mode)) \
                    !=(final_directory.st_dev,final_directory.st_ino,final_directory.st_uid,stat.S_IMODE(final_directory.st_mode)):
            raise ValueError
        return reopened
    except (ValueError,OSError,TypeError):
        raise ValueError('Private admission journal is unavailable; preserve existing evidence') from None
    finally:
        if descriptor is not None:os.close(descriptor)
