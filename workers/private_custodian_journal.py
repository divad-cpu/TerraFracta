"""Bounded start/finish witnesses in an explicitly supplied private journal.

An incomplete journal is preserved and cannot be reused. Historical records
never prove current process liveness, remote rollback, source rights or consent.
No directory, account, source request, retry or live target is selected here.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
from re import fullmatch
import stat

from scripts.check_private_attempt_readiness import private_read
from workers.closed_pair_channel import _json
from workers.private_admission_journal import FILENAME, _record_private_record
from workers.private_attempt_recovery import historical_admission
from workers.private_attempt_readiness import utc_time
from workers.native_pair_admission import parse_private_pair_context
from workers.update_request_identity import canonical_update_request

START = 'PRIVATE_CUSTODIAN_START.json'
FINISH = 'PRIVATE_CUSTODIAN_FINISH.json'
OUTCOMES = ('pending_held', 'failed_held', 'interrupted_held')
FLAGS = {'historicalObservationOnly': True, 'automaticRetry': False,
    'remoteWriteOutcomeVerified': False, 'sourcePermissionIssued': False, 'publicationEnabled': False}
START_FIELDS = {'schemaVersion', 'evidenceKind', 'startedAt', 'sourceInventorySha256',
    'requestContextSha256', 'admissionContextSha256', *FLAGS}
FINISH_FIELDS = {'schemaVersion', 'evidenceKind', 'observedAt', 'startReceiptSha256',
    'admissionReceiptSha256', 'outcome', 'nativeClientClosed', 'nativeCleanupConfirmed',
    'ownedNativeHandleRetained', 'nativeProcessCalls', 'rawStoreConsumed', 'backendClosed', *FLAGS}


def _time(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
        raise ValueError
    return value.isoformat()


def _digest(value):
    if type(value) is not str or fullmatch('[0-9a-f]{64}', value) is None: raise ValueError
    return value


def _binding(value):
    keys = ('principal', 'sourceInventorySha256', 'canonicalRequest', 'runId', 'workClaimId',
        'pairId', 'workAttempt', 'leaseExpiresAt', 'deadlineAt', 'responseContexts')
    selected = {key: value[key] for key in keys}
    for key in ('leaseExpiresAt', 'deadlineAt'): selected[key] = utc_time(selected[key]).isoformat()
    return sha256(json.dumps(selected, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _expected_binding(context, pin):
    work = context.metadata.work
    return _binding({'principal': context.principal, 'sourceInventorySha256': pin,
        'canonicalRequest': canonical_update_request(context.metadata.invocation),
        'runId': str(work.run_id), 'workClaimId': str(work.lease_id), 'pairId': context.pair_id,
        'workAttempt': work.attempt, 'leaseExpiresAt': work.lease_expires_at.isoformat(),
        'deadlineAt': work.deadline_at.isoformat(), 'responseContexts': {
            kind: {'registrationId': response.registration_id, 'sourceVersionId': version,
                'requestKey': response.request_key, 'maxBodyBytes': response.max_body_bytes,
                'endpointSha256': sha256(response.endpoint.encode()).hexdigest()}
            for kind, response, version in (('metadata', context.metadata, context.metadata_version_id),
                ('data', context.data, context.data_version_id))}})


def _record(raw, fields, kind):
    if type(raw) is not bytes or not 2 <= len(raw) <= 4096: raise ValueError
    value = _json(raw)
    if type(value) is not dict or set(value) != fields or type(value['schemaVersion']) is not int \
            or value['schemaVersion'] != 1 or value['evidenceKind'] != kind \
            or any(value[key] is not expected for key, expected in FLAGS.items()): raise ValueError
    return value


def _start(raw):
    value = _record(raw, START_FIELDS, 'private_custodian_start_observation')
    utc_time(value['startedAt'])
    for key in ('sourceInventorySha256', 'requestContextSha256', 'admissionContextSha256'): _digest(value[key])
    return value


def _directory(directory):
    if not isinstance(directory, Path) or not directory.is_absolute() or '..' in directory.parts \
            or any(path.is_symlink() for path in (directory, *directory.parents)): raise ValueError
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError
    return info.st_dev, info.st_ino


def _names(directory):
    with os.scandir(directory) as entries:
        names = set()
        for entry in entries:
            if len(names) >= 3 or entry.name not in (START, FILENAME, FINISH): raise ValueError
            names.add(entry.name)
    return names


def _metadata(directory, names):
    result = {}
    for name in names:
        info = (directory/name).lstat()
        result[name] = (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    return result


def record_private_custodian_start(directory, source_fingerprint, raw_context, *, now):
    """Exclusive start acknowledgement precedes native admission or a worker."""
    try:
        identity = _directory(directory)
        with os.scandir(directory) as entries:
            if next(entries, None) is not None: raise ValueError
        if type(raw_context) is not bytes or not 2 <= len(raw_context) <= 16384: raise ValueError
        context = parse_private_pair_context(raw_context, source_fingerprint, now=now)
        value = {'schemaVersion': 1, 'evidenceKind': 'private_custodian_start_observation',
            'startedAt': _time(now), 'sourceInventorySha256': _digest(source_fingerprint),
            'requestContextSha256': sha256(raw_context).hexdigest(),
            'admissionContextSha256': _expected_binding(context, source_fingerprint), **FLAGS}
        if _directory(directory) != identity: raise ValueError
        raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        reopened = _record_private_record(directory, START, raw, expected_directory=identity)
        if _directory(directory) != identity or _names(directory) != {START}: raise ValueError
        return reopened
    except (ValueError, OSError, TypeError, AttributeError):
        raise ValueError('Private custodian start journal is unavailable; preserve existing evidence') from None


def _finish(raw, start_raw, admission_raw):
    start = _start(start_raw); value = _record(raw, FINISH_FIELDS, 'private_custodian_terminal_observation')
    observed = utc_time(value['observedAt'])
    if observed < utc_time(start['startedAt']) or value['startReceiptSha256'] != sha256(start_raw).hexdigest() \
            or value['outcome'] not in OUTCOMES or value['nativeClientClosed'] is not True \
            or value['backendClosed'] is not True or type(value['nativeCleanupConfirmed']) is not bool \
            or type(value['ownedNativeHandleRetained']) is not bool or type(value['rawStoreConsumed']) is not bool \
            or type(value['nativeProcessCalls']) is not int or not 0 <= value['nativeProcessCalls'] <= 19 \
            or value['ownedNativeHandleRetained'] is value['nativeCleanupConfirmed']: raise ValueError
    if admission_raw is None:
        if value['admissionReceiptSha256'] is not None or value['outcome'] == 'pending_held' \
                or value['rawStoreConsumed']: raise ValueError
    else:
        _admission, saved = historical_admission(admission_raw)
        if value['admissionReceiptSha256'] != sha256(admission_raw).hexdigest() \
                or saved['sourceInventorySha256'] != start['sourceInventorySha256'] \
                or _binding(saved) != start['admissionContextSha256'] \
                or not utc_time(start['startedAt']) <= utc_time(saved['observedAt']) <= observed: raise ValueError
    if value['outcome'] == 'pending_held' and not value['nativeCleanupConfirmed']: raise ValueError
    return value


def record_private_custodian_finish(directory, start_raw, admission_raw, backend, *, outcome, now):
    """Persist only bounded state; never serialize exceptions, SQL or bodies."""
    from workers.private_pair_native_backend import PrivatePairNativeBackend
    from workers.bounded_native_client import BoundedNativeClient
    try:
        identity = _directory(directory)
        if type(backend) is not PrivatePairNativeBackend or type(backend.native_client) is not BoundedNativeClient \
                or private_read(directory/START) != start_raw: raise ValueError
        start = _start(start_raw)
        if start['requestContextSha256'] != sha256(backend.raw_context).hexdigest() \
                or start['sourceInventorySha256'] != backend.source_fingerprint: raise ValueError
        if admission_raw is not None and private_read(directory/FILENAME, limit=16384) != admission_raw: raise ValueError
        if admission_raw is None and (directory/FILENAME).exists(): raise ValueError
        client = backend.native_client
        value = {'schemaVersion': 1, 'evidenceKind': 'private_custodian_terminal_observation',
            'observedAt': _time(now), 'startReceiptSha256': sha256(start_raw).hexdigest(),
            'admissionReceiptSha256': None if admission_raw is None else sha256(admission_raw).hexdigest(),
            'outcome': outcome, 'nativeClientClosed': client.closed,
            'nativeCleanupConfirmed': client.cleanup_confirmed, 'ownedNativeHandleRetained': client.active,
            'nativeProcessCalls': client.calls, 'rawStoreConsumed': backend.store_consumed,
            'backendClosed': backend.closed, **FLAGS}
        raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        _finish(raw, start_raw, admission_raw)
        _record_private_record(directory, FINISH, raw, expected_directory=identity)
        raws, _saved_start, _saved_finish = _read_chain(directory)
        if _directory(directory) != identity or raws[START] != start_raw or raws.get(FILENAME) != admission_raw \
                or raws.get(FINISH) != raw: raise ValueError
        return raw
    except (ValueError, OSError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise ValueError('Private custodian finish journal is unavailable; preserve existing evidence') from None


def _read_chain(directory):
    identity = _directory(directory); names = _names(directory)
    if START not in names: raise ValueError
    metadata = _metadata(directory, names)
    raws = {name: private_read(directory/name, limit=16384 if name == FILENAME else 4096) for name in names}
    start = _start(raws[START]); admission = raws.get(FILENAME)
    if admission is not None:
        _parsed, saved = historical_admission(admission)
        if saved['sourceInventorySha256'] != start['sourceInventorySha256'] \
                or _binding(saved) != start['admissionContextSha256'] \
                or utc_time(saved['observedAt']) < utc_time(start['startedAt']): raise ValueError
    finish = _finish(raws[FINISH], raws[START], admission) if FINISH in names else None
    # Cooperative point-in-time readback, not an atomic filesystem snapshot.
    if _directory(directory) != identity or _names(directory) != names: raise ValueError
    if any(private_read(directory/name, limit=16384 if name == FILENAME else 4096) != raw for name, raw in raws.items()):
        raise ValueError
    # Catch changes to an earlier record during the last reopen, including a
    # byte-identical replacement or an entry arriving after namespace checking.
    if _metadata(directory, names) != metadata or _directory(directory) != identity or _names(directory) != names:
        raise ValueError
    return raws, start, finish


def read_private_custodian_journal(directory):
    """Read one bounded historical namespace; missing finish remains unknown."""
    try:
        raws, start, finish = _read_chain(directory); admission = raws.get(FILENAME)
        return {'schemaVersion': 1, 'evidenceKind': 'historical_private_custodian_journal',
            'state': 'outcome_not_recorded' if finish is None else
                (finish['outcome'] if finish['nativeCleanupConfirmed'] else 'local_cleanup_unconfirmed'),
            'recordedAt': start['startedAt'] if finish is None else finish['observedAt'],
            'startReceiptSha256': sha256(raws[START]).hexdigest(),
            'admissionRecorded': admission is not None, 'finishRecorded': finish is not None,
            'nativeCleanupConfirmed': None if finish is None else finish['nativeCleanupConfirmed'],
            'nativeProcessCalls': None if finish is None else finish['nativeProcessCalls'], **FLAGS}
    except (ValueError, OSError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise ValueError('Private custodian journal is inconsistent or unavailable; preserve existing evidence') from None
