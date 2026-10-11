"""One actual owned SIGTERM during an invented native custodian attempt.

No CLI selector, original HTTP execution, recovery write or primary change.
Keep admission, dispatch, failed attempt and account-retirement evidence.
"""
import json
import sys
from scripts.run_private_custodian_trial import run_fixed_custodian_trial


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed custodian cancellation accepts no arguments')
    result=run_fixed_custodian_trial(cancel_before_metadata_read=True)
    print(json.dumps(result,indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
