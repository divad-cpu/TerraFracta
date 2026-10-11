"""Fresh fixed journals for the reviewed immutable-STOP/inspection barrier slice.

Reuses the bounded three-case native checker without replaying older journals.
The separate fourth case loses final status readback and stays HELD despite an
acknowledged STOP; an explicit later read records reality without promotion.
"""
import json
import sys
from unittest.mock import patch
from scripts import check_supervised_review_boundary_repair_native as cases
from workers.invented_operation_journal import run_invented_operation, SUPERVISED_REVIEW_KIND
from scripts.captured_fictional_pipeline import private_file


def main():
    if sys.argv[1:]:raise ValueError('Fixed immutable STOP trial accepts no arguments')
    cases.CASES=(('exact_pause_kill','invented-correction-review-supervised-id-kill-v8'),
        ('normal','invented-correction-review-supervised-id-normal-v7'),
        ('termination_ack_loss','invented-correction-review-supervised-id-signal-ack-v4'))
    cases.RESULT_NAME='ACTUAL_IMMUTABLE_STOP_THREE_CASES_AFTER_CEILING_FIX.json'
    assert cases.main()==0
    observed=[];real_state=cases.supervisor.clone_state;reads=0
    def lost_final_readback():
        nonlocal reads
        reads+=1
        # Initial fixed identity and retirement's own initial identity read
        # remain real. Refuse only the final acceptance observation.
        if reads==3:raise OSError('Invented final clone status readback loss')
        return real_state()
    def execute():
        try:
            with patch.object(cases.supervisor,'clone_state',side_effect=lost_final_readback):
                return cases.supervisor.run_supervised_review()
        except cases.supervisor.SupervisedReviewHeld as held:
            observed.append(held.witness);raise
    status=run_invented_operation(cases.BASE/'invented-correction-review-supervised-id-readback-loss-v3',execute,expected_kind=SUPERVISED_REVIEW_KIND)
    assert status['state']=='held' and len(observed)==1 and reads==3
    witness=observed[0]
    assert witness['ownedCloneStopped'] is False and witness['failureType']=='OwnedCloneStopUnconfirmed'
    assert witness['immutableOwnedStopAttempted'] is True and witness['immutableOwnedStopCommandConfirmed'] is True
    assert witness['childExitConfirmed'] is True and witness['inspectionBarrier']=='not_required'
    current=real_state()
    assert current['running'] is False
    result={'evidenceKind':'actual_immutable_stop_with_lost_final_readback','journalHeld':True,
        'acceptedStoppedSummary':False,'immutableOwnedStopCommandConfirmed':True,'ownedWorkerExitObserved':True,
        'subsequentManualObservationStopped':True,'heldJournalPromoted':False,'nativeTrialsReplayed':False,
        'sourceRequests':0,'modelCalls':0,'primaryChanged':False,'guardianDeathVerified':False,'powerLossVerified':False,
        'privateEvidenceDirectory':witness['privateEvidenceDirectory'],'nativeEvidenceDirectory':witness['nativeEvidenceDirectory']}
    private_file(cases.BASE/'correction-review-operation-round-20261003'/'ACTUAL_IMMUTABLE_STOP_READBACK_LOSS_AFTER_CEILING_FIX.json',json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
