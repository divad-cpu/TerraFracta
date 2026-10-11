"""Terminal failure accounting, dependency suppression and truthful partial closeout."""
from dataclasses import replace
from hashlib import sha256
import io
import json
import unittest
from tests import test_captured_update_pipeline as support
from tests import test_source_response_receipts as receipts
from tests.test_reserved_response_capture import FakeCommittedBackend
from workers.captured_update_pipeline import execute_captured_update,StoredProcessing
from workers.update_run_completion import PlannedItem
NOW=receipts.NOW


class FailurePipeline(support.FakePipeline):
    def __init__(self):
        super().__init__();self.processing=StoredProcessing((),());self.failure_changes={};self.failure=None
        self.second_backend=None;self.failed_open=True
    def response_backend(self,plan):
        return self.response if plan.source_key=='fictional-source' else self.second_backend
    def opener(self,plan):
        def opener(*args):
            self.stage('open:'+plan.source_key)
            if self.failed_open and plan.source_key=='fictional-source':raise OSError('private source error must never be published')
            return io.BytesIO(b'abc')
        return opener
    def unavailable(self,plan,outcome,charge):
        return support.encoded({'schemaVersion':1,'runId':str(plan.response.work.run_id),'workClaimId':str(plan.response.work.lease_id),
            'registrationId':plan.response.registration_id,'sourceKey':plan.source_key,'sourceVersionId':None,'contentSha256':None,
            'outcome':outcome,'totalResponseBytes':charge,'checkedAt':NOW.isoformat(),**self.failure_changes})
    def store_failed_capture(self,plan,failure):
        self.stage('failed-check');self.failure=failure
        return self.unavailable(plan,'failed',failure.settlement.charged_bytes)
    def store_deferred_capture(self,plan):
        self.stage('deferred-check');return self.unavailable(plan,'deferred',0)
    def store_capture(self,plan,capture):
        self.stage('capture-check')
        return support.encoded({'schemaVersion':1,'runId':str(plan.response.work.run_id),'workClaimId':str(plan.response.work.lease_id),
            'registrationId':plan.response.registration_id,'sourceKey':plan.source_key,'sourceVersionId':plan.source_version_id,
            'contentSha256':sha256(capture.body).hexdigest(),'outcome':'captured','totalResponseBytes':len(capture.body),'checkedAt':NOW.isoformat()})
    def extract_items(self,plan,capture):
        self.stage('extract');return tuple(PlannedItem(key,plan.source_key,plan.source_version_id) for key in plan.expected_item_keys)


def run(backend,plans=None,mode=True):
    return execute_captured_update(plans or (support.plan(),),backend,utc_now=lambda:NOW,monotonic=lambda:backend.elapsed[0],close_capture_failures=mode)


def second_plan(*,dependency=True):
    first=support.plan()
    return replace(first,source_key='fictional-data',response=replace(first.response,registration_id='55555555-5555-4555-8555-555555555555',
        request_key='fictional:second',endpoint='https://example.org/second'),source_version_id='66666666-6666-4666-8666-666666666666',
        expected_item_keys=('fictional-data-item',),requires_sources=('fictional-source',) if dependency else ())


def second_backend(plan):
    backend=FakeCommittedBackend()
    endpoint=sha256(plan.response.endpoint.encode()).hexdigest()
    backend.reserve_data=receipts.reservation_payload(registrationId=plan.response.registration_id,requestKey=plan.response.request_key,endpointSha256=endpoint)
    return backend


class CaptureFailureCloseTests(unittest.TestCase):
    def test_unreadable_source_retains_terminal_full_charge_and_closes_partial(self):
        backend=FailurePipeline();result=run(backend)
        self.assertEqual(result.summary.run_state,'partial')
        self.assertEqual(result.summary.missing_source_keys,('fictional-source',))
        self.assertEqual(result.summary.expected_items,0)
        self.assertEqual(result.summary.held_items,0)
        self.assertEqual(result.summary.committed_publication_ids,())
        self.assertEqual(backend.failure.settlement.charged_bytes,backend.failure.reservation.reserved_bytes)
        self.assertEqual(backend.events,['open:fictional-source','failed-check','manifest','process','close'])

    def test_failed_metadata_defers_dependent_data_without_any_reserve_or_open(self):
        backend=FailurePipeline();second=second_plan()
        result=run(backend,(support.plan(),second))
        self.assertEqual(set(result.summary.missing_source_keys),{'fictional-source','fictional-data'})
        self.assertEqual(backend.events,['open:fictional-source','failed-check','deferred-check','manifest','process','close'])
        self.assertIsNone(backend.second_backend)

    def test_independent_source_can_finish_after_another_source_failed(self):
        backend=FailurePipeline();second=second_plan(dependency=False);backend.second_backend=second_backend(second)
        result=run(backend,(support.plan(),second))
        self.assertEqual(result.summary.covered_source_keys,('fictional-data',))
        self.assertEqual(result.summary.missing_source_keys,('fictional-source',))
        self.assertEqual(result.summary.pending_item_keys,('fictional-data-item',))
        self.assertEqual(result.summary.run_state,'partial')

    def test_unconfirmed_settlement_never_becomes_a_saved_failure_or_refund(self):
        backend=FailurePipeline()
        backend.response.settle=lambda *args,**kw:b'{}'
        with self.assertRaises(ValueError):run(backend)
        self.assertEqual(backend.events,['open:fictional-source'])
        self.assertIsNone(backend.failure)

    def test_forged_failure_checkpoint_has_no_processing_closeout(self):
        for changes in ({'totalResponseBytes':0},{'totalResponseBytes':True},{'outcome':'captured'},
                        {'sourceVersionId':support.VERSION},{'contentSha256':'a'*64},{'sourceKey':'foreign'},
                        {'workClaimId':'99999999-9999-4999-8999-999999999999'}):
            backend=FailurePipeline();backend.failure_changes=changes
            with self.assertRaises(ValueError):run(backend)
            self.assertNotIn('manifest',backend.events)

    def test_cancelled_read_is_not_converted_to_completed_processing(self):
        backend=FailurePipeline()
        backend.opener=lambda plan:lambda *args:(_ for _ in ()).throw(KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):run(backend)
        self.assertEqual(backend.events,[])

    def test_default_driver_retains_original_fail_fast_behavior(self):
        backend=FailurePipeline()
        with self.assertRaises(ValueError):run(backend,mode=False)
        self.assertEqual(backend.events,['open:fictional-source'])

    def test_unknown_later_self_or_duplicated_dependency_fails_before_any_write(self):
        for dependencies in (('foreign',),('fictional-data',),('fictional-source','fictional-source')):
            backend=FailurePipeline();second=replace(second_plan(),requires_sources=dependencies)
            with self.assertRaises(ValueError):run(backend,(support.plan(),second))
            self.assertEqual(backend.events,[])
        backend=FailurePipeline()
        with self.assertRaises(ValueError):run(backend,(second_plan(),support.plan()))
        self.assertEqual(backend.events,[])

    def test_failure_mode_rejects_non_boolean(self):
        backend=FailurePipeline()
        with self.assertRaises(ValueError):run(backend,mode='yes')
        self.assertEqual(backend.events,[])

if __name__=='__main__':unittest.main()
