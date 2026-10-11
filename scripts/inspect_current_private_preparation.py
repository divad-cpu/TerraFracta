"""Fixed read-only, redacted local preparation observation; no proof writer.

Reuse the installed cleanup observer and saved-result validator. This module
does not call the observer's evidence-writing main or any collection entry.
"""
from datetime import datetime, timezone
import json
import re
import sys

from scripts.check_private_attempt_readiness import observe
from scripts.export_private_attempt_readiness import build_snapshot
from workers.private_attempt_readiness import utc_time


def build_current_observation(record, *, now):
    result = build_snapshot(record)
    stamp = result['recordedAt']
    if re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)', stamp) is None \
            or not isinstance(now, datetime) or now.utcoffset() != timezone.utc.utcoffset(now):
        raise ValueError('Current observation time unavailable')
    if not 0 <= (now - utc_time(stamp)).total_seconds() <= 30:
        raise ValueError('Current observation is stale or future dated')
    return {**result, 'evidenceKind': 'current_local_preparation_observation', 'pointInTimeOnly': True}


def main():
    if sys.argv[1:]:
        print('Fixed local preparation observer accepts no arguments.', file=sys.stderr)
        return 2
    try:
        result = build_current_observation(observe(), now=datetime.now(timezone.utc))
        status = {'state': 'observed', 'observation': result}
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        status = {'state': 'held', 'reason': 'local_observation_unavailable'}
    print(json.dumps(status, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
