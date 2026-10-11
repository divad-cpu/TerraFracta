"""Actual separate-worker restart after a retained fictional capture failure.

Same admitted run/fence and closed native context, two owned workers. The second
worker must stop at existing metadata dispatch before transport/data/raw/store.
This is a deliberate fixed diagnostic, never an automatic live retry policy.
"""
from datetime import datetime,timezone
import json
import os
import sys
from scripts.captured_fictional_pipeline import private_file
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial
from scripts.run_raw_unknown_pair_trial import runtime_with_raw
from scripts.run_closed_pair_channel_trial import run_worker


def main():
    if sys.argv[1:]:raise ValueError('Fixed transport replay probe accepts no arguments')
    observed={};os.umask(0o077)
    def runtime(requests,versions,pair_id,principal,client,proof,canonical,reads):
        observed['proof']=proof
        for name,fault in (('first-invalid-metadata','invalid_metadata'),('same-fence-restart',None)):
            stage=proof/name;stage.mkdir(mode=0o700)
            try:
                if fault:
                    runtime_with_raw(requests,versions,pair_id,principal,client,stage,canonical,reads,
                        transport_children=True,transport_fault=fault)
                else:
                    run_worker(requests,versions,pair_id,principal,client,stage,canonical,reads,transport_children=True)
            except ValueError:
                observed[name]=stage
            else:raise AssertionError('Fixed refusal/replay was unexpectedly accepted')
        first=sorted((proof/'first-invalid-metadata').glob('CHANNEL_*.json'))
        second=sorted((proof/'same-fence-restart').glob('CHANNEL_*.json'))
        if len(first)!=6 or len(second)!=4:raise ValueError('Replay opened unexpected closed operations')
        names=[path.name.split('_',2)[2] for path in second]
        if names!=['reserve_response.json','confirm_response.json','dispatch_response.json','confirm_response.json']:
            raise ValueError('Replay continued past existing metadata dispatch')
        reserve=json.loads(second[0].read_text());dispatch=json.loads(second[2].read_text())
        if reserve['status']!='existing' or dispatch['status']!='existing':raise ValueError('Replay did not reopen committed state')
        if reserve['reservationId']!=json.loads(first[0].read_text())['reservationId']:
            raise ValueError('Restart replaced reservation identity')
        if list((proof/'first-invalid-metadata'/'fixture-raw-store').iterdir()):raise ValueError('Failed pair staged raw bytes')
        error=ValueError('Fixed same-dispatch restart refused as expected')
        error.private_evidence_directory=proof
        raise error
    with fixed_trial_guard():
        try:_run_trial('nominal',runtime_runner=runtime,unknown_response_mode=True,raw_custody_mode=True)
        except ValueError:pass
        else:raise AssertionError('Fixed replay diagnostic unexpectedly finished')
    proof=observed['proof'];state=json.loads((proof/'AUTHENTICATED_PAIR_FAILURE_STATE.json').read_text())
    expected={'versions':0,'pairs':0,'reservations':1,'dispatches':1,'settlements':1,
        'publications':0,'rawArtifacts':0,'chargedBytes':65537}
    if state!=expected:raise ValueError('Restart changed retained native history or capacity')
    result={'evidenceKind':'actual_bounded_transport_dispatch_restart_refusal','observedAt':datetime.now(timezone.utc).isoformat(),
        'actualWorkerProcesses':2,'firstRefusedAfterUncertainMetadataCharge':True,'restartClosedOperations':4,
        'sameReservationAndDispatchReopened':True,'retainedState':state,'sourceRequests':0,'automaticRetryEnabled':False,
        'workerRefetchedAfterReplay':False,'primaryChanged':False,'temporaryAccountsRetired':True,'ownedCloneStopped':True,
        'privateEvidenceDirectory':str(proof)}
    private_file(proof/'TRANSPORT_DISPATCH_REPLAY_RESULT.json',json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
