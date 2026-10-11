"""Invented saved recovery projections cannot upgrade historical evidence."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
import json
import unittest

from scripts.export_private_recovery_snapshot import build_recovery_snapshot,STATES


class PrivateRecoveryExportTests(unittest.TestCase):
    def setUp(self):
        now=datetime(2026,10,2,11,28,tzinfo=timezone.utc)
        cases=[]
        for index,state in enumerate(STATES):
            cases.append({'schemaVersion':1,'evidenceKind':'read_only_private_attempt_recovery',
                'observedAt':(now-timedelta(seconds=2)).isoformat(),'state':state,
                'retainedRawPairs':int(index>0),'rawIntegrityChecked':index>0,'nativeCloseoutPresent':index>1,
                'readingChargeBytes':65537 if index==0 else 1924,'historicalAdmissionOnly':True,
                'currentAdmissionIssued':False,'sourceOriginVerified':False,'automaticRetry':False,
                'repairPerformed':False,'checkpointAdvanced':False,'publicationEnabled':False})
        self.value={'evidenceKind':'actual_read_only_retained_private_attempt_recovery',
            'observedAt':now.isoformat(),'cases':cases,'runtimeAccountsStayedRetired':True,'ownedCloneStopped':True,
            'primaryChanged':False,'sourceRequests':0,'writeReplayed':False,'newAccountCreated':False,
            'rawDeletionPerformed':False,'publicationEnabled':False,'historicalAdmissionIssuedCurrentPermission':False}

    def test_closed_dated_projection_excludes_all_additional_private_top_level_values(self):
        self.value['privateEvidenceDirectory']='/private-canary';self.value['rawBody']='private-canary'
        result=build_recovery_snapshot(self.value)
        self.assertEqual(len(result['cases']),4);self.assertTrue(result['historicalAdmissionOnly'])
        self.assertFalse(result['liveStatus']);self.assertNotIn('private-canary',json.dumps(result))
        self.assertNotIn('readingChargeBytes',json.dumps(result))

    def test_native_source_account_replay_and_current_admission_claims_cannot_be_projected(self):
        for key,value in (('sourceRequests',True),('sourceRequests',1),('ownedCloneStopped',False),
                ('runtimeAccountsStayedRetired',False),('writeReplayed',True),('publicationEnabled',True),
                ('historicalAdmissionIssuedCurrentPermission',True)):
            changed=deepcopy(self.value);changed[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):build_recovery_snapshot(changed)

    def test_missing_mixed_corrupt_or_undated_recovery_remains_held(self):
        for index,key,value in ((0,'retainedRawPairs',True),(1,'nativeCloseoutPresent',True),
                (2,'rawIntegrityChecked',False),(3,'currentAdmissionIssued',True),
                (0,'observedAt','2026-10-02T11:28:01Z'),(1,'observedAt','2026-10-02T10:00:00Z'),
                (2,'rawBody','private-canary')):
            changed=deepcopy(self.value);changed['cases'][index][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):build_recovery_snapshot(changed)
        for cases in ([],self.value['cases'][:3],self.value['cases'][::-1]):
            with self.assertRaises(ValueError):build_recovery_snapshot({**self.value,'cases':cases})


if __name__=='__main__':unittest.main()
