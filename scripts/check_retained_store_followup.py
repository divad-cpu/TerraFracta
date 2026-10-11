"""Distinct fixed metadata-withdrawal, cleanup and server timing observations.

Retains the earlier four cases and source version; no original HTTP or live
policy selection. Cleanup uses the actual implementation on the invented root
and preserves its still-active raw pair, with immutable start/finish records.
"""
import json
import sys
from scripts.check_retained_store_concurrency import run_case


def main():
    if sys.argv[1:]:raise ValueError('Fixed retained follow-up accepts no arguments')
    results=[run_case('queued_withdrawal_after_commit',peer='metadata',exercise_cleanup=True),
        run_case('idle_timeout',peer='metadata',observe_idle=True)]
    print(json.dumps({'evidenceKind':'actual_invented_retained_store_followup','cases':results,
        'sourceRequests':0,'primaryChanged':False,'physicalExpiryDuringShutdownGuaranteed':False},indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
