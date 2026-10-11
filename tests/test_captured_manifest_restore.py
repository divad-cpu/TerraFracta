"""Durable plan reload before existing recovery; no backend/connection authority."""
from dataclasses import replace, FrozenInstanceError
from datetime import timedelta
import json
import unittest
from uuid import UUID
from tests import test_captured_update_pipeline as pipeline_tests
from tests.test_captured_update_pipeline import plan, PUBLICATION
from tests.test_source_response_receipts import NOW
from workers.captured_update_pipeline import load_captured_manifest_checkpoint, resume_manifest_processing


class RestoreTests(unittest.TestCase):
    def captured(self):return pipeline_tests.RecoveryTests().captured()
    def load(self, data, *, work=None, invocation=None, now=NOW):
        return load_captured_manifest_checkpoint(data,invocation or plan().response.invocation,
            work or plan().response.work,now=now)
    def test_original_canonical_plan_reloads_and_existing_resume_never_opens_source(self):
        backend,manifest,raw=self.captured();loaded=self.load(raw)
        self.assertEqual(loaded.manifest,manifest);self.assertEqual(loaded.raw,raw)
        with self.assertRaises(FrozenInstanceError):loaded.raw=b'{}'
        result=resume_manifest_processing(loaded.manifest,plan().response.invocation,plan().response.work,
            loaded.raw,loaded.captured_work_claim_id,backend,utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertEqual(result.summary.run_state,'completed');self.assertEqual(backend.events,['process','close'])
    def test_original_fence_is_retained_with_independently_checked_successor(self):
        _,_,raw=self.captured();current=replace(plan().response.work,lease_id=UUID(PUBLICATION),attempt=2)
        loaded=self.load(raw,work=current)
        self.assertEqual(loaded.captured_work_claim_id,str(plan().response.work.lease_id))
        self.assertNotEqual(loaded.captured_work_claim_id,str(current.lease_id))
    def test_closed_receipt_rejects_aliases_unknown_fields_types_digests_and_foreign_fences(self):
        _,_,raw=self.captured();p=json.loads(raw)
        changes=[b'{}',raw+b' ',raw.replace(b'"schemaVersion": 1',b'"schemaVersion":1,"schemaVersion":1')]
        # Whitespace in the envelope is permitted; canonical bytes inside are not.
        self.assertEqual(self.load(changes.pop(1)).raw,raw+b' ')
        for key,value in [('schemaVersion',True),('manifestSha256','0'*64),('runId',PUBLICATION),
            ('workClaimId','bad'),('canonicalManifest',{}),('unknown','PRIVATE_CANARY')]:
            value_p={**p,key:value};changes.append(json.dumps(value_p).encode())
        for value in changes:
            with self.subTest(value=value[:30]),self.assertRaises(ValueError):self.load(value)
        with self.assertRaises(ValueError):self.load(raw.decode())
    def test_canonical_manifest_and_current_request_cannot_be_rebound(self):
        _,_,raw=self.captured();p=json.loads(raw)
        p['canonicalManifest']=p['canonicalManifest'].replace('fictional-item','different-item')
        with self.assertRaises(ValueError):self.load(json.dumps(p).encode())
        with self.assertRaises(ValueError):self.load(raw,invocation=replace(plan().response.invocation,mode='publish_eligible'))
        with self.assertRaises(ValueError):self.load(raw,work=replace(plan().response.work,run_id=UUID(PUBLICATION)))
    def test_expired_future_and_held_current_leases_cannot_restore_execution(self):
        _,_,raw=self.captured();work=plan().response.work
        for value in [replace(work,status='finished'),replace(work,lease_id=None),replace(work,observed_at=NOW+timedelta(seconds=1)),
            replace(work,lease_expires_at=NOW),replace(work,deadline_at=NOW)]:
            with self.subTest(work=value),self.assertRaises(ValueError):self.load(raw,work=value)
        with self.assertRaises(ValueError):self.load(raw,now=NOW+timedelta(seconds=30))
        with self.assertRaises(ValueError):self.load(raw,now=NOW.replace(tzinfo=None))

if __name__=='__main__':unittest.main()
