"""Fixed full private-custodian trial with an explicit network-free source.

New native private API, scoped ordinary accounts and private raw custody use
invented bytes only. Refuse the original HTTP module before native execution.
No CLI selector, primary change, selected live raw root or source permission.
"""
from dataclasses import asdict
from contextlib import nullcontext
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
import secrets
import signal
import sys
import time

from scripts.captured_fictional_pipeline import ROOT,private_file
from scripts.fictional_trial_guard import fixed_trial_guard,FictionalTrialInterrupted
from scripts.private_collector_wiring_source import TRANSPORT,invented_transport_bytes,check_private_wiring_source
from scripts import ssb_private_collector_inventory as inventory
from scripts.run_authenticated_ssb_pair_capture import PRIVATE,_run_trial,fixture_body
from scripts.check_authenticated_capture_pipeline import TARGET,command
from scripts.check_archived_completion_restore import BIN
from scripts.run_authenticated_ssb_pair_capture import REGS
from scripts.check_run_admission_concurrency import quote
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.private_collector_custodian import run_admitted_private_collector
from workers.private_collector_custodian import run_journaled_private_collector
from workers.private_admission_journal import record_private_admission
from workers.ssb_14059_raw_custody import PrivateRawCustody
from workers.ssb_14059_raw_store import DEFAULT_ROOT


FAULTS=('metadata_dispatch_receipt_lost','store_receipt_lost','closeout_receipt_lost')
RETENTION_FAULTS=('retention_revoked_before_save','retention_revoked_during_save')
JOURNAL_FAULTS=('journal_finish_receipt_lost',)


