"""Read-only recovery from invented native witnesses and private temporary raw files."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tests.frozen_ssb_support import admitted_context,invented_bodies
from tests.test_native_pair_admission import admission_fixture
from workers.private_attempt_recovery import historical_admission,classify_private_attempt_recovery
from workers.private_recovery_sql import private_recovery_snapshot_sql
from workers.ssb_14059_capture import CapturedResponse,METADATA_URL,DATA_URL
from workers.ssb_14059_raw_custody import PrivateRawCustody
from workers.update_run_completion import (RunManifest,PlannedSource,PlannedItem,
    canonical_run_manifest,reconcile_run_completion)
from workers.update_run_closeout import completion_summary_payload


class PrivateAttemptRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.start=datetime(2026,10,2,10,tzinfo=timezone.utc);self.now=self.start+timedelta(seconds=40)
        context,self.expected=admitted_context('a'*64,now=self.start)
        self.admission=admission_fixture(context,'a'*64,self.start)
        self.admission_raw=json.dumps(self.admission).encode()
        self.custody=self.enterContext(PrivateRawCustody(Path(self.temp.name)/'raw',utc_now=lambda:self.now))
        self.bodies=invented_bodies();self.stored_at=self.start+timedelta(seconds=1)
        responses=tuple(CapturedResponse(url,url,0,200,'application/json',self.bodies[kind],self.stored_at)
            for kind,url in (('metadata',METADATA_URL),('data',DATA_URL)))
        self.saved=self.custody.store(*responses,now=self.stored_at)
        self.value=self.snapshot()

    def snapshot(self):
        a=self.admission;e=self.expected;s=self.saved
        request_hash=sha256(a['canonicalRequest'].encode()).hexdigest()
        sources=tuple(PlannedSource('ssb-14059-'+kind,e[kind].registration_id,e['versions'][kind],
            sha256(self.bodies[kind]).hexdigest()) for kind in ('metadata','data'))
        manifest=RunManifest(a['runId'],request_hash,'shadow',sources,tuple(
            PlannedItem(key,source,e['versions'][kind]) for key,source,kind in (
                ('ssb-14059-year-2024','ssb-14059-data','data'),
                ('ssb-14059-year-2025','ssb-14059-data','data'),
                ('ssb-14059-metadata-review','ssb-14059-metadata','metadata'))))
        canonical=canonical_run_manifest(manifest);digest=sha256(canonical.encode()).hexdigest()
        binding={'schemaVersion':1,'pairId':a['pairId'],'rawAttemptId':s.attempt_id,
            'metadataSha256':sha256(self.bodies['metadata']).hexdigest(),
            'dataSha256':sha256(self.bodies['data']).hexdigest(),
            'storedAt':self.stored_at.isoformat(),'expiresAt':s.expires_at.isoformat(),
            'metadataRetrievedAt':self.stored_at.isoformat(),'dataRetrievedAt':self.stored_at.isoformat(),
            'metadataVersionId':e['versions']['metadata'],'dataVersionId':e['versions']['data']}
        return {'schemaVersion':1,'observedAt':self.now.isoformat(),'runId':a['runId'],
            'workClaimId':a['workClaimId'],'pairId':a['pairId'],'canonicalRequest':a['canonicalRequest'],
            'codeVersion':'ssb-sha256:'+'a'*64,'requestFingerprint':request_hash,
            'counts':{'reservations':2,'dispatches':2,'settlements':2,
                'chargedBytes':sum(map(len,self.bodies.values())),'versions':2,'pairs':1,'checks':2,
                'manifests':1,'rawArtifacts':1,'closeouts':1,'checkpoints':0,'usablePairs':0,'publications':0},
            'checkpoint':{'schemaVersion':1,'runId':a['runId'],'workClaimId':a['workClaimId'],
                'canonicalManifest':canonical,'manifestSha256':digest,'pairId':a['pairId'],
                'validationState':'pending','metadataVersionId':e['versions']['metadata'],
                'dataVersionId':e['versions']['data']},'rawBinding':binding,
            'closeout':{'schemaVersion':1,'status':'existing_closeout','runId':a['runId'],
                'requestFingerprint':request_hash,'workClaimId':a['workClaimId'],'manifestSha256':digest,
                'finishedAt':(self.start+timedelta(seconds=2)).isoformat(),
                'summary':completion_summary_payload(reconcile_run_completion(manifest,(),(),(),now=self.now))},
            'sourceVersions':sorted(({'id':s.source_version_id,'registrationId':s.registration_id,
                'contentSha256':s.content_sha256} for s in sources),key=lambda row:row['id'])}

    def recover(self,value=None,now=None):
        return classify_private_attempt_recovery(self.admission_raw,
            json.dumps(self.value if value is None else value).encode(),self.custody,now=self.now if now is None else now)

    def test_expired_admission_is_historical_only_and_never_reauthorizes_a_run(self):
        parsed,_=historical_admission(self.admission_raw)
        self.assertLess(parsed.expires_at,self.now)
        result=self.recover();self.assertEqual(result['state'],'stored_pending_closeout_confirmed')
        self.assertTrue(result['rawIntegrityChecked']);self.assertTrue(result['historicalAdmissionOnly'])
        for key in ('currentAdmissionIssued','sourceOriginVerified','automaticRetry','repairPerformed',
                'checkpointAdvanced','publicationEnabled'):self.assertIs(result[key],False)
        for private in (self.saved.attempt_id,self.admission['runId'],self.admission['principal'],'canonicalManifest'):
            self.assertNotIn(private,json.dumps(result))

    def test_committed_store_without_closeout_is_reported_without_replay(self):
        self.value['closeout']=None;self.value['counts']['closeouts']=0
        result=self.recover();self.assertEqual(result['state'],'stored_pending_closeout_unconfirmed')
        self.assertFalse(result['nativeCloseoutPresent'])
        self.assertEqual(self.custody.attempt_names(),(self.saved.attempt_id,))

    def incomplete(self):
        value=deepcopy(self.value)
        value.update(checkpoint=None,rawBinding=None,closeout=None,sourceVersions=[])
        value['counts'].update(reservations=1,dispatches=1,settlements=0,chargedBytes=65537,
            versions=0,pairs=0,checks=0,manifests=0,rawArtifacts=0,closeouts=0)
        return value

    def test_incomplete_orphan_inventory_does_not_open_payloads(self):
        with patch.object(PrivateRawCustody,'read',side_effect=AssertionError('payload opened')):
            result=self.recover(self.incomplete())
        self.assertEqual(result['state'],'orphan_requires_inspection');self.assertFalse(result['rawIntegrityChecked'])
        empty=self.enterContext(PrivateRawCustody(Path(self.temp.name)/'empty',utc_now=lambda:self.now))
        with patch.object(PrivateRawCustody,'read',side_effect=AssertionError('payload opened')):
            result=classify_private_attempt_recovery(self.admission_raw,json.dumps(self.incomplete()).encode(),empty,now=self.now)
        self.assertEqual(result['state'],'incomplete_before_private_store')

    def test_expired_raw_binding_suppresses_payload_access(self):
        later=self.saved.expires_at;self.value['observedAt']=later.isoformat()
        with patch.object(PrivateRawCustody,'read',side_effect=AssertionError('expired payload opened')):
            result=self.recover(now=later)
        self.assertEqual(result['state'],'expired_access_held');self.assertFalse(result['rawIntegrityChecked'])
        self.assertTrue((self.custody.root/self.saved.attempt_id/'data.json').exists())

    def test_changed_local_storage_time_cannot_claim_integrity_or_repair_native_binding(self):
        path=self.saved.directory/'manifest.json';original=path.read_bytes()
        manifest=json.loads(original)
        # Chronology stays valid and the raw bodies/hashes are unchanged. The
        # independent native record, rather than local plausibility, must bind
        # the exact storage time.
        manifest['stored_at']=(self.stored_at+timedelta(seconds=1)).isoformat()
        changed=json.dumps(manifest).encode();path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError,'^Private recovery snapshot is inconsistent or unavailable$'):
            self.recover()
        self.assertEqual(path.read_bytes(),changed)
        self.assertEqual(self.value['rawBinding']['storedAt'],self.stored_at.isoformat())

    def test_valid_local_storage_time_is_preserved_in_custody_receipt(self):
        retained=self.custody.read(self.saved.attempt_id,now=self.now)
        self.assertEqual(retained.stored_at,self.stored_at)
        self.assertTrue(self.recover()['rawIntegrityChecked'])

    def test_native_identity_time_and_permission_substitution_are_rejected(self):
        for key,value in (('runId',self.admission['pairId']),('codeVersion','ssb-sha256:'+'b'*64),
                ('requestFingerprint','b'*64),('schemaVersion',True),
                ('observedAt',(self.now+timedelta(seconds=1)).isoformat()),
                ('observedAt',(self.now-timedelta(seconds=4)).isoformat()),('canonicalRequest','{}')):
            changed=deepcopy(self.value);changed[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.recover(changed)
        for key in ('publications','checkpoints','usablePairs'):
            changed=deepcopy(self.value);changed['counts'][key]=1
            with self.assertRaises(ValueError):self.recover(changed)
        with self.assertRaises(ValueError):self.recover(now=self.now.replace(tzinfo=None))

    def test_native_hashes_manifest_and_counters_cannot_be_reconstructed_from_claims(self):
        for key,value in (('chargedBytes',1),('reservations',True),('versions',1),('closeouts',0)):
            changed=deepcopy(self.value);changed['counts'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.recover(changed)
        changed=deepcopy(self.value);changed['sourceVersions'][0]['contentSha256']='b'*64
        with self.assertRaises(ValueError):self.recover(changed)
        changed=deepcopy(self.value);changed['checkpoint']['manifestSha256']='b'*64
        with self.assertRaises(ValueError):self.recover(changed)
        changed=deepcopy(self.value);changed['closeout']['summary']['decidedItems']=1
        with self.assertRaises(ValueError):self.recover(changed)

    def test_additional_raw_namespace_and_changed_raw_bytes_are_held_and_preserved(self):
        orphan=self.custody.root/('.pending-'+'b'*32);orphan.mkdir(mode=0o700)
        result=self.recover();self.assertEqual(result['state'],'raw_namespace_inconsistent')
        self.assertTrue(orphan.exists());self.assertFalse(result['rawIntegrityChecked'])
        # Use a separate single-attempt custody to check corruption without removing evidence.
        original=self.custody;self.custody=self.enterContext(PrivateRawCustody(Path(self.temp.name)/'tampered',utc_now=lambda:self.now))
        responses=tuple(CapturedResponse(url,url,0,200,'application/json',self.bodies[kind],self.stored_at)
            for kind,url in (('metadata',METADATA_URL),('data',DATA_URL)))
        saved=self.custody.store(*responses,now=self.stored_at)
        self.value['rawBinding']['rawAttemptId']=saved.attempt_id
        path=self.custody.root/saved.attempt_id/'data.json';path.write_bytes(b'{}')
        result=self.recover();self.assertEqual(result['state'],'raw_pair_unavailable')
        self.assertEqual(path.read_bytes(),b'{}');self.custody=original

    def test_recovery_sql_is_one_fixed_read_only_transaction_without_runtime_calls(self):
        sql=private_recovery_snapshot_sql(self.admission_raw)
        self.assertTrue(sql.startswith('begin isolation level repeatable read read only;'))
        self.assertTrue(sql.endswith('rollback;\n'))
        for text in ('grant ','insert ','update ','delete ','read_admitted_context','store_pair','terra_ssb_private_capture_api'):
            self.assertNotIn(text,sql.lower())
        self.assertIn('join terra_private.source_response_reservations z',sql)
        self.assertIn(self.admission['runId'],sql)


if __name__=='__main__':unittest.main()
