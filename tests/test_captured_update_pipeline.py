"""Whole-operation ordering, expected work, readback tampering and failures."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import io
import json
import unittest

from tests.test_source_response_receipts import NOW, context
from tests.test_reserved_response_capture import FakeCommittedBackend
from workers.captured_update_pipeline import (CapturePlan, PipelineResumeRequired, StoredProcessing,
    execute_captured_update, require_capture_checkpoint, resume_manifest_processing)
from workers.update_run_completion import (DecisionReceipt, ActivationReceipt, PlannedItem,
    canonical_run_manifest, reconcile_run_completion)
from workers.update_run_closeout import completion_summary_payload

VERSION = '77777777-7777-4777-8777-777777777777'
DECISION = '88888888-8888-4888-8888-888888888888'
PUBLICATION = '99999999-9999-4999-8999-999999999999'


def plan():
    return CapturePlan('fictional-source', context(), VERSION, ('fictional-item',))


def encoded(p): return json.dumps(p).encode()


class FakePipeline:
    def __init__(self):
        self.events = []; self.response = FakeCommittedBackend()
        self.capture_changes = {}; self.manifest_changes = {}; self.close_changes = {}
        self.items = None; self.clock = lambda: NOW; self.elapsed = [0]
        self.fail_stage = None; self.delay_stage = None
        self.processing = StoredProcessing((DecisionReceipt(DECISION, 'fictional-item', VERSION, 'held'),), ())

    def stage(self, stage):
        self.events.append(stage)
        if self.fail_stage == stage: raise RuntimeError('invented private failure')
        if self.delay_stage == stage: self.elapsed[0] = 31

    def response_backend(self, plan): return self.response
    def opener(self, plan):
        def open_body(endpoint, seconds):
            self.stage('open'); return io.BytesIO(b'abc')
        return open_body

    def store_capture(self, plan, capture):
        self.stage('capture-check')
        return encoded({'schemaVersion':1, 'runId':str(plan.response.work.run_id),
            'workClaimId':str(plan.response.work.lease_id), 'registrationId':plan.response.registration_id,
            'sourceKey':plan.source_key, 'sourceVersionId':VERSION, 'outcome':'captured',
            'contentSha256':sha256(capture.body).hexdigest(), 'totalResponseBytes':len(capture.body),
            'checkedAt':NOW.isoformat(), **self.capture_changes})

    def extract_items(self, plan, capture):
        self.stage('extract')
        return self.items if self.items is not None else (PlannedItem('fictional-item', plan.source_key, VERSION),)

    def store_manifest(self, manifest, work):
        self.stage('manifest'); self.manifest = manifest
        canonical = canonical_run_manifest(manifest)
        return encoded({'schemaVersion':1, 'runId':manifest.run_id, 'workClaimId':str(work.lease_id),
            'canonicalManifest':canonical, 'manifestSha256':sha256(canonical.encode()).hexdigest(), **self.manifest_changes})

    def process(self, manifest, work): self.stage('process'); return self.processing
    def close(self, manifest, work):
        self.stage('close')
        expected = reconcile_run_completion(manifest, self.processing.decisions, self.processing.activations, (), now=NOW)
        return encoded({'schemaVersion':1, 'status':'closed', 'runId':manifest.run_id,
            'requestFingerprint':manifest.request_fingerprint, 'workClaimId':str(work.lease_id),
            'manifestSha256':expected.manifest_sha256, 'finishedAt':NOW.isoformat(),
            'summary':completion_summary_payload(expected), **self.close_changes})


def run(backend, plans=None):
    return execute_captured_update(plans if plans is not None else (plan(),), backend,
        utc_now=backend.clock, monotonic=lambda:backend.elapsed[0])


class PipelineTests(unittest.TestCase):
    def test_checked_capture_precedes_exact_manifest_decision_and_closeout(self):
        backend = FakePipeline(); result = run(backend)
        self.assertEqual(backend.events, ['open','capture-check','extract','manifest','process','close'])
        self.assertEqual(result.summary.run_state, 'completed')
        self.assertEqual(result.summary.held_items, 1)
        self.assertEqual(result.summary.committed_publication_ids, ())
        self.assertEqual(backend.manifest.sources[0].content_sha256, sha256(b'abc').hexdigest())

    def test_missing_decision_is_closed_partial_without_inventing_a_hold(self):
        backend = FakePipeline(); backend.processing = StoredProcessing((), ())
        result = run(backend)
        self.assertEqual(result.summary.run_state, 'partial')
        self.assertEqual(result.summary.pending_item_keys, ('fictional-item',))
        self.assertEqual(result.summary.held_items, 0)

    def test_committed_fact_remains_pending_independent_website_visibility(self):
        backend = FakePipeline(); backend.processing = StoredProcessing(
            (DecisionReceipt(DECISION,'fictional-item',VERSION,'eligible'),),
            (ActivationReceipt(PUBLICATION,DECISION,'b'*64,NOW),))
        # Only an eligible-mode admitted request may consume an activation.
        p = plan(); p = replace(p,response=replace(p.response,invocation=replace(p.response.invocation,mode='publish_eligible')))
        # Fake response receipts use the original fingerprint; use their exact
        # binding helper instead of weakening the production parser.
        from tests.test_source_response_receipts import reservation_payload, dispatch_payload, settlement_payload
        from workers.update_request_identity import identify_update_request
        fp = identify_update_request(p.response.invocation).request_fingerprint
        backend.response.reserve_data = reservation_payload(requestFingerprint=fp)
        backend.response.dispatch_data = dispatch_payload(requestFingerprint=fp)
        backend.response.settle = lambda expected,rsv,**data:settlement_payload(
            requestFingerprint=fp,outcome=data['outcome'],bodyBytes=data['body_bytes'],
            chargedBytes=data['body_bytes'],contentSha256=data['content_sha256'])
        result = run(backend,(p,))
        self.assertEqual((result.summary.run_state,result.summary.commit_state,result.summary.visibility_state),
            ('partial','committed','pending'))
        self.assertEqual(result.summary.visible_publication_ids, ())

    def test_dispatch_replay_never_extracts_writes_or_closes(self):
        backend = FakePipeline(); backend.response.dispatched = True
        with self.assertRaises(PipelineResumeRequired): run(backend)
        self.assertEqual(backend.events, [])
        self.assertIsNone(backend.response.received)

    def test_all_plans_validated_before_any_side_effect(self):
        invalid = ((), [plan()], (plan(),plan()),
            (plan(),replace(plan(),source_key='other',response=replace(plan().response,endpoint='http://localhost/secret'))),
            (replace(plan(),expected_item_keys=('fictional-item','fictional-item')),),
            (replace(plan(),source_version_id='bad'),),
            (replace(plan(),response=None),),
            (replace(plan(),expected_item_keys=('bad space',)),))
        for plans in invalid:
            backend = FakePipeline()
            with self.assertRaises(ValueError): run(backend,plans)
            self.assertEqual(backend.events, [])
            self.assertEqual(backend.response.events, [])

    def test_forged_capture_checkpoint_stops_before_extraction(self):
        for key,value in (('runId',VERSION),('workClaimId',VERSION),('registrationId',VERSION),
            ('sourceKey','other'),('sourceVersionId',DECISION),('contentSha256','a'*64),
            ('outcome','unchanged'),('totalResponseBytes',True),('totalResponseBytes',3.0),
            ('totalResponseBytes',2),('checkedAt',(NOW+timedelta(seconds=1)).isoformat()),
            ('checkedAt',NOW.replace(tzinfo=None).isoformat()),('checkedAt','invalid'),('rawBody','forbidden')):
            backend = FakePipeline(); backend.capture_changes = {key:value}
            with self.assertRaises(ValueError): run(backend)
            self.assertEqual(backend.events, ['open','capture-check'])

    def test_missing_extra_duplicate_or_rebound_extracted_items_cannot_hide_work(self):
        original = PlannedItem('fictional-item','fictional-source',VERSION)
        for items in ((), (original,original), (replace(original,item_key='different'),),
            (replace(original,source_key='other'),), (replace(original,source_version_id=DECISION),)):
            backend = FakePipeline(); backend.items = items
            with self.assertRaises(ValueError): run(backend)
            self.assertEqual(backend.events, ['open','capture-check','extract'])

    def test_forged_manifest_readback_stops_before_decisions(self):
        for key,value in (('runId',VERSION),('workClaimId',VERSION),('canonicalManifest','{}'),
            ('manifestSha256','a'*64),('schemaVersion',True),('privateField','forbidden')):
            backend = FakePipeline(); backend.manifest_changes = {key:value}
            with self.assertRaises(ValueError): run(backend)
            self.assertEqual(backend.events[-1], 'manifest')

    def test_foreign_processing_receipt_stops_before_closeout(self):
        backend = FakePipeline(); backend.processing = StoredProcessing(
            (DecisionReceipt(DECISION,'unplanned-item',VERSION,'held'),),())
        with self.assertRaises(ValueError): run(backend)
        self.assertEqual(backend.events[-1], 'process')

    def test_forged_closeout_never_returns_success(self):
        backend = FakePipeline(); backend.close_changes = {'manifestSha256':'f'*64}
        with self.assertRaises(ValueError): run(backend)
        self.assertEqual(backend.events[-1], 'close')

    def test_failures_retain_reached_stages_and_never_execute_later_stages(self):
        for stage in ('capture-check','extract','manifest','process','close'):
            backend = FakePipeline(); backend.fail_stage = stage
            with self.assertRaises(RuntimeError): run(backend)
            self.assertEqual(backend.events[-1], stage)
            self.assertEqual(backend.response.received['body_bytes'],3)

    def test_late_checkpoint_cannot_extend_original_monotonic_duration(self):
        for stage in ('capture-check','extract','manifest','process','close'):
            backend = FakePipeline(); backend.delay_stage = stage
            with self.assertRaisesRegex(ValueError,'original work duration'): run(backend)
            self.assertEqual(backend.events[-1], stage)

    def test_utc_expiry_before_open_stops_and_clock_rollback_does_not_restore_duration(self):
        backend = FakePipeline(); backend.clock = lambda:NOW+timedelta(seconds=30)
        with self.assertRaises(ValueError): run(backend)
        self.assertEqual(backend.events, [])
        backend = FakePipeline(); backend.delay_stage='extract'
        backend.clock = lambda:NOW-timedelta(seconds=1) if backend.elapsed[0] else NOW
        with self.assertRaisesRegex(ValueError,'original work duration'): run(backend)


class RecoveryTests(unittest.TestCase):
    def captured(self):
        backend = FakePipeline(); backend.fail_stage = 'process'
        with self.assertRaises(RuntimeError): run(backend)
        manifest = backend.manifest; backend.fail_stage = None; backend.events = []
        checkpoint = backend.store_manifest(manifest, plan().response.work)
        backend.events = []
        return backend, manifest, checkpoint

    def resume(self, backend, manifest, checkpoint, *, work=None, original_claim=None, invocation=None):
        work = work or plan().response.work
        return resume_manifest_processing(manifest,invocation or plan().response.invocation,work,
            checkpoint,original_claim or str(plan().response.work.lease_id),backend,
            utc_now=backend.clock,monotonic=lambda:backend.elapsed[0])

    def test_recovery_never_reopens_extracts_or_rewrites_manifest(self):
        backend,manifest,checkpoint = self.captured()
        result = self.resume(backend,manifest,checkpoint)
        self.assertEqual(backend.events,['process','close'])
        self.assertEqual(result.summary.run_state,'completed')
        self.assertEqual(backend.response.events.count('dispatch-committed'),1)

    def test_takeover_uses_new_fence_but_preserves_original_manifest_and_deadline(self):
        from uuid import UUID
        backend,manifest,checkpoint = self.captured()
        original = plan().response.work
        successor = replace(original,lease_id=UUID(PUBLICATION),attempt=2)
        # The committed closeout is independently tied to the new current fence.
        original_close = backend.close
        def close(manifest,work):
            data = json.loads(original_close(manifest,work));data['workClaimId']=str(successor.lease_id)
            return encoded(data)
        backend.close=close
        result = self.resume(backend,manifest,checkpoint,work=successor)
        self.assertEqual(result.work_claim_id,PUBLICATION)
        self.assertEqual(result.summary.manifest_sha256,sha256(canonical_run_manifest(manifest).encode()).hexdigest())
        self.assertEqual(backend.events,['process','close'])

    def test_replayed_closeout_retains_older_original_finish(self):
        backend,manifest,checkpoint = self.captured()
        backend.clock=lambda:NOW+timedelta(seconds=5)
        result = self.resume(backend,manifest,checkpoint)
        self.assertEqual(result.finished_at,NOW)

    def test_forged_manifest_or_rebound_context_stops_before_processing(self):
        backend,manifest,checkpoint = self.captured()
        for changed in (b'{}',checkpoint.replace(b'fictional-item',b'missing-item'),
                        checkpoint.replace(str(plan().response.work.lease_id).encode(),PUBLICATION.encode())):
            with self.assertRaises(ValueError):self.resume(backend,manifest,changed)
        with self.assertRaises(ValueError):self.resume(backend,replace(manifest,request_fingerprint='b'*64),checkpoint)
        with self.assertRaises(ValueError):self.resume(backend,manifest,checkpoint,original_claim='bad')
        with self.assertRaises(ValueError):self.resume(backend,manifest,checkpoint,
            invocation=replace(plan().response.invocation,mode='publish_eligible'))
        self.assertEqual(backend.events,[])

    def test_expired_worker_or_delayed_recovery_cannot_close(self):
        backend,manifest,checkpoint = self.captured()
        backend.clock=lambda:NOW+timedelta(seconds=30)
        with self.assertRaises(ValueError):self.resume(backend,manifest,checkpoint)
        self.assertEqual(backend.events,[])
        backend.clock=lambda:NOW;backend.delay_stage='process'
        with self.assertRaisesRegex(ValueError,'original work duration'):self.resume(backend,manifest,checkpoint)
        self.assertEqual(backend.events,['process'])

    def test_current_invalid_source_remains_explicit_in_recovery_summary(self):
        backend,manifest,checkpoint = self.captured()
        backend.processing=replace(backend.processing,invalid_source_keys=('fictional-source',))
        original_close=backend.close
        def close(manifest,work):
            raw=json.loads(original_close(manifest,work))
            raw['summary']=completion_summary_payload(reconcile_run_completion(manifest,
                backend.processing.decisions,(),(),now=NOW,invalid_source_keys=('fictional-source',)))
            return encoded(raw)
        backend.close=close
        result=self.resume(backend,manifest,checkpoint)
        self.assertEqual(result.summary.run_state,'partial')
        self.assertEqual(result.summary.invalid_source_keys,('fictional-source',))
        self.assertEqual(result.summary.covered_source_keys,())


if __name__ == '__main__': unittest.main()
