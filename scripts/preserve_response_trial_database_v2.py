"""New evidence after Docker's owned unless-stopped policy restarted v1.

Original stop attempt/source remain retained; this changes restart policy
only on the completed trial, not on any primary or unrelated container.
"""
from scripts import preserve_response_trial_database as preserve
from scripts.prepare_response_reservation_trial import TRIAL

preserve.DEST=TRIAL/'database-preservation-v2'

if __name__=='__main__':raise SystemExit(preserve.main())
