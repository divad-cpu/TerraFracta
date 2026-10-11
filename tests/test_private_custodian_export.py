"""Dated progress projections consume invented witnesses, never live permission."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import json
import unittest

from scripts.export_private_custodian_snapshot import build_snapshot,FAULT_NAMES
from scripts.rehearse_private_custodian_display import build_execution_result
from tests.frozen_ssb_support import admitted_context
from tests.test_native_pair_admission import admission_fixture
from workers.native_pair_custodian import OPERATIONS


class CustodianExportTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,10,2,10,tzinfo=timezone.utc);pin='a'*64
        context,_=admitted_context(pin,now=self.now)
        self.admission=json.dumps(admission_fixture(context,pin,self.now)).encode()
        self.native={'evidenceKind':'actual_closed_scram_ssb_format_fixture_pair','observedAt':self.now.isoformat(),
            'closedWorkerBoundaryVerified':True,'rawCustodyBound':True,'primaryChanged':False,
            'responseHashesPreprovisioned':False,'actualSourceRequests':0,'validationState':'pending','runState':'partial',
            'counts':{'pairs':1,'checks':2,'bindings':1,'versions':2,'manifests':1},'publicWriterEnabled':False,'modelCalls':0}
        self.source={**self.native,'evidenceKind':'actual_private_custodian_native_and_raw_trial','sourceFingerprint':pin,
            'temporaryAccountsRetired':True,'ownedCloneStopped':True,'simulatedHttpTransport':True,
            'originalHttpModuleExecuted':False,'actualTlsAcceptance':False}
        self.boundary={'nativeAdmissionReceiptSha256':sha256(self.admission).hexdigest(),'operations':list(OPERATIONS),
            'nativeAdmissionConfirmedBeforeWorker':True,'rawBindingReopenedAfterCommit':True,'ownedBoundedNativeProcess':True,
            'sourcePermissionIssued':False,'publicQualificationIssued':False,'publicationEnabled':False,'originalHttpModuleExecuted':False}
        self.terminal={'backendClosed':True,'storeConsumed':True,'nativeClientClosed':True,'nativeProcessActive':False,
            'rawBodyOutputRetained':False,'credentialOutputIncluded':False,'liveRawRootTouched':False,
            'checkedOperations':16,'rawAttempts':1,'nativeProcessCalls':18}
        self.faults=[]
        for index,(name,ops,calls) in enumerate(zip(FAULT_NAMES,(4,13,15),(5,15,17),strict=True)):
            before=index==0;record={**self.source,'evidenceKind':'actual_private_custodian_held_fault','fault':name,
                'observedAt':(self.now+timedelta(seconds=index+1)).isoformat(),
                'nativeWriteReplayed':False,'workerTerminalResultAccepted':False,
                'state':{'pairs':int(not before),'versions':0 if before else 2,'dispatches':1 if before else 2,
                    'settlements':0 if before else 2,'chargedBytes':65537 if before else 1924,'publications':0,
                    'rawArtifacts':int(not before),'reservations':1 if before else 2},
                'closeoutState':{'closeouts':int(index==2),'checkpoints':0,'usablePairs':0,'publications':0}}
            terminal={**self.terminal,'faultInjected':True,'injectedFault':name,'storeConsumed':not before,
                'checkedOperations':ops,'nativeProcessCalls':calls,'rawAttempts':int(not before)}
            self.faults.append((record,terminal))

    def snapshot(self):
        return build_snapshot(self.native,self.source,self.boundary,self.terminal,self.admission,self.faults)

    def test_whitelisted_progress_keeps_all_faults_held_without_private_values(self):
        self.native['privatePath']='/private-canary';self.source['rawBody']='private-canary'
        result=self.snapshot();encoded=json.dumps(result)
        self.assertEqual(result['pendingYears'],[2024,2025])
        self.assertEqual([x['result'] for x in result['faults']],['held']*3)
        self.assertFalse(result['liveStatus']);self.assertFalse(result['checkpointAdvanced'])
        for text in ('private-canary','sourceFingerprint','principal',self.source['sourceFingerprint']):
            self.assertNotIn(text,encoded)

    def test_mixed_admission_source_and_changed_native_bytes_refuse(self):
        original=self.admission
        self.admission=original+b' '
        with self.assertRaises(ValueError):self.snapshot()
        self.admission=original;self.source['sourceFingerprint']='b'*64
        with self.assertRaises(ValueError):self.snapshot()

    def test_fresh_execution_projection_has_no_native_identity_or_raw_value(self):
        from scripts.build_private_ssb_capture_api import build_private_ssb_capture_api
        native={**self.native,'candidateSha256':sha256(build_private_ssb_capture_api().encode()).hexdigest()}
        terminal={**self.terminal,'nativeProcessCalls':19}
        result=build_execution_result(native,self.source,self.boundary,terminal,self.admission)
        self.assertEqual(result['state'],'pending_private');self.assertEqual(result['selectedYears'],[2024,2025])
        self.assertFalse(result['sourcePermissionIssued']);self.assertFalse(result['originalHttpModuleExecuted'])
        for key in ('sourceFingerprint','canonicalManifest','rawBody','principal','privateEvidenceDirectory'):
            self.assertNotIn(key,result)

    def test_current_display_cannot_promote_the_previous_native_candidate(self):
        native={**self.native,'candidateSha256':'4854e956f83325e17e4747f786b43cc533f02e2775a21d92dc337283db3d7afa'}
        with self.assertRaises(ValueError):
            build_execution_result(native,self.source,self.boundary,{**self.terminal,'nativeProcessCalls':19},self.admission)

    def test_retained_execution_requires_both_witnesses_and_exact_process_count(self):
        from scripts.build_private_ssb_capture_api import build_private_ssb_capture_api
        native={**self.native,'candidateSha256':sha256(build_private_ssb_capture_api().encode()).hexdigest()}
        source={**self.source,'retainedStoreTransaction':True}
        terminal={**self.terminal,'retainedStoreTransaction':True}
        checked=build_execution_result(native,source,self.boundary,terminal,self.admission,retained_transaction=True)
        self.assertEqual(checked['evidenceKind'],'fresh_invented_retained_custodian_result')
        self.assertIs(checked['retainedStoreTransaction'],True)
        for target,key,value in ((source,'retainedStoreTransaction',False),(source,'retainedStoreTransaction',1),
                (terminal,'retainedStoreTransaction',False),(terminal,'nativeProcessCalls',19)):
            with self.subTest(key=key):
                changed={**target,key:value}
                with self.assertRaises(ValueError):
                    build_execution_result(native,changed if target is source else source,self.boundary,
                        changed if target is terminal else terminal,self.admission,retained_transaction=True)

    def test_journaled_display_requires_guard_cleanup_and_matching_terminal_chronology(self):
        from scripts.build_private_ssb_capture_api import build_private_ssb_capture_api
        native={**self.native,'candidateSha256':sha256(build_private_ssb_capture_api().encode()).hexdigest()}
        source={**self.source,'retainedStoreTransaction':True,'journaledGuardedMode':True,'nativeParentLifetimeRequested':True}
        terminal={**self.terminal,'retainedStoreTransaction':True,'journaledGuardedMode':True,'nativeParentLifetimeRequested':True}
        journal={'state':'pending_held','recordedAt':self.now.isoformat(),'admissionRecorded':True,
            'finishRecorded':True,'nativeCleanupConfirmed':True,'historicalObservationOnly':True,
            'sourcePermissionIssued':False,'remoteWriteOutcomeVerified':False,'automaticRetry':False,
            'publicationEnabled':False,'nativeProcessCalls':18}
        result=build_execution_result(native,source,self.boundary,terminal,self.admission,
            retained_transaction=True,journaled_guarded=True,journal=journal)
        self.assertEqual(result['evidenceKind'],'fresh_invented_journaled_custodian_result_v4')
        self.assertTrue(result['privateJournalRecorded']);self.assertFalse(result['remoteRollbackAttested'])
        for key,value in (('nativeCleanupConfirmed',False),('state','failed_held'),('nativeProcessCalls',19),
                ('recordedAt',(self.now+timedelta(microseconds=1)).isoformat())):
            with self.subTest(key=key),self.assertRaises(ValueError):
                build_execution_result(native,source,self.boundary,terminal,self.admission,
                    retained_transaction=True,journaled_guarded=True,journal={**journal,key:value})
        with self.assertRaises(ValueError):
            build_execution_result(native,source,self.boundary,terminal,self.admission,journaled_guarded=True,journal=journal)


    def test_live_claims_or_unfinished_owned_processes_cannot_look_checked(self):
        for target,key,value in ((self.source,'actualTlsAcceptance',True),(self.source,'actualSourceRequests',False),
            (self.native,'modelCalls',False),(self.native,'publicWriterEnabled',True),
            (self.boundary,'sourcePermissionIssued',True),(self.boundary,'rawBindingReopenedAfterCommit',False),
            (self.terminal,'nativeProcessActive',True),(self.terminal,'nativeClientClosed',False),
            (self.terminal,'nativeProcessCalls',18.0),(self.terminal,'rawAttempts',True)):
            with self.subTest(key=key):
                old=target[key];target[key]=value
                with self.assertRaises(ValueError):self.snapshot()
                target[key]=old

    def test_fault_replay_changed_counts_or_unknown_order_are_held(self):
        original=deepcopy(self.faults)
        for index,target,key,value in ((0,0,'nativeWriteReplayed',True),(1,1,'nativeProcessActive',True),
            (1,1,'checkedOperations',16),(2,0,'fault',FAULT_NAMES[1]),(0,1,'storeConsumed',True)):
            self.faults=deepcopy(original);self.faults[index][target][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.snapshot()
        self.faults=deepcopy(original);self.faults[1][0]['state']['pairs']=True
        with self.assertRaises(ValueError):self.snapshot()
        self.faults=deepcopy(original);self.faults.reverse()
        with self.assertRaises(ValueError):self.snapshot()

    def test_missing_duplicate_or_malformed_witnesses_refuse(self):
        original=deepcopy(self.faults)
        for faults in ([],original[:2],original+[original[0]],[original[0]]*3,[None]*3):
            self.faults=faults
            with self.assertRaises(ValueError):self.snapshot()
        self.faults=original
        for body in (b'[]',b'\xff',b' '*16385,self.admission[:-1]+b',"schemaVersion":1}'):
            self.admission=body
            with self.assertRaises(ValueError):self.snapshot()

    def test_saved_ordering_is_dated_and_does_not_claim_current_health(self):
        self.faults[1][0]['observedAt']=self.now.isoformat()
        with self.assertRaises(ValueError):self.snapshot()
        self.faults[1][0]['observedAt']='2026-10-02T10:00:02'
        with self.assertRaises(ValueError):self.snapshot()


if __name__=='__main__':unittest.main()
