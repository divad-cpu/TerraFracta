"""Fixed fresh fictional witnesses for the three independent custody repairs.

Retain older failed/checked journals. New namespaces are one-attempt only;
unknown real loss, guardian/power loss and live dispatch are not exercised.
"""
from datetime import datetime, timezone
import json
import sys
from unittest.mock import patch

from scripts import supervised_correction_review as supervisor
from scripts.captured_fictional_pipeline import private_file
from workers.invented_operation_journal import run_invented_operation, SUPERVISED_REVIEW_KIND

BASE = supervisor.successor.PRIVATE
CASES = (
    ('exact_pause_kill', 'invented-correction-review-supervised-kill-fixed-v5'),
    ('normal', 'invented-correction-review-supervised-fixed-v4'),
    ('termination_ack_loss', 'invented-correction-review-supervised-signal-ack-fixed-v1'))
RESULT_NAME = 'ACTUAL_CUSTODY_BOUNDARY_REPAIR_RESULT.json'


def main():
    if sys.argv[1:]: raise ValueError('Fixed boundary-repair trial accepts no arguments')
    results = []
    signal_calls = []
    original_popen = supervisor.subprocess.Popen
    original_receive = supervisor.receive_packet
    receives = 0

    def lost_signal_ack_child(argv, *args, **kwargs):
        child = original_popen(argv, *args, **kwargs)
        if argv == [sys.executable, '-B', '-E', '-s', '-m', 'scripts.supervised_correction_review_worker']:
            terminate = child.terminate
            def lost_ack():
                terminate(); signal_calls.append('actual_owned_terminate_api_invoked_ack_error')
                raise OSError('Invented lost termination acknowledgement')
            child.terminate = lost_ack
        return child

    def wrong_stage_after_actual_pause(channel, **kwargs):
        nonlocal receives
        value = original_receive(channel, **kwargs); receives += 1
        return {**value, 'schemaVersion': True} if receives == 2 else value

    for case, name in CASES:
        witness = None
        def execute():
            nonlocal witness
            try:
                if case == 'termination_ack_loss':
                    with patch.object(supervisor.subprocess, 'Popen', side_effect=lost_signal_ack_child), \
                            patch.object(supervisor, 'receive_packet', side_effect=wrong_stage_after_actual_pause):
                        return supervisor.run_supervised_review()
                return supervisor.run_supervised_review(kill_after_first_reports=case == 'exact_pause_kill')
            except supervisor.SupervisedReviewHeld as held:
                witness = held.witness
                raise
        status = run_invented_operation(BASE / name, execute, expected_kind=SUPERVISED_REVIEW_KIND)
        if case == 'normal':
            assert status['state'] == 'checked'
            assert status['result']['custodianCloneStopped'] is True
            assert status['result']['custodianRolesRetired'] is True
            results.append({'case': case, 'journalState': 'checked', 'reports': 4, 'receipts': 4, 'events': 3})
        else:
            # A consumed historical journal does not execute again and cannot
            # manufacture a new native witness for this diagnostic checker.
            assert status['state'] == 'held' and witness is not None
            assert witness['ownedCloneStopped'] is True and witness['childExitConfirmed'] is True
            if case == 'exact_pause_kill':
                assert witness['workerKilledAfterFirstReports'] is True
                assert witness['cleanup']['remainingLogin'] == 0
                assert witness['cleanup']['counts'] == {'reports': 2, 'receipts': 2, 'events': 0, 'publications': 1, 'heads': 1}
            else:
                assert signal_calls == ['actual_owned_terminate_api_invoked_ack_error']
                assert witness['workerQuiescenceVerified'] is False
                assert witness['cleanup']['state'] == 'held_for_private_inspection'
                assert witness['cleanup']['remainingLogin'] is None
            results.append({'case': case, 'journalState': 'held', 'ownedWorkerExitObserved': True,
                'ownedCloneStopped': True, 'privateEvidenceDirectory': witness['privateEvidenceDirectory'],
                'nativeEvidenceDirectory': witness['nativeEvidenceDirectory'],
                'automaticRetry': False, 'unknownPhaseRetirementAccepted': False})
    result = {'evidenceKind': 'actual_fixed_custody_boundary_repair_trials',
        'observedAt': datetime.now(timezone.utc).isoformat(), 'cases': results,
        'olderJournalsReplayed': False, 'sourceRequests': 0, 'modelCalls': 0, 'primaryChanged': False,
        'kernelSignalDeliveryVerified': False, 'guardianDeathVerified': False, 'powerLossVerified': False, 'liveDispatchEnabled': False}
    private_file(BASE / 'correction-review-operation-round-20261003' / RESULT_NAME, json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); return 0


if __name__ == '__main__': raise SystemExit(main())
