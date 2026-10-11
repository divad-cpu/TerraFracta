"""Three fixed invented delivery failures; retain every native/raw attempt."""
import json
import sys
from scripts.run_private_custodian_trial import FAULTS,run_fixed_custodian_trial


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed custodian faults accept no arguments')
    cases=[run_fixed_custodian_trial(fault=fault) for fault in FAULTS]
    print(json.dumps({'evidenceKind':'actual_private_custodian_fault_matrix','cases':cases,
        'originalHttpModuleExecuted':False,'actualSourceRequests':0,'primaryChanged':False},indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
