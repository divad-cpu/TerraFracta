"""Fixed read-only redacted copy observation; never collection authority."""
from datetime import datetime, timezone
import json
import sys
from scripts.audit_raw_copy_scope import observe_copy_policy


def build_observation(value, *, now):
    if type(value) is not dict or set(value) != {'backupExclusion', 'syncSetup'} \
            or value['backupExclusion'] not in ('observed', 'not_established') \
            or value['syncSetup'] not in ('present', 'not_found', 'unavailable') \
            or type(now) is not datetime or now.utcoffset() != timezone.utc.utcoffset(now):
        raise ValueError('Copy observation unavailable')
    return {'schemaVersion': 1, 'evidenceKind': 'current_local_copy_scope_observation',
        'recordedAt': now.isoformat(), 'pointInTimeOnly': True, 'state': 'held',
        **value, 'otherCopies': 'owner_context_pending', 'allCopyPathsVerified': False,
        'credentialFilesRead': False, 'rawBodiesRead': False, 'configurationChanged': False,
        'sourceRequests': 0, 'collectionPermissionIssued': False, 'publicationEnabled': False}


def main():
    if sys.argv[1:]:
        print('Fixed copy observer accepts no arguments.', file=sys.stderr)
        return 2
    try:
        value = build_observation(observe_copy_policy(), now=datetime.now(timezone.utc))
        result = {'state': 'observed', 'observation': value}
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        result = {'state': 'held', 'reason': 'copy_observation_unavailable'}
    print(json.dumps(result, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
