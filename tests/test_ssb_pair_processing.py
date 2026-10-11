from dataclasses import replace
from hashlib import sha256
import json
import unittest

from tests import test_reserved_ssb_capture as support
from tests.test_source_response_receipts import NOW
from workers.ssb_pair_processing import process_reserved_ssb_pair,require_pending_pair_checkpoint
from workers.ssb_14059_context_manifest import build_ssb_context_manifest
from workers.update_run_completion import canonical_run_manifest,reconcile_run_completion
from workers.update_run_closeout import completion_summary_payload

META='66666666-6666-4666-8666-666666666666'
DATA='77777777-7777-4777-8777-777777777777'
PAIR='88888888-8888-4888-8888-888888888888'
contexts=support.contexts


def checkpoint(context):
    canonical=canonical_run_manifest(context.manifest)
    return {'schemaVersion':1,'runId':context.manifest.run_id,'workClaimId':str(contexts()[0].work.lease_id),
        'canonicalManifest':canonical,'manifestSha256':sha256(canonical.encode('ascii')).hexdigest(),
        'pairId':PAIR,'validationState':'pending','metadataVersionId':META,'dataVersionId':DATA}


class Backend:
    def __init__(self):self.events=[];self.alter=None;self.close_alter=None;self.fail_store=False
    def store_pair(self,context,metadata,data):
        self.events.append('store_and_reopen')
        if self.fail_store:raise ValueError('Synthetic ambiguous commit; recovery required')
        payload=checkpoint(context)
        if self.alter:self.alter(payload)
        return json.dumps(payload).encode()
    def close_pair(self,context):
        self.events.append('close_and_reopen')
        expected=reconcile_run_completion(context.manifest,(),(),(),now=NOW)
        p={'schemaVersion':1,'status':'existing_closeout','runId':context.manifest.run_id,
            'workClaimId':str(contexts()[0].work.lease_id),'requestFingerprint':context.manifest.request_fingerprint,
            'manifestSha256':expected.manifest_sha256,'finishedAt':NOW.isoformat(),
            'summary':completion_summary_payload(expected)}
        if self.close_alter:self.close_alter(p)
        return json.dumps(p).encode()


class PairProcessingTests(unittest.TestCase):
    def setUp(self):self.capture=support.ReservedSSBTests();self.capture.setUp();self.backend=Backend()
    def process(self,**options):
        return process_reserved_ssb_pair(*options.pop('requests',contexts()),
            *options.pop('versions',(META,DATA)),options.pop('pair',PAIR),
            self.capture.factory,self.capture.fetch,self.backend,
            utc_now=lambda:NOW,monotonic=lambda:self.capture.ticks,**options)
    def test_both_captures_are_bound_to_one_pending_committed_pair_and_partial_closeout(self):
        result=self.process()
        self.assertEqual(self.backend.events,['store_and_reopen','close_and_reopen'])
        self.assertEqual(result.pair_id,PAIR)
        self.assertEqual(result.closeout.summary.run_state,'partial')
        self.assertEqual(result.closeout.summary.decided_items,0)
        self.assertEqual(result.closeout.summary.committed_publication_ids,())
        self.assertEqual(result.closeout.summary.visibility_state,'not_required')
        self.assertEqual([event for event in self.capture.events if event[1]=='fetch'],[('metadata','fetch'),('data','fetch')])
    def test_invalid_config_and_publication_mode_refuse_before_any_reservation(self):
        for options in ({'pair':'bad'},{'versions':(META,META)},{'versions':('bad',DATA)},
            {'requests':tuple(replace(c,invocation=replace(c.invocation,mode='publish_eligible')) for c in contexts())}):
            with self.subTest(options=options),self.assertRaises(ValueError):self.process(**options)
        self.assertEqual(self.capture.events,[]);self.assertEqual(self.backend.events,[])
    def test_changed_pair_fence_versions_plan_or_usable_status_never_closes(self):
        for field,value in (('pairId',META),('runId',PAIR),('workClaimId',PAIR),('metadataVersionId',DATA),
            ('dataVersionId',META),('canonicalManifest','{}'),('manifestSha256','a'*64),
            ('validationState','usable'),('schemaVersion',True),('privateSource','canary')):
            self.setUp();self.backend.alter=lambda p,f=field,v=value:p.update({f:v})
            with self.subTest(field=field),self.assertRaises(ValueError):self.process()
            self.assertEqual(self.backend.events,['store_and_reopen'])
    def test_ambiguous_pair_commit_has_no_automatic_refetch_or_close(self):
        self.backend.fail_store=True
        with self.assertRaises(ValueError):self.process()
        self.assertEqual(self.backend.events,['store_and_reopen'])
        self.assertEqual(len([e for e in self.capture.events if e[1]=='fetch']),2)
        # A caller retry hits the existing metadata dispatch and stops before
        # opening either response again or repeating the ambiguous store.
        with self.assertRaises(ValueError):self.process()
        self.assertEqual(self.backend.events,['store_and_reopen'])
        self.assertEqual(len([e for e in self.capture.events if e[1]=='fetch']),2)
    def test_closeout_cannot_claim_completed_work_or_verified_website(self):
        for field,value in (('runState','completed'),('decidedItems',3),('visibilityState','verified')):
            self.setUp();self.backend.close_alter=lambda p,f=field,v=value:p['summary'].update({f:v})
            with self.subTest(field=field),self.assertRaises(ValueError):self.process()


class PairCheckpointTests(unittest.TestCase):
    def setUp(self):
        capture=support.ReservedSSBTests();capture.setUp();m,d=capture.pair()
        self.context=build_ssb_context_manifest(*contexts(),m,d,META,DATA)
        self.bytes=json.dumps(checkpoint(self.context)).encode()
    def test_duplicate_keys_private_fields_bad_encoding_and_oversize_refuse(self):
        for data in (b'{"pairId":"'+PAIR.encode()+b'",'+self.bytes[1:],b'\xff',b'[]',b' '*32769,
            self.bytes[:-1]+b',"privateNote":"canary"}'):
            with self.subTest(data_length=len(data)),self.assertRaises(ValueError):
                require_pending_pair_checkpoint(data,self.context,PAIR,str(contexts()[0].work.lease_id))
    def test_source_manifest_can_never_be_substituted_for_a_one_context_plan(self):
        forged=replace(self.context,manifest=replace(self.context.manifest,sources=self.context.manifest.sources[:1]))
        with self.assertRaises(ValueError):require_pending_pair_checkpoint(self.bytes,forged,PAIR,str(contexts()[0].work.lease_id))


if __name__=='__main__':unittest.main()
