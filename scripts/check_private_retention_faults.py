"""Actual invented rights withdrawal before/during save; preserve both cases."""
import json
import sys
from scripts.run_private_custodian_trial import RETENTION_FAULTS,run_fixed_custodian_trial


def main():
    if sys.argv[1:]:raise ValueError('Fixed retention faults accept no arguments')
    cases=[run_fixed_custodian_trial(fault=fault) for fault in RETENTION_FAULTS]
    print(json.dumps({'evidenceKind':'actual_private_retention_withdrawal_faults',
        'cases':cases,'sourceRequests':0,'originalHttpModuleExecuted':False,
        'primaryChanged':False,'publicationEnabled':False},indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
