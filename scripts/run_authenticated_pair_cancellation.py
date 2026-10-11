"""Actual self-SIGTERM after committed metadata; audit bounded cleanup.

Only the current owned test process is signaled. The exact network-none clone
is stopped by its normal finally block, then briefly reopened for read-only
audit and stopped again. No primary, source transport, raw file or publisher.
"""
from datetime import datetime,timezone
import json
import sys
import time
from scripts.run_authenticated_ssb_pair_capture import run_trial
from scripts.fictional_trial_guard import FictionalTrialInterrupted,fixed_trial_guard
from scripts.check_authenticated_capture_pipeline import TARGET,command
from scripts.check_archived_completion_restore import IMAGE,BIN
from scripts.check_run_admission_concurrency import quote
from scripts.captured_fictional_pipeline import private_file

def main():
    if sys.argv[1:]:raise RuntimeError('Fixed actual cancellation test accepts no arguments')
    try:run_trial('cancel_after_metadata_measurement')
    except FictionalTrialInterrupted as error:proof=error.private_evidence_directory
    else:raise AssertionError('Actual self-SIGTERM did not interrupt the paired operation')
    failure=json.loads((proof/'AUTHENTICATED_PAIR_FAILURE.json').read_text())
    assert failure['scenario']=='cancel_after_metadata_measurement' and failure['fixtureReads']==['metadata']
    assert len(failure['temporaryRoleNames'])==2
    with fixed_trial_guard():
        meta=json.loads(command(['docker','inspect','--format',
            '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}',TARGET]).stdout)
        assert meta=={'image':IMAGE,'labels':{'terrafracta.capture-auth':'20261001'},'running':False,'network':'none','ports':{}}
        try:
            assert command(['docker','start',TARGET],timeout=15).returncode==0
            for _ in range(20):
                if command(['docker','exec',TARGET,BIN+'pg_isready','-h','/tmp','-U','postgres'],timeout=5).returncode==0:break
                time.sleep(.2)
            sql=("begin read only;select jsonb_build_object('applicationLogins',"+
                "(select count(*) from pg_roles where rolname in("+','.join(map(quote,failure['temporaryRoleNames']))+") and rolcanlogin),"+
                "'reservations',(select count(*) from terra_private.source_response_reservations),"+
                "'dispatches',(select count(*) from terra_private.source_response_dispatches),"+
                "'settlements',(select count(*) from terra_private.source_response_settlements),"+
                "'pairs',(select count(*) from terra_private.source_response_pairs),"+
                "'versions',(select count(*) from terra_private.source_versions),"+
                "'publications',(select count(*) from terra_private.issue_publications));rollback;")
            audited=command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',failure['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql)
            private_file(proof/'AFTER_SIGTERM_READ_ONLY_AUDIT.log',audited.stdout+'\n'+audited.stderr)
            assert audited.returncode==0
            actual=json.loads(audited.stdout)
            assert actual=={'applicationLogins':0,'reservations':1,'dispatches':1,'settlements':1,'pairs':0,'versions':0,'publications':0}
        finally:assert command(['docker','stop','--timeout','10',TARGET],timeout=20).returncode==0
    result={'evidenceKind':'actual_owned_process_sigterm_cleanup','observedAt':datetime.now(timezone.utc).isoformat(),
        'actualSelfSigterm':True,'audit':actual,'processLockReleased':True,'originalMetadataCheckpointRetained':True,
        'temporaryAccountsRetired':True,'ownedCloneStopped':True,'actualSourceRequests':0,'primaryChanged':False,
        'privateEvidenceDirectory':str(proof)}
    private_file(proof/'ACTUAL_SIGTERM_RESULT.json',json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
