"""Private filesystem/receipt faults with invented native replies and no source."""
import base64
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from tests.frozen_ssb_support import admitted_context, invented_bodies
from tests.test_native_pair_admission import admission_fixture
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.private_pair_native_sql import PRIVATE_SCHEMA
from workers.ssb_14059_raw_custody import PrivateRawCustody


class PrivateNativeBackendTests(unittest.TestCase):
    def setUp(self):
        self.temporary=TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.now=datetime(2026,10,2,10,tzinfo=timezone.utc);self.pin='a'*64
        self.raw_context,self.expected=admitted_context(self.pin,now=self.now)
        self.custody=self.enterContext(PrivateRawCustody(Path(self.temporary.name)/'raw',utc_now=lambda:self.now))
        self.calls=[];self.transform=lambda sql,response:response
        self.backend=PrivatePairNativeBackend(self.client,self.custody,self.raw_context,self.pin,
            utc_now=lambda:self.now)
        self.bodies=invented_bodies()
        self.arguments={kind:base64.b64encode(body).decode() for kind,body in self.bodies.items()}
        self.arguments.update(metadataRetrievedAt=self.now.isoformat(),dataRetrievedAt=self.now.isoformat(),manifest='{}')

    def binding(self):
        e=self.backend.raw_expected
        return {'schemaVersion':1,'pairId':self.expected['pair_id'],'rawAttemptId':e.attempt_id,
            'metadataSha256':e.metadata_sha256,'dataSha256':e.data_sha256,'storedAt':e.stored_at.isoformat(),
            'expiresAt':e.expires_at.isoformat(),'metadataRetrievedAt':e.metadata_retrieved_at.isoformat(),
            'dataRetrievedAt':e.data_retrieved_at.isoformat(),
            'metadataVersionId':self.expected['versions']['metadata'],'dataVersionId':self.expected['versions']['data']}

    def client(self,sql):
        self.calls.append(sql)
        self.assertIn('select '+PRIVATE_SCHEMA+'.',sql)
        if sql.endswith(('.read_admitted_context();','.read_retention_context();')):
            value=admission_fixture(self.raw_context,self.pin,self.now)
        elif sql.endswith('.read_raw_pair_binding();'):value=self.binding()
        elif '.store_pair(' in sql:value={'stored':True,'status':'created'}
        else:value={'invented':True}
        return self.transform(sql,SimpleNamespace(returncode=0,stdout=json.dumps(value),stderr=''))

    def store(self):return self.backend.execute_once('store_pair',self.arguments)

    def assert_preserved_once(self):
        entries=self.custody.inventory(now=self.now)
        self.assertEqual(len(entries),1)
        attempt=entries[0].attempt_id
        self.assertEqual((self.custody.root/attempt/'metadata.json').read_bytes(),self.bodies['metadata'])
        self.assertEqual((self.custody.root/attempt/'data.json').read_bytes(),self.bodies['data'])
        self.assertTrue(self.backend.store_consumed)
        self.assertTrue(self.backend.closed)
        previous=list(self.calls)
        with self.assertRaises(ValueError):self.store()
        self.assertEqual(self.calls,previous)
        self.assertEqual(len(self.custody.inventory(now=self.now)),1)

    def test_no_operation_before_admission_and_no_repeated_admission(self):
        with self.assertRaises(ValueError):self.backend.execute_once('reserve_response',{'kind':'metadata'})
        self.assertEqual(self.calls,[])
        with self.assertRaises(ValueError):self.backend.confirm_admission()
        self.assertEqual(self.calls,[])

    def test_bad_local_inventory_pin_refuses_before_any_native_query(self):
        for pin in (None,True,'A'*64,'a'*63,'b'*64):
            with self.subTest(pin_type=type(pin).__name__),self.assertRaises(ValueError):
                PrivatePairNativeBackend(self.client,self.custody,self.raw_context,pin,utc_now=lambda:self.now)
        self.assertEqual(self.calls,[])

    def test_native_admission_once_then_exact_fsync_pair_and_post_commit_readback(self):
        self.backend.confirm_admission()
        with self.assertRaises(ValueError):self.backend.confirm_admission()
        self.assertFalse(self.backend.closed)
        result=json.loads(self.store())
        self.assertEqual(result,{'stored':True,'status':'created'})
        self.assertEqual(len(self.calls),4)
        self.assertTrue(self.calls[-1].endswith('.read_raw_pair_binding();'))
        e=self.backend.raw_expected
        self.assertTrue(self.calls[1].endswith('.read_retention_context();'))
        self.assertIn("'"+e.attempt_id+"'",self.calls[2])
        self.assertIn("'"+e.stored_at.isoformat()+"'",self.calls[2])
        self.assertEqual(self.backend.raw_reconciliation[0].state,'matched')
        self.assertEqual(self.backend.raw_reconciliation[0].issues,())
        self.assertEqual(self.custody.read(e.attempt_id,now=self.now).data_response.body,self.bodies['data'])
        with self.assertRaises(ValueError):self.store()
        self.assert_preserved_once()

    def test_existing_orphan_attempt_prevents_native_admission_without_erasing_it(self):
        from workers.ssb_14059_capture import CapturedResponse,METADATA_URL,DATA_URL
        responses=tuple(CapturedResponse(url,url,0,200,'application/json',self.bodies[kind],self.now)
            for kind,url in (('metadata',METADATA_URL),('data',DATA_URL)))
        saved=self.custody.store(*responses,now=self.now)
        with self.assertRaises(ValueError):self.backend.confirm_admission()
        self.assertEqual(self.calls,[])
        self.assertEqual(self.custody.read(saved.attempt_id,now=self.now).data_response,responses[1])

    def test_wrong_native_actor_or_expired_admission_prevents_raw_storage(self):
        def changed(sql,response):
            value=json.loads(response.stdout);value['principal']='another_actor'
            return SimpleNamespace(returncode=0,stdout=json.dumps(value),stderr='')
        self.transform=changed
        with self.assertRaises(ValueError):self.backend.confirm_admission()
        self.assertEqual(len(self.calls),1);self.assertEqual(self.custody.inventory(now=self.now),())
        self.assertFalse(self.backend.store_consumed)

    def test_expiry_stops_before_native_or_filesystem_write(self):
        self.backend.confirm_admission();self.now+=timedelta(seconds=30)
        with self.assertRaises(ValueError):self.store()
        self.assertEqual(len(self.calls),1);self.assertEqual(self.custody.inventory(now=self.now),())
        self.assertFalse(self.backend.store_consumed)

    def test_worker_sql_and_root_selectors_stop_before_native_or_filesystem_write(self):
        for operation,arguments in (('sql',{'text':'select 1'}),
                ('store_pair',{**self.arguments,'rawPath':'/invented/private'})):
            with self.subTest(operation=operation):
                backend=PrivatePairNativeBackend(self.client,self.custody,self.raw_context,self.pin,utc_now=lambda:self.now)
                backend.confirm_admission();before=len(self.calls)
                with self.assertRaises(ValueError):backend.execute_once(operation,arguments)
                self.assertEqual(len(self.calls),before);self.assertTrue(backend.closed)
                self.assertFalse(backend.store_consumed)
                self.assertEqual(self.custody.inventory(now=self.now),())

    def test_native_store_rejection_retains_fsynced_pair_without_retry(self):
        self.backend.confirm_admission()
        self.transform=lambda sql,r:SimpleNamespace(returncode=17,stdout='',stderr='private-diagnostic-canary') if '.store_pair(' in sql else r
        with self.assertRaises(ValueError) as error:self.store()
        self.assertNotIn('canary',str(error.exception))
        self.assertEqual(len(self.calls),3);self.assertIsNone(self.backend.raw_binding_receipt)
        self.assert_preserved_once()

    def test_lost_binding_reply_after_possible_commit_retains_the_original_pair(self):
        self.backend.confirm_admission()
        def changed(sql,response):
            if sql.endswith('.read_raw_pair_binding();'):raise TimeoutError('private-body-canary')
            return response
        self.transform=changed
        with self.assertRaises(ValueError) as error:self.store()
        self.assertNotIn('canary',str(error.exception));self.assertEqual(len(self.calls),4)
        self.assert_preserved_once()

    def test_withdrawn_retention_refuses_before_raw_saving_and_cannot_retry(self):
        self.backend.confirm_admission()
        self.transform=lambda sql,r:SimpleNamespace(returncode=1,stdout='',stderr='private-rights-canary')
        with self.assertRaises(ValueError) as error:self.store()
        self.assertNotIn('canary',str(error.exception))
        self.assertEqual(len(self.calls),2)
        self.assertTrue(self.calls[-1].endswith('.read_retention_context();'))
        self.assertEqual(self.custody.inventory(now=self.now),())
        self.assertTrue(self.backend.store_consumed);self.assertTrue(self.backend.closed)
        with self.assertRaises(ValueError):self.store()
        self.assertEqual(len(self.calls),2)

    def test_changed_pre_save_identity_is_withheld_before_filesystem_write(self):
        self.backend.confirm_admission()
        def changed(sql,response):
            value=json.loads(response.stdout);value['pairId']='ffffffff-ffff-4fff-8fff-ffffffffffff'
            response.stdout=json.dumps(value);return response
        self.transform=changed
        with self.assertRaises(ValueError):self.store()
        self.assertEqual(self.custody.inventory(now=self.now),())
        self.assertEqual(len(self.calls),2);self.assertTrue(self.backend.closed)

    def test_clock_expiry_during_pre_save_read_stops_before_raw_write(self):
        self.backend.confirm_admission()
        def changed(sql,response):
            self.now+=timedelta(seconds=31);return response
        self.transform=changed
        with self.assertRaises(ValueError):self.store()
        self.assertEqual(self.custody.inventory(now=self.now),())
        self.assertEqual(len(self.calls),2);self.assertTrue(self.backend.closed)

    def test_changed_raw_native_binding_is_held_even_after_store_acknowledgment(self):
        self.backend.confirm_admission()
        def changed(sql,response):
            if sql.endswith('.read_raw_pair_binding();'):
                value=json.loads(response.stdout);value['metadataSha256']='0'*64
                response.stdout=json.dumps(value)
            return response
        self.transform=changed
        with self.assertRaises(ValueError):self.store()
        self.assertIsNone(self.backend.raw_binding_receipt)
        self.assert_preserved_once()

    def test_file_change_after_native_commit_is_detected_without_compensation(self):
        self.backend.confirm_admission()
        def changed(sql,response):
            if sql.endswith('.read_raw_pair_binding();'):
                e=self.backend.raw_expected
                (self.custody.root/e.attempt_id/'data.json').write_bytes(b'{"retained":"changed"}')
            return response
        self.transform=changed
        with self.assertRaises(ValueError):self.store()
        attempt=self.backend.raw_expected.attempt_id
        self.assertEqual((self.custody.root/attempt/'data.json').read_bytes(),b'{"retained":"changed"}')
        self.assertTrue(self.backend.closed);self.assertIsNone(self.backend.raw_binding_receipt)
        self.assertEqual(len(list(self.custody.root.iterdir())),1)

    def test_unbounded_or_invalid_native_receipt_is_generic_and_terminal(self):
        for stdout in ('x'*32769,'\ud800'):
            self.backend=PrivatePairNativeBackend(self.client,self.custody,self.raw_context,self.pin,utc_now=lambda:self.now)
            self.transform=lambda sql,r:SimpleNamespace(returncode=0,stdout=stdout,stderr='private-canary')
            with self.assertRaises(ValueError) as error:self.backend.confirm_admission()
            self.assertNotIn('canary',str(error.exception));self.assertTrue(self.backend.closed)


if __name__=='__main__':unittest.main()
