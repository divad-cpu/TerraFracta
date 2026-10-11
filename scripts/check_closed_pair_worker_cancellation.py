"""One deliberate cancellation of this trial's owned credential-free child.

Uses a fresh isolated fixture database. The measured metadata COMMIT survives;
no pair, data response, raw artifact, public fact or refund is permitted.
"""
from datetime import datetime, timezone
import json
import sys

from scripts.captured_fictional_pipeline import private_file
from scripts.check_authenticated_capture_pipeline import TARGET, command
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial, fixture_body
from scripts.run_closed_pair_channel_trial import run_worker


def main():
    if sys.argv[1:]:
        raise RuntimeError('Fixed cancellation trial accepts no arguments')
    with fixed_trial_guard():
        def cancelled(*args):
            return run_worker(*args, cancel_after_metadata=True)
        try:
            _run_trial('nominal', runtime_runner=cancelled)
        except ValueError as error:
            proof = getattr(error, 'private_evidence_directory', None)
            if proof is None:
                raise
        else:
            raise AssertionError('Owned cancellation did not occur')
    state = json.loads((proof / 'AUTHENTICATED_PAIR_FAILURE_STATE.json').read_text())
    expected = {'versions': 0, 'pairs': 0, 'reservations': 1, 'dispatches': 1,
                'settlements': 1, 'publications': 0, 'rawArtifacts': 0,
                'chargedBytes': len(fixture_body('metadata'))}
    assert state == expected
    cancellation = json.loads((proof / 'OWNED_WORKER_CANCELLED.json').read_text())
    assert cancellation['onlyOwnedChildSignalled'] is True
    assert len(list(proof.glob('CHANNEL_*.json'))) == 5
    retired = list(proof.glob('*-retired_pair_accounts.log'))
    assert len(retired) == 1 and retired[0].read_text().strip() == '0'
    info = command(['docker', 'inspect', '--format', '{{json .State.Running}}', TARGET])
    assert info.returncode == 0 and info.stdout.strip() == 'false'
    result = {'evidenceKind': 'actual_closed_pair_worker_cancellation',
        'observedAt': datetime.now(timezone.utc).isoformat(), 'state': state,
        'nativeOperationsBeforeCancellation': 5, 'phase': 'after_metadata_settlement_commit',
        'noPartialPair': True, 'noRawArtifacts': True, 'noPublication': True,
        'budgetRefunded': False, 'temporaryAccountsRetired': True, 'ownedCloneStopped': True,
        'actualSourceRequests': 0, 'primaryChanged': False, 'privateEvidenceDirectory': str(proof)}
    private_file(proof / 'CLOSED_WORKER_CANCEL_RESULT.json', json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
