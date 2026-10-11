"""One retained invented web operation; file records never grant live authority.

Reuse the project's flock exclusion and bounded private reads. The start is
exclusive and fsynced before calling the trusted fixed trial. A surviving start
without a finish is held, even when its former process has exited. No takeover,
reset, raw read, database query, target discovery or automatic retry occurs.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import secrets

from scripts.check_private_attempt_readiness import private_directory, private_read
from scripts.fictional_trial_guard import FictionalTrialBusy, trial_process_lock
from workers.closed_pair_channel import _json

START='START.json'
FINISH='FINISH.json'
HELD={'state':'held','reason':'private_test_unavailable'}
EXPECTED={
    'schemaVersion':1,'evidenceKind':'fresh_invented_private_custodian_result',
    'state':'pending_private','selectedYears':[2024,2025],'savedPairs':1,'sourceChecks':2,
    'rawBindingMatched':True,'nativeAdmissionChecked':True,'ownedProcessesEnded':True,
    'sourceRequests':0,'modelCalls':0,'originalHttpModuleExecuted':False,
    'sourcePermissionIssued':False,'publicQualificationIssued':False,
    'checkpointAdvanced':False,'publicationEnabled':False,'historyPreserved':True,
}
LEGACY_KIND=EXPECTED['evidenceKind']
RETAINED_KIND='fresh_invented_retained_custodian_result'
RETAINED_EXPECTED={**EXPECTED,'evidenceKind':RETAINED_KIND,'retainedStoreTransaction':True}
JOURNALED_KIND='fresh_invented_journaled_custodian_result_v4'
JOURNALED_EXPECTED={**RETAINED_EXPECTED,'evidenceKind':JOURNALED_KIND,
    'privateJournalRecorded':True,'creatingParentGuardRequested':True,
    'nativeCleanupConfirmed':True,'remoteRollbackAttested':False,'historicalObservationOnly':True}
CORRECTION_REVIEW_KIND='fresh_invented_correction_review_result_v2'
CORRECTION_REVIEW_EXPECTED={
    'schemaVersion':1,'evidenceKind':CORRECTION_REVIEW_KIND,'state':'completed_invented_review',
    'privateReports':4,'requestReceipts':4,'reviewEvents':3,'newReports':2,'underReviewReports':1,
    'closedReports':1,'eventsAppendOnly':True,'historicalReplayDidNotReopen':True,'historyPreserved':True,
    'temporaryAccountsRetired':True,'ownedCloneStopped':True,'sourceRequests':0,'modelCalls':0,
    'realReports':0,'liveReviewEnabled':False,'publicContentChangedByReports':False,
}
SUPERVISED_REVIEW_KIND='fresh_invented_supervised_correction_review_result_v3'
SUPERVISED_REVIEW_EXPECTED={**CORRECTION_REVIEW_EXPECTED,'evidenceKind':SUPERVISED_REVIEW_KIND,
    'workerExitObserved':True,'custodianRolesRetired':True,'custodianCloneStopped':True}


def _contract(expected_kind):
    if expected_kind==LEGACY_KIND:return EXPECTED
    if expected_kind==RETAINED_KIND:return RETAINED_EXPECTED
    if expected_kind==JOURNALED_KIND:return JOURNALED_EXPECTED
    if expected_kind==CORRECTION_REVIEW_KIND:return CORRECTION_REVIEW_EXPECTED
    if expected_kind==SUPERVISED_REVIEW_KIND:return SUPERVISED_REVIEW_EXPECTED
    raise ValueError('Unknown fixed invented execution contract')


def utc(value):
    if type(value) is not str or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)',value) is None:raise ValueError
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds()!=0:raise ValueError
    return parsed


def checked_execution(value,*,expected_kind=LEGACY_KIND):
    """Exact public summary only; no Python bool/int coercion or extra fields."""
    expected=_contract(expected_kind)
    if type(value) is not dict or set(value)!=set(expected)|{'recordedAt'}:raise ValueError
    for key,wanted in expected.items():
        actual=value[key]
        if type(actual) is not type(wanted) or actual!=wanted:raise ValueError
        if type(wanted) is list and any(type(item) is not int for item in actual):raise ValueError
    utc(value['recordedAt'])
    return value


def _root(directory):
    if not isinstance(directory,Path) or not directory.is_absolute() or '..' in directory.parts:raise ValueError
    private_directory(directory.parent)
    private_directory(directory)
    info=directory.stat()
    return info.st_dev,info.st_ino


def _same_root(directory,identity):
    if _root(directory)!=identity:raise ValueError


def _names(directory):
    names=set()
    with os.scandir(directory) as entries:
        for item in entries:
            if item.name not in {'process.lock',START,FINISH} or item.name in names:raise ValueError
            names.add(item.name)
    if 'process.lock' not in names or (FINISH in names and START not in names):raise ValueError
    return names


def _started(directory,now):
    raw=private_read(directory/START,limit=4096)
    value=_json(raw)
    if set(value)!={'schemaVersion','evidenceKind','startedAt','operationId'} \
            or type(value['schemaVersion']) is not int or value['schemaVersion']!=1 \
            or value['evidenceKind']!='invented_private_web_operation_start' \
            or type(value['operationId']) is not str or re.fullmatch('[0-9a-f]{32}',value['operationId']) is None \
            or utc(value['startedAt'])>now:raise ValueError
    return raw,value


def _status(directory,identity,now,*,busy=False,expected_kind=LEGACY_KIND):
    names=_names(directory)
    if START not in names:
        result=HELD.copy() if busy else {'state':'idle'}
    else:
        raw,start=_started(directory,now)
        if busy:
            # A visible finish may still be in its writer's fsync/readback.
            result={'state':'running'}
        elif FINISH not in names:
            result=HELD.copy()
        else:
            finish=_json(private_read(directory/FINISH,limit=8192))
            if set(finish)!={'schemaVersion','evidenceKind','startSha256','finishedAt','status'} \
                    or type(finish['schemaVersion']) is not int or finish['schemaVersion']!=1 \
                    or finish['evidenceKind']!='invented_private_web_operation_finish' \
                    or finish['startSha256']!=sha256(raw).hexdigest() \
                    or not utc(start['startedAt'])<=utc(finish['finishedAt'])<=now:raise ValueError
            status=finish['status']
            if type(status) is not dict:raise ValueError
            if status==HELD and set(status)==set(HELD):result=HELD.copy()
            elif set(status)=={'state','result'} and status['state']=='checked':
                checked_execution(status['result'],expected_kind=expected_kind)
                if not utc(start['startedAt'])<=utc(status['result']['recordedAt'])<=utc(finish['finishedAt']):raise ValueError
                result=status
            else:raise ValueError
    _same_root(directory,identity)
    return result


def _write(directory,identity,name,value):
    raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\n'
    descriptor=None
    try:
        _same_root(directory,identity)
        descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
        with os.fdopen(fd,'wb') as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.fsync(descriptor)
        _same_root(directory,identity)
        if private_read(directory/name,limit=8192)!=raw:raise ValueError
        return raw
    finally:
        if descriptor is not None:os.close(descriptor)


def inspect_invented_operation(directory,*,now=None,expected_kind=LEGACY_KIND):
    """Read only: an absent operation is idle; an incomplete one never restarts."""
    now=now or datetime.now(timezone.utc)
    try:
        _contract(expected_kind)
        if not isinstance(directory,Path) or not directory.is_absolute() or '..' in directory.parts:raise ValueError
        private_directory(directory.parent)
        if not directory.exists() and not directory.is_symlink():return {'state':'idle'}
        identity=_root(directory)
        try:
            with trial_process_lock(directory,create=False):return _status(directory,identity,now,expected_kind=expected_kind)
        except FictionalTrialBusy:return _status(directory,identity,now,busy=True,expected_kind=expected_kind)
    except (OSError,ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError):return HELD.copy()


def run_invented_operation(directory,run,*,utc_now=lambda:datetime.now(timezone.utc),expected_kind=LEGACY_KIND):
    """The caller owns the fixed runner/root; neither comes from an HTTP body.

    Exclusive start remains consumed after errors, signals or lost output. File
    fsync is an observed local acknowledgement, not a claim about every disk or
    hostile same-user environment. A retained checked summary is historical;
    it cannot attest current raw availability, grant permission or publish.
    """
    try:
        _contract(expected_kind)
        if not isinstance(directory,Path) or not directory.is_absolute() or '..' in directory.parts:raise ValueError
        private_directory(directory.parent)
        created=False
        try:directory.mkdir(mode=0o700);created=True
        except FileExistsError:pass
        identity=_root(directory)
        try:
            with trial_process_lock(directory,create=created):
                existing=_status(directory,identity,utc_now(),expected_kind=expected_kind)
                if existing['state']!='idle':return existing
                started=utc_now().isoformat();utc(started)
                start={'schemaVersion':1,'evidenceKind':'invented_private_web_operation_start',
                    'startedAt':started,'operationId':secrets.token_hex(16)}
                start_raw=_write(directory,identity,START,start)
                try:
                    result=checked_execution(run(),expected_kind=expected_kind)
                    finished=utc_now()
                    if not utc(start['startedAt'])<=utc(result['recordedAt'])<=finished:raise ValueError
                    status={'state':'checked','result':result}
                except (Exception,KeyboardInterrupt):
                    finished=utc_now();status=HELD.copy()
                _write(directory,identity,FINISH,{'schemaVersion':1,
                    'evidenceKind':'invented_private_web_operation_finish','startSha256':sha256(start_raw).hexdigest(),
                    'finishedAt':finished.isoformat(),'status':status})
                return _status(directory,identity,utc_now(),expected_kind=expected_kind)
        except FictionalTrialBusy:return _status(directory,identity,utc_now(),busy=True,expected_kind=expected_kind)
    except (Exception,KeyboardInterrupt):return HELD.copy()
