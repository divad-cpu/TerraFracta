"""Process exclusion and cooperative interruption for owned local trials.

The persistent empty lock file is neither a credential nor operation history.
It is never removed or overwritten. The OS releases its advisory lock when the
owning process exits; the trial separately verifies the clone is stopped before
starting. No stale-lock takeover, target selection or Docker action occurs here.
"""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat

ROOT=Path(__file__).resolve().parents[1]
DIRECTORY=ROOT/'.local-connected-trial'
INSPECTION_REQUIRED='REVIEW_INSPECTION_REQUIRED.json'


class FictionalTrialBusy(RuntimeError):pass
class FictionalTrialInterrupted(KeyboardInterrupt):pass
class FictionalTrialInspectionRequired(RuntimeError):pass


def require_no_inspection_barrier(directory):
    # Any existing marker blocks; do not follow links or interpret its content
    # as permission. Unreadable/malformed markers also require inspection.
    try:(Path(directory)/INSPECTION_REQUIRED).lstat()
    except FileNotFoundError:return
    except OSError:pass
    raise FictionalTrialInspectionRequired('An unconfirmed owned worker requires private inspection')


def record_review_inspection_barrier(container_id,child_pid,proof_name,*,directory=DIRECTORY):
    if type(container_id) is not str or re.fullmatch('[0-9a-f]{64}',container_id) is None \
            or type(child_pid) is not int or child_pid<=1 \
            or type(proof_name) is not str or re.fullmatch(r'supervised-correction-review-[0-9]{14}_[0-9a-f]{6}',proof_name) is None:
        raise ValueError('Fixed owned inspection context differs')
    from scripts.check_private_attempt_readiness import private_directory,private_read
    directory=Path(directory);private_directory(directory)
    descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    value={'schemaVersion':1,'evidenceKind':'unconfirmed_owned_review_child',
        'containerId':container_id,'ownedChildPid':child_pid,'privateProofName':proof_name}
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
    try:
        expected=directory.stat();actual=os.fstat(descriptor)
        if (expected.st_dev,expected.st_ino)!=(actual.st_dev,actual.st_ino):raise ValueError('Private trial directory changed')
        fd=os.open(INSPECTION_REQUIRED,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.fsync(descriptor)
        private_directory(directory)
        if private_read(directory/INSPECTION_REQUIRED)!=raw:raise ValueError('Private inspection record changed')
        return True
    finally:os.close(descriptor)


@contextmanager
def trial_process_lock(directory=DIRECTORY, *, create=True):
    directory=Path(directory)
    if create:
        try:directory.mkdir(mode=0o700)
        except FileExistsError:pass
    mode=directory.lstat()
    if not stat.S_ISDIR(mode.st_mode) or stat.S_IMODE(mode.st_mode)!=0o700 or mode.st_uid!=os.geteuid():
        raise RuntimeError('Private local trial directory is invalid')
    descriptor=os.open(directory/'process.lock',os.O_RDWR|os.O_NOFOLLOW|(os.O_CREAT if create else 0),0o600)
    acquired=False
    try:
        info=os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size!=0 \
           or stat.S_IMODE(info.st_mode)!=0o600 or info.st_uid!=os.geteuid():
            raise RuntimeError('Private local trial lock is invalid')
        try:fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as error:raise FictionalTrialBusy('Another connected local trial is running') from error
        acquired=True
        require_no_inspection_barrier(directory)
        yield descriptor
    finally:
        if acquired:fcntl.flock(descriptor,fcntl.LOCK_UN)
        os.close(descriptor)


@contextmanager
def cooperative_trial_interrupt():
    previous=signal.getsignal(signal.SIGTERM)
    def interrupt(signum,frame):
        # Cancellation must not become an ordinary caught transport error.
        # One interrupt initiates cleanup; repeated TERM cannot interrupt
        # the bounded finally blocks before identities are retired.
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        raise FictionalTrialInterrupted('Local trial was interrupted; bounded cleanup runs')
    signal.signal(signal.SIGTERM,interrupt)
    try:yield
    finally:signal.signal(signal.SIGTERM,previous)


@contextmanager
def fixed_trial_guard():
    with trial_process_lock() as descriptor,cooperative_trial_interrupt():yield descriptor
