"""Reuse the weekly classifier with redacted local fictional receipt inventory.

No stored record is a trusted live run ledger. This command reads stdin only;
it never opens an archive, installs a schedule, fetches, publishes or alerts.
"""
from datetime import datetime, timedelta, timezone
import json
import re
import sys
from workers.closed_pair_channel import _json
from workers.missing_run_monitor import OSLO, CompletedRunReceipt, ScheduledWindow, assess_scheduled_window, oslo_weekly_due_at_utc, oslo_window_key

SCOPE = 'fictional-country'
SOURCE = 'fictional-source'
GRACE = timedelta(hours=1)  # Fixed rehearsal parameter, not an operational selection.


def _instant(value):
    if type(value) is not str or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)', value) is None:
        raise ValueError('Fictional receipt time refused')
    return datetime.fromisoformat(value)


def classify_inventory(value, *, now):
    if type(value) is not dict or set(value) != {'schemaVersion', 'readComplete', 'totalReceipts', 'unreadableReceipts', 'pendingReceipts', 'receipts'} \
            or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 \
            or type(value['readComplete']) is not bool or type(value['receipts']) is not list \
            or any(type(value[key]) is not int or not 0 <= value[key] <= 100 for key in ('totalReceipts', 'unreadableReceipts', 'pendingReceipts')) \
            or value['totalReceipts'] + value['pendingReceipts'] > 100 \
            or len(value['receipts']) != value['totalReceipts'] - value['unreadableReceipts'] \
            or now.utcoffset() != timezone.utc.utcoffset(now):
        raise ValueError('Fictional receipt inventory refused')
    year, week, _ = now.astimezone(OSLO).isocalendar()
    due = oslo_weekly_due_at_utc(year, week); window_key = oslo_window_key(due)
    receipts = {'scheduled': [], 'manual': []}
    for item in value['receipts']:
        if type(item) is not dict or set(item) != {'trigger', 'scope', 'executedAt', 'runState', 'coveredSourceKeys', 'fixtureDueAt'} \
                or item['trigger'] not in ('manual', 'scheduled') or item['scope'] != SCOPE \
                or item['runState'] not in ('completed', 'partial', 'failed') \
                or type(item['coveredSourceKeys']) is not list or len(item['coveredSourceKeys']) > 50 \
                or any(type(key) is not str or re.fullmatch('[a-z0-9][a-z0-9:-]{0,119}', key) is None for key in item['coveredSourceKeys']) \
                or len(set(item['coveredSourceKeys'])) != len(item['coveredSourceKeys']):
            raise ValueError('Fictional monitor receipt refused')
        finished = _instant(item['executedAt'])
        if finished > now: raise ValueError('Future fictional execution refused')
        if item['trigger'] == 'scheduled':
            key = oslo_window_key(_instant(item['fixtureDueAt']))
        else:
            if item['fixtureDueAt'] is not None: raise ValueError('Manual receipt cannot select a scheduled window')
            actual_year, actual_week, _ = finished.astimezone(OSLO).isocalendar()
            key = oslo_window_key(oslo_weekly_due_at_utc(actual_year, actual_week))
        if key == window_key:
            receipts[item['trigger']].append(CompletedRunReceipt(item['trigger'], SCOPE, key, finished,
                item['runState'], tuple(item['coveredSourceKeys']), 'not_required'))
    reason = None
    if not value['readComplete'] or value['unreadableReceipts'] or value['pendingReceipts']:
        reason = 'history_incomplete'
    selected = {}
    for trigger, candidates in receipts.items():
        candidates.sort(key=lambda item: item.finished_at, reverse=True)
        if len(candidates) > 1 and candidates[0].finished_at == candidates[1].finished_at:
            reason = reason or 'latest_receipt_ambiguous'
        selected[trigger] = candidates[0] if candidates else None
    health = assess_scheduled_window(ScheduledWindow(SCOPE, due, GRACE, now, (SOURCE,), selected['scheduled'], selected['manual']))
    return {'schemaVersion': 1, 'evidenceKind': 'current_local_fictional_weekly_status',
        'observedAt': now.isoformat(), 'dueAt': due.isoformat(), 'windowKey': window_key,
        'graceMinutes': 60, 'state': 'held' if reason else health.state,
        'reason': reason or health.reason_code, 'coverage': 'unknown' if reason else health.coverage_state,
        'totalReceipts': value['totalReceipts'], 'unreadableReceipts': value['unreadableReceipts'],
        'pendingReceipts': value['pendingReceipts'], 'realScheduleEnabled': False,
        'trustedRunLedger': False, 'sourceRequests': 0, 'publicationEnabled': False, 'alertsSent': 0}


def main():
    if sys.argv[1:]: raise ValueError('Fixed fictional weekly status accepts no arguments')
    raw = sys.stdin.buffer.read(65537)
    if not 2 <= len(raw) <= 65536: raise ValueError('Fictional monitor input bound exceeded')
    result = classify_inventory(_json(raw), now=datetime.now(timezone.utc))
    print(json.dumps(result, indent=2)); return 0


if __name__ == '__main__': raise SystemExit(main())
