"""Fixed network-free invented trial of the opt-in retained store transaction.

No original HTTP, primary mutation, live account/root, source or publication.
The unchanged ordinary v2 API is exercised in a new owned clone database.
"""
import json
from scripts.run_private_custodian_trial import run_fixed_custodian_trial


def main():
    print(json.dumps(run_fixed_custodian_trial(transactional_store=True),indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