def run_fixed_custodian_trial(*,fault=None,cancel_before_metadata_read=False,source_rights_probes=False,
        transactional_store=False,storage_probe=None,journaled_guarded=False):
    if sys.argv[1:]:raise RuntimeError('Fixed private custodian trial accepts no arguments')
    if type(journaled_guarded) is not bool:raise ValueError('Invalid journaled guarded trial mode')
    if fault is not None and fault not in (*FAULTS,*RETENTION_FAULTS,*(JOURNAL_FAULTS if journaled_guarded else ())):
        raise ValueError('Unknown fixed private custodian fault')
    if type(source_rights_probes) is not bool or (source_rights_probes and fault is not None):
        raise ValueError('Source regressions require the fixed nominal trial')
    if type(cancel_before_metadata_read) is not bool or (cancel_before_metadata_read and fault is not None):
        raise ValueError('Invalid fixed custodian cancellation configuration')
    if type(transactional_store) is not bool or (transactional_store and (fault is not None or cancel_before_metadata_read)):
        raise ValueError('Retained transaction requires the distinct invented trial')
    if storage_probe is not None and (not transactional_store or not callable(storage_probe)):
        raise ValueError('Storage observation requires the invented retained transaction')
    with fixed_trial_guard():
        os.umask(0o077)
        proof=PRIVATE/('private-custodian-wiring-source-'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3))
        snapshot=proof/'source';snapshot.mkdir(mode=0o700,parents=True)
        original_manifest=inventory.inventory(ROOT)
        stub=invented_transport_bytes()
        for name,expected in json.loads(original_manifest)['files'].items():
            body=(ROOT/name).read_bytes()
            if sha256(body).hexdigest()!=expected:raise ValueError('Collector source changed before staging')
            path=snapshot/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            private_file(path,(stub if name==TRANSPORT else body).decode('utf-8'))
        raw=inventory.inventory(snapshot);pin=sha256(raw).hexdigest()
        private_file(snapshot/'MANIFEST.json',raw.decode('utf-8'))
        inventory.verify(snapshot,pin)
        source=inventory.freeze_private_collector_source(snapshot,pin)
        try:
            check_private_wiring_source(source)
            (proof/'SEALED_SOURCE.zip').write_bytes(source.check());(proof/'SEALED_SOURCE.zip').chmod(0o600)
            private_file(proof/'WIRING_BOUNDARY.json',json.dumps({'originalInventorySha256':sha256(original_manifest).hexdigest(),
                'fixtureInventorySha256':pin,'originalHttpModuleExecuted':False,'networkFreeReplacementChecked':True,
                'actualSourceRequests':0,'sourceArchiveSha256':source.archive_sha256},indent=2)+'\n')
            attempted=[];injected=[]
            def runner(requests,versions,pair_id,principal,client,capture_proof,canonical,reads):
                attempted.append(capture_proof)
                root=capture_proof/'fixture-raw-store'
                assert root!=DEFAULT_ROOT and not root.exists()
                context={'request':asdict(requests['metadata'].invocation),'work':asdict(requests['metadata'].work),
                    'responses':{kind:{'registration_id':request.registration_id,'request_key':request.request_key}
                        for kind,request in requests.items()},'versions':versions,'pairId':pair_id,'principal':principal}
                raw_context=json.dumps(context,default=str,separators=(',',':')).encode()
                confirmed=[]
                def revoke_retention():
                    # This owner mutation is confined to this freshly created
                    # invented database. Never supplied to the worker/client.
                    suffix=capture_proof.name.removeprefix('authenticated-ssb-pair-')
                    from re import fullmatch
                    if fullmatch(r'[0-9]{14}_[0-9a-f]{6}',suffix) is None:raise ValueError('Invalid fixed invented database')
                    sql='update terra_private.source_registrations set allow_retain=false where id='+quote(REGS['data'])+';'
                    result=command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d','terra_ssb_pair_'+suffix,'-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql)
                    if result.returncode:raise RuntimeError('Invented retention withdrawal failed')
                    injected.append(fault)
                    private_file(capture_proof/'INVENTED_RETENTION_WITHDRAWAL.json',json.dumps({'fault':fault,'currentPeerRetain':False,'primaryChanged':False,'sourceRequests':0})+'\n')
                def record(operation,arguments,receipt):
                    confirmed.append(operation)
                    private_file(capture_proof/('CHANNEL_'+str(len(confirmed)).zfill(3)+'_'+operation+'.json'),
                        receipt.decode('utf-8')+'\n')
                    fail=(fault=='metadata_dispatch_receipt_lost' and operation=='confirm_response'
                        and arguments['kind']=='metadata' and arguments['phase']=='dispatch') \
                        or (fault=='store_receipt_lost' and operation=='store_pair') \
                        or (fault=='closeout_receipt_lost' and operation=='close_processing')
                    if fail:
                        injected.append(fault)
                        raise ValueError('Invented custodian delivery failure')
                    if fault=='retention_revoked_before_save' and operation=='confirm_response' \
                            and arguments['kind']=='data' and arguments['phase']=='settle':
                        revoke_retention()
                    if cancel_before_metadata_read and operation=='confirm_response' \
                            and arguments['kind']=='metadata' and arguments['phase']=='dispatch':
                        # Interrupt only this owned harness after native dispatch,
                        # withholding its receipt so no fixture read can start.
                        # The main thread must cancel the client during cleanup.
                        injected.append('owned_sigterm_before_metadata_read')
                        os.kill(os.getpid(),signal.SIGTERM)
                        deadline=time.monotonic()+2
                        while not client.closed and time.monotonic()<deadline:time.sleep(0.01)
                        if not client.closed:raise RuntimeError('Owned cancellation cleanup was not observed')
                        raise ValueError('Invented receipt withheld during owned cancellation')
                with PrivateRawCustody(root) as custody:
                    if storage_probe is not None:
                        storage_probe('started',custody,capture_proof,client,None)
                        original_store=custody.store
                        def observed_store(*args,**kwargs):
                            saved=original_store(*args,**kwargs)
                            storage_probe('saved',custody,capture_proof,client,saved)
                            return saved
                        custody.store=observed_store
                    if fault=='retention_revoked_during_save':
                        original_store=custody.store
                        def store_then_withdraw(*args,**kwargs):
                            saved=original_store(*args,**kwargs);revoke_retention();return saved
                        custody.store=store_then_withdraw
                    backend=PrivatePairNativeBackend(client,custody,raw_context,pin,
                        transactional_store=transactional_store)
                    try:
                        def record_admission(raw):
                            return record_private_admission(capture_proof,raw)
                        if journaled_guarded:
                            journal=capture_proof/'fixture-custodian-journal'
                            journal.mkdir(mode=0o700)
                            # Lost acknowledgement follows the real durable writer.
                            # Confined to the invented harness, never a native replay.
                            from unittest.mock import patch
                            from workers.private_custodian_journal import record_private_custodian_finish
                            def finish_then_withhold(*args,**kwargs):
                                record_private_custodian_finish(*args,**kwargs)
                                injected.append(fault)
                                raise ValueError('Invented terminal journal acknowledgement withheld')
                            finish_scope=patch('workers.private_custodian_journal.record_private_custodian_finish',
                                side_effect=finish_then_withhold) if fault in JOURNAL_FAULTS else nullcontext()
                            with finish_scope:
                                checked=run_journaled_private_collector(source,backend,journal_directory=journal,
                                    on_confirmed=record)
                        else:
                            checked=run_admitted_private_collector(source,backend,on_confirmed=record,on_admitted=record_admission)
                        # This guard has established the complete network-free
                        # replacement; the checked worker labels describe only
                        # these invented reads, never original HTTP acceptance.
                        reads.extend(checked.worker_payload['responseKinds'])
                        private_file(capture_proof/'PRIVATE_COLLECTOR_WORKER_STDOUT.json',json.dumps(checked.worker_payload,indent=2)+'\n')
                        private_file(capture_proof/'PRIVATE_COLLECTOR_LAUNCH_BINDING.json',json.dumps(checked.worker_payload['launchReceipt'],indent=2)+'\n')
                        private_file(capture_proof/'RAW_POST_COMMIT_BINDING.json',backend.raw_binding_receipt.decode('utf-8')+'\n')
                        private_file(capture_proof/'RAW_CUSTODY_RECONCILIATION.json',json.dumps({'state':'matched',
                            'coordinatedPrivateRoot':True,'exactHashesAndTimesMatch':True,'sourceRequests':0,
                            'liveRawRootTouched':False,'physicalExpiryGuaranteed':False},indent=2)+'\n')
                        private_file(capture_proof/'PRIVATE_SSB_ASSESSMENT.json',json.dumps(checked.held_assessment,indent=2)+'\n')
                        private_file(capture_proof/'PRIVATE_CUSTODIAN_BOUNDARY.json',json.dumps({
                            'nativeAdmissionConfirmedBeforeWorker':True,'nativeAdmissionReceiptSha256':checked.native_admission_sha256,
                            'operations':checked.checked_operations,'rawBindingReopenedAfterCommit':True,
                            'sourcePermissionIssued':False,'publicQualificationIssued':False,'publicationEnabled':False,
                            'originalHttpModuleExecuted':False,'ownedBoundedNativeProcess':True},indent=2)+'\n')
                        return checked.pending
                    finally:
                        if storage_probe is not None:
                            storage_probe('finished',custody,capture_proof,client,None)
                        entries=custody.inventory()
                        private_file(capture_proof/'PRIVATE_CUSTODIAN_TERMINAL_STATE.json',json.dumps({
                            'checkedOperations':len(confirmed),'backendClosed':backend.closed,
                            'storeConsumed':backend.store_consumed,'rawAttempts':len(entries),
                            'nativeClientClosed':client.closed,'nativeProcessActive':client.active,'nativeProcessCalls':client.calls,
                            'nativeParentLifetimeRequested':client.parent_lifetime_requested,
                            'journaledGuardedMode':journaled_guarded,
                            'retainedStoreTransaction':transactional_store,
                            'injectedFault':fault,'faultInjected':bool(injected),
                            'rawBodyOutputRetained':False,'credentialOutputIncluded':False,'liveRawRootTouched':False},indent=2)+'\n')
            try:
                result=_run_trial('nominal',runtime_runner=runner,unknown_response_mode=True,raw_custody_mode=True,
                    code_fingerprint=pin,private_native_api=True,source_rights_probes=source_rights_probes,
                    native_parent_lifetime=journaled_guarded)
            except (ValueError,FictionalTrialInterrupted) as error:
                cancelled=cancel_before_metadata_read and type(error) is FictionalTrialInterrupted
                expected_injection='owned_sigterm_before_metadata_read' if cancelled else fault
                if expected_injection is None or injected!=[expected_injection] or len(attempted)!=1:raise
                capture_proof=attempted[0]
                state=json.loads((capture_proof/'AUTHENTICATED_PAIR_FAILURE_STATE.json').read_bytes())
                closeout=json.loads((capture_proof/'PRIVATE_NATIVE_FAILURE_CLOSEOUT_STATE.json').read_bytes())
                terminal=json.loads((capture_proof/'PRIVATE_CUSTODIAN_TERMINAL_STATE.json').read_bytes())
                before_store=cancelled or fault=='metadata_dispatch_receipt_lost'
                retention_fault=fault in RETENTION_FAULTS
                raw_attempts=int(not before_store and fault!='retention_revoked_before_save')
                expected={'versions':0 if before_store else 2,'pairs':0 if before_store else 1,
                    'reservations':1 if before_store else 2,'dispatches':1 if before_store else 2,
                    'settlements':0 if before_store else 2,'publications':0,'rawArtifacts':0 if before_store else 1,
                    'chargedBytes':65537 if before_store else sum(len(fixture_body(kind)) for kind in ('metadata','data'))}
                if retention_fault:expected.update(versions=0,pairs=0,rawArtifacts=0)
                if state!=expected or closeout!={'closeouts':int(fault in ('closeout_receipt_lost',*JOURNAL_FAULTS)),
                        'checkpoints':0,'usablePairs':0,'publications':0} \
                        or terminal['backendClosed'] is not True or terminal['nativeClientClosed'] is not True \
                        or terminal['nativeProcessActive'] is not False or terminal['rawAttempts']!=raw_attempts \
                        or terminal['storeConsumed'] is not (not before_store):
                    raise ValueError('Private custodian fault differs from preserved native/raw state')
                result={'evidenceKind':'actual_private_custodian_held_fault','fault':fault,
                    'observedAt':datetime.now(timezone.utc).isoformat(),'state':state,'closeoutState':closeout,
                    'privateEvidenceDirectory':str(capture_proof),'temporaryAccountsRetired':True,
                    'ownedCloneStopped':True,'rawAttemptsPreserved':raw_attempts,'nativeWriteReplayed':False,
                    'workerTerminalResultAccepted':False,'actualSourceRequests':0,'primaryChanged':False}
                if cancelled:
                    failure=json.loads((capture_proof/'AUTHENTICATED_PAIR_FAILURE.json').read_bytes())
                    admission_path=capture_proof/('fixture-custodian-journal' if journaled_guarded else '')/'PRIVATE_NATIVE_ADMISSION.json'
                    admission=admission_path.read_bytes()
                    if failure['exceptionType']!='FictionalTrialInterrupted' or failure['fixtureReads']!=[] \
                            or terminal['checkedOperations']!=4 or terminal['nativeProcessCalls']!=5:
                        raise ValueError('Owned cancellation did not stop before the metadata receipt')
                    result.update(evidenceKind='actual_private_custodian_owned_cancellation',
                        ownedSignal='SIGTERM',nativeDispatchCommitted=True,metadataReceiptWithheld=True,
                        nativeAdmissionJournalPreserved=True,nativeAdmissionJournalSha256=sha256(admission).hexdigest(),
                        checkedOperations=4,nativeProcessCalls=5,fixtureReads=[])
            else:
                if fault is not None or cancel_before_metadata_read:
                    raise AssertionError('Expected private custodian interruption did not fire')
            result.update(evidenceKind='actual_private_custodian_native_and_raw_trial',
                simulatedHttpTransport=True,originalHttpModuleExecuted=False,actualTlsAcceptance=False,
                retainedStoreTransaction=transactional_store,
                journaledGuardedMode=journaled_guarded,nativeParentLifetimeRequested=journaled_guarded,
                sourceFingerprint=pin,sourceFiles=source.source_files,sourceEvidenceDirectory=str(proof))
            if fault is not None:result['evidenceKind']='actual_private_custodian_held_fault'
            if cancel_before_metadata_read:result['evidenceKind']='actual_private_custodian_owned_cancellation'
            private_file(proof/'RESULT.json',json.dumps(result,indent=2)+'\n')
        finally:source.close()
    return result


def main():
    print(json.dumps(run_fixed_custodian_trial(),indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
