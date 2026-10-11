"""Bounded readiness observations, never source permission or a launch grant.

The owner review/cleanup decisions are already complete. Recent healthy cleanup
and an empty folder do not settle configured copies, live code or writer scope.
Only fixed reason codes and counts may leave the private observer.
"""
from datetime import datetime, timedelta, timezone
from math import isfinite
from re import fullmatch

from workers.exact_timestamp import parse_exact_timestamp

HEALTH_MAX_AGE = timedelta(minutes=20)
_BASE = {'schemaVersion', 'evidenceKind', 'runId', 'startedAt', 'sourceRequests',
         'databaseChanged', 'physicalDeadlineGuaranteed', 'state'}
_FINISH = _BASE | {'finishedAt', 'elapsedSeconds', 'expiredAttemptsObserved',
                   'attemptsRemoved', 'activeAttemptsRemaining'}


def utc_time(value):
    if type(value) is not str or len(value) > 64:
        raise ValueError('Invalid readiness time')
    try:
        result = parse_exact_timestamp(value)
    except ValueError:
        raise ValueError('Invalid readiness time') from None
    if result.utcoffset() != timedelta(0):
        raise ValueError('Invalid readiness time')
    return result.astimezone(timezone.utc)


def cleanup_health(latest, start, finish, *, observed_at):
    """Match the three exact records, chronology, freshness and count semantics."""
    now = utc_time(observed_at)
    try:
        if any(type(x) is not dict for x in (latest, start, finish)) \
                or set(start) != _BASE or set(finish) != _FINISH or set(latest) != _FINISH \
                or latest != finish:
            raise ValueError
        for record in (latest, start, finish):
            if type(record['schemaVersion']) is not int or record['schemaVersion'] != 1 \
                    or record['evidenceKind'] != 'private_raw_cleanup_run' \
                    or type(record['runId']) is not str \
                    or fullmatch(r'[0-9]{8}T[0-9]{12}Z-[0-9a-f]{32}', record['runId']) is None \
                    or type(record['sourceRequests']) is not int or record['sourceRequests'] != 0 \
                    or record['databaseChanged'] is not False \
                    or record['physicalDeadlineGuaranteed'] is not False:
                raise ValueError
        common = _BASE - {'state'}
        if any(start[k] != finish[k] for k in common) or start['state'] != 'running' \
                or finish['state'] != 'completed':
            raise ValueError
        began, ended = utc_time(finish['startedAt']), utc_time(finish['finishedAt'])
        if not finish['runId'].startswith(began.strftime('%Y%m%dT%H%M%S%fZ')+'-'):
            raise ValueError
        if not began <= ended <= now or now - ended > HEALTH_MAX_AGE:
            return {'state': 'held', 'reason': 'cleanup_time_unavailable_or_stale'}
        for record in (latest, finish):
            if type(record['elapsedSeconds']) not in (int, float) \
                    or not isfinite(record['elapsedSeconds']) or not 0 <= record['elapsedSeconds'] < 30 \
                    or any(type(record[k]) is not int or not 0 <= record[k] <= 1024
                           for k in ('expiredAttemptsObserved', 'attemptsRemoved', 'activeAttemptsRemaining')) \
                    or record['attemptsRemoved'] != record['expiredAttemptsObserved']:
                raise ValueError
        return {'state': 'observed', 'reason': 'recent_matching_completed_cleanup',
                'finishedAt': finish['finishedAt'],
                'activeAttemptsRemaining': finish['activeAttemptsRemaining'],
                'ageSeconds': round((now - ended).total_seconds(), 6)}
    except (KeyError, ValueError, TypeError, OverflowError):
        return {'state': 'held', 'reason': 'cleanup_records_unavailable_or_inconsistent'}


def check_units(service, timer):
    """Selected actual system-manager values; file hashes are checked separately."""
    common = {'LoadState': 'loaded', 'DropInPaths': '', 'NeedDaemonReload': 'no', 'Transient': 'no'}
    service_expected = {**common, 'ActiveState': 'inactive', 'Result': 'success',
        'ExecMainStatus': '0', 'UnitFileState': 'static',
        'FragmentPath': '/etc/systemd/system/terrafracta-ssb-raw-retention.service'}
    timer_expected = {**common, 'ActiveState': 'active', 'UnitFileState': 'enabled',
        'FragmentPath': '/etc/systemd/system/terrafracta-ssb-raw-retention.timer',
        'Triggers': 'terrafracta-ssb-raw-retention.service'}
    if type(service) is not dict or type(timer) is not dict \
            or any(service.get(k) != v for k, v in service_expected.items()) \
            or any(timer.get(k) != v for k, v in timer_expected.items()):
        return {'state': 'held', 'reason': 'installed_cleanup_manager_state_unavailable_or_changed'}
    return {'state': 'observed', 'reason': 'installed_cleanup_timer_active_and_last_service_successful'}


def readiness_record(*, observed_at, snapshot_verified, unit_bytes_verified,
                     manager, health, raw_folder, copy_policy):
    """No combination of these observations can authorize a source operation."""
    utc_time(observed_at)
    if type(snapshot_verified) is not bool or type(unit_bytes_verified) is not bool:
        raise ValueError('Invalid readiness integrity flags')
    for value in (manager, health, raw_folder, copy_policy):
        if type(value) is not dict:
            raise ValueError('Invalid readiness observation')
    return {'schemaVersion': 1, 'evidenceKind': 'private_attempt_readiness_observation',
        'observedAt': observed_at, 'state': 'held', 'pointInTimeOnly': True,
        'checks': {
            'cleanupSnapshot': {'state': 'observed' if snapshot_verified else 'held',
                'reason': 'installed_snapshot_matches' if snapshot_verified else 'installed_snapshot_unavailable_or_changed'},
            'cleanupUnitBytes': {'state': 'observed' if unit_bytes_verified else 'held',
                'reason': 'installed_unit_bytes_match' if unit_bytes_verified else 'installed_unit_bytes_unavailable_or_changed'},
            'cleanupManager': manager, 'cleanupHistory': health, 'selectedRawFolder': raw_folder,
            'configuredCopies': {'state': 'held', 'reason': 'owner_copy_context_pending',
                'timeshiftExclusionObserved': copy_policy.get('timeshiftExclusionObserved') is True,
                'rcloneConfigurationPresent': copy_policy.get('rcloneConfigurationPresent') is True,
                'allCopyPathsVerified': False, 'credentialFilesRead': False},
            'liveEntry': {'state': 'held', 'reason': 'reviewed_live_entry_not_bound'},
            'privateWriter': {'state': 'held', 'reason': 'live_private_writer_not_selected'},
        }, 'sourceReviewCompleteForPrivateAttempt': True,
        'acceptedRetentionDays': 30, 'machinePermissionIssued': False,
        'sourceRequests': 0, 'databaseChanged': False, 'configurationChanged': False,
        'publicationEnabled': False, 'contentScheduleEnabled': False}
