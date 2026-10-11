"""One fixed invented custodian invocation with a strictly whitelisted result.

Reuse the actual custodian trial; never execute the original HTTP module. The
private native/source/raw witnesses remain in that invocation's proof folders.
This command exposes no paths, credentials, raw cells or native identity to UI.
"""
import json
from hashlib import sha256
from pathlib import Path
import sys

from scripts.run_private_custodian_trial import run_fixed_custodian_trial
from scripts.export_private_custodian_snapshot import checked_nominal_time
from scripts.check_private_attempt_readiness import private_read
from workers.closed_pair_channel import _json
from scripts.build_private_ssb_capture_api import build_private_ssb_capture_api
from workers.private_attempt_readiness import utc_time
from workers.private_custodian_journal import read_private_custodian_journal
from workers.invented_operation_journal import JOURNALED_KIND


def build_execution_result(native,source,boundary,terminal,admission_raw,*,retained_transaction=False,
        journaled_guarded=False,journal=None):
    if type(retained_transaction) is not bool:raise ValueError('Invalid invented display contract')
    if type(journaled_guarded) is not bool or (journaled_guarded and not retained_transaction) \
            or (not journaled_guarded and journal is not None):raise ValueError('Invalid journaled display contract')
    if native.get('candidateSha256')!=sha256(build_private_ssb_capture_api().encode()).hexdigest():
        raise ValueError('Fresh execution does not use the current private candidate')
    if retained_transaction and (source.get('retainedStoreTransaction') is not True or terminal.get('retainedStoreTransaction') is not True):
        raise ValueError('Invented retained transaction witnesses are unavailable')
    observed=checked_nominal_time(native,source,boundary,terminal,admission_raw,expected_native_calls=18 if retained_transaction else 19)
    if journaled_guarded:
        for record in (source,terminal):
            if record.get('journaledGuardedMode') is not True or record.get('nativeParentLifetimeRequested') is not True:
                raise ValueError('Saved guarded launch witnesses unavailable')
        if type(journal) is not dict or journal.get('state')!='pending_held' \
                or any(journal.get(key) is not True for key in ('admissionRecorded','finishRecorded',
                    'nativeCleanupConfirmed','historicalObservationOnly')) \
                or any(journal.get(key) is not False for key in ('sourcePermissionIssued','remoteWriteOutcomeVerified',
                    'automaticRetry','publicationEnabled')) \
                or type(journal.get('nativeProcessCalls')) is not int or journal['nativeProcessCalls']!=18 \
                or not utc_time(_json(admission_raw)['observedAt'])<=utc_time(journal['recordedAt'])<=observed:
            raise ValueError('Saved private journal does not confirm this nominal result')
    result={'schemaVersion':1,'evidenceKind':'fresh_invented_private_custodian_result',
        'recordedAt':observed.isoformat(),'state':'pending_private','selectedYears':[2024,2025],
        'savedPairs':1,'sourceChecks':2,'rawBindingMatched':True,'nativeAdmissionChecked':True,
        'ownedProcessesEnded':True,'sourceRequests':0,'modelCalls':0,'originalHttpModuleExecuted':False,
        'sourcePermissionIssued':False,'publicQualificationIssued':False,'checkpointAdvanced':False,
        'publicationEnabled':False,'historyPreserved':True}
    if retained_transaction:result.update(evidenceKind='fresh_invented_retained_custodian_result',retainedStoreTransaction=True)
    if journaled_guarded:result.update(evidenceKind=JOURNALED_KIND,privateJournalRecorded=True,
        creatingParentGuardRequested=True,nativeCleanupConfirmed=True,remoteRollbackAttested=False,
        historicalObservationOnly=True)
    return result


def run_fixed_display_result(*,retained_transaction=False,journaled_guarded=False):
    if type(retained_transaction) is not bool:raise ValueError('Invalid invented display contract')
    if type(journaled_guarded) is not bool or (journaled_guarded and not retained_transaction):
        raise ValueError('Invalid journaled display contract')
    source=run_fixed_custodian_trial(transactional_store=retained_transaction,journaled_guarded=journaled_guarded)
    proof=Path(source['privateEvidenceDirectory'])
    read=lambda path:_json(private_read(path,limit=16384))
    return build_execution_result(read(proof/'AUTHENTICATED_PAIR_RESULT.json'),source,
        read(proof/'PRIVATE_CUSTODIAN_BOUNDARY.json'),read(proof/'PRIVATE_CUSTODIAN_TERMINAL_STATE.json'),
        private_read(proof/('fixture-custodian-journal' if journaled_guarded else '')/'PRIVATE_NATIVE_ADMISSION.json',limit=16384).rstrip(b'\n'),
        retained_transaction=retained_transaction,journaled_guarded=journaled_guarded,
        journal=read_private_custodian_journal(proof/'fixture-custodian-journal') if journaled_guarded else None)


def main():
    if sys.argv[1:]:raise ValueError('Fixed invented custodian display accepts no arguments')
    try:
        print(json.dumps(run_fixed_display_result(),separators=(',',':')));return 0
    except (Exception,KeyboardInterrupt):
        # The trial's own finally blocks retain history/retire accounts. Never
        # expose exception details, a SQL literal or its private evidence path.
        print('The invented private test is unavailable; inspect retained evidence before another attempt.',file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(main())
