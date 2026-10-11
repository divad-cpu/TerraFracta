"""Actual fictional transport children, closed custodian and durable raw pair.

Fixed isolated trial only: invented repository bytes, owned network-none clone,
fixture raw root, pending shadow eligibility. No source/primary/public writes.
"""
import json
import sys
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial
from scripts.run_raw_unknown_pair_trial import runtime_with_raw


def runtime_with_transport(*args):
    return runtime_with_raw(*args, transport_children=True)


def main():
    if sys.argv[1:]:
        raise ValueError('Fixed fictional transport trial accepts no arguments')
    with fixed_trial_guard():
        result = _run_trial('nominal', runtime_runner=runtime_with_transport,
                            unknown_response_mode=True, raw_custody_mode=True)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
