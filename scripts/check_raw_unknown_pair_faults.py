"""Actual native rejection and post-COMMIT loss with retained raw fixture pairs."""
from datetime import datetime,timezone
import json
import sys
from scripts.captured_fictional_pipeline import private_file
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial
from scripts.run_raw_unknown_pair_trial import runtime_with_raw
from workers.ssb_14059_recovery import reconcile_private_ssb_14059_pairs


def main(*,transport_children=False):
    if type(transport_children) is not bool:raise ValueError('Invalid fixed fictional transport selection')
    if sys.argv[1:]:raise ValueError('Fixed raw/database fault cases accept no arguments')
    results=[]
    for fault in ('database_rejected_after_raw','raw_store_reply_lost','raw_binding_read_before_commit'):
        observed={}
        def runtime(requests,versions,pair_id,principal,client,proof,canonical,reads):
            observed['proof']=proof
            return runtime_with_raw(requests,versions,pair_id,principal,client,proof,canonical,reads,fault=fault,transport_children=transport_children)
        with fixed_trial_guard():
            try:_run_trial('nominal',runtime_runner=runtime,unknown_response_mode=True,raw_custody_mode=True)
            except ValueError:pass
            else:raise AssertionError('Expected raw/database fault did not occur')
        proof=observed['proof'];state=json.loads((proof/'AUTHENTICATED_PAIR_FAILURE_STATE.json').read_bytes())
        inventory=json.loads((proof/'RAW_TERMINAL_INVENTORY.json').read_bytes())
        committed=fault=='raw_store_reply_lost'
        assert state['pairs']==state['rawArtifacts']==(1 if committed else 0)
        assert state['versions']==(2 if committed else 0)
        assert state['reservations']==state['dispatches']==state['settlements']==2 and state['publications']==0
        assert inventory['count']==1 and set(inventory['filesPresent'])=={'data.json','metadata.json','manifest.json'}
        assert not list(proof.glob('CHANNEL_*close_processing*')) and not list(proof.glob('CHANNEL_*read_closeout*'))
        if not committed:
            finding=reconcile_private_ssb_14059_pairs([],root=proof/'fixture-raw-store')
            assert len(finding)==1 and finding[0].state=='local_only_complete' and finding[0].issues==('database_reference_missing',)
        result={'evidenceKind':'actual_raw_database_fixture_fault','scenario':fault,'observedAt':datetime.now(timezone.utc).isoformat(),
            'failureState':state,'rawPairRetained':True,'orphanIdentifiable':not committed,'automaticRestage':False,
            'processingSuccessClaimed':False,'actualSourceRequests':0,'liveRawRootTouched':False,'primaryChanged':False,
            'boundedFictionalTransportChildren':2 if transport_children else 0,'temporaryAccountsRetired':True,'ownedCloneStopped':True,'privateEvidenceDirectory':str(proof)}
        private_file(proof/'RAW_DATABASE_FAULT_RESULT.json',json.dumps(result,indent=2)+'\n');results.append(result)
    print(json.dumps({'cases':results,'actualSourceRequests':0},indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
