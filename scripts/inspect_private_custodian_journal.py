"""Manual read-only journal report; explicit directory comes through stdin.

No default path, SQL, source access, retry, configuration or file write. This
exports a dated historical observation without receipt hashes/private paths.
The caller must close its bounded stdin producer; no input-wait guarantee.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from workers.private_custodian_journal import FLAGS, read_private_custodian_journal
from workers.private_attempt_readiness import utc_time

MAX_INPUT = 4096
HELD = {'state': 'held', 'reason': 'private_journal_observation_unavailable'}
FIELDS = ('state', 'recordedAt', 'admissionRecorded', 'finishRecorded',
          'nativeCleanupConfirmed', 'nativeProcessCalls', *FLAGS)


def inspect(directory, *, now=None):
    """Redact the existing strict reader; never infer current native health."""
    now = datetime.now(timezone.utc) if now is None else now
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() != timezone.utc.utcoffset(now):
        raise ValueError('Private journal observation unavailable')
    value = read_private_custodian_journal(directory)
    if set(value) != {'schemaVersion', 'evidenceKind', 'startReceiptSha256', *FIELDS} \
            or value['schemaVersion'] != 1 or value['evidenceKind'] != 'historical_private_custodian_journal' \
            or any(value[key] is not expected for key, expected in FLAGS.items()) \
            or utc_time(value['recordedAt']) > now:
        raise ValueError('Private journal observation unavailable')
    return {'state': 'observed', 'observation': {
        'schemaVersion': 1, 'evidenceKind': 'redacted_historical_private_custodian_journal',
        'inspectedAt': now.isoformat(), **{key: value[key] for key in FIELDS},
        'pointInTimeOnly': True, 'inspectorSourceRequests': 0, 'inspectorNativeQueries': 0,
        'filesChanged': False, 'configurationChanged': False, 'liveLocationSelected': False}}


def main():
    exit_code = 1
    body = json.dumps(HELD, separators=(',', ':')) + '\n'
    try:
        if sys.argv[1:] or sys.stdin.isatty(): raise ValueError
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if type(raw) is not bytes or not 2 <= len(raw) <= MAX_INPUT or not raw.endswith(b'\n') \
                or b'\n' in raw[:-1] or b'\r' in raw or b'\0' in raw:
            raise ValueError
        directory = Path(raw[:-1].decode('utf-8'))
        report = inspect(directory)
        candidate = json.dumps(report, separators=(',', ':')) + '\n'
        if len(candidate.encode('utf-8')) > 4096: raise ValueError
        body = candidate; exit_code = 0
    except KeyboardInterrupt:
        exit_code = 130
    except Exception:
        pass
    # A failed sink can leave a partial frame. Never append another report or
    # leak its diagnostic. Consumers need exit 0 AND one complete bounded JSON.
    try:
        written = sys.stdout.write(body)
        if type(written) is not int or written != len(body): return 1
        sys.stdout.flush()
    except KeyboardInterrupt:
        return 130
    except Exception:
        return 1
    return exit_code


if __name__ == '__main__': raise SystemExit(main())
