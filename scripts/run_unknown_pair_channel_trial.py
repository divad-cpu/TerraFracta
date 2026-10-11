"""Actual isolated first pair with no hashes/sizes/manifest in the initial scope."""
import json
import sys
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial
from scripts.run_closed_pair_channel_trial import run_worker


def main():
    if sys.argv[1:]:raise ValueError('Fixed unknown-response trial accepts no arguments')
    with fixed_trial_guard():
        result=_run_trial('nominal',runtime_runner=run_worker,unknown_response_mode=True)
    print(json.dumps(result,indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
