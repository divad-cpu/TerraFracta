"""No late close dispatch or accepted receipt after final validation expires."""
from datetime import timedelta
import unittest
from unittest.mock import patch

from tests import test_captured_update_pipeline as support
from workers import captured_update_pipeline as pipeline


class FinalDeadlineTests(unittest.TestCase):
    def context(self, recovery):
        if recovery:
            backend, manifest, checkpoint = support.RecoveryTests().captured()
            request = support.plan().response
            invoke = lambda: pipeline.resume_manifest_processing(manifest,
                request.invocation, request.work, checkpoint, str(request.work.lease_id),
                backend, utc_now=lambda: backend.clock(), monotonic=lambda: backend.elapsed[0])
        else:
            backend = support.FakePipeline()
            invoke = lambda: pipeline.execute_captured_update((support.plan(),), backend,
                utc_now=lambda: backend.clock(), monotonic=lambda: backend.elapsed[0])
        return backend, invoke

    def expire(self, backend, utc):
        if utc:
            backend.clock = lambda: support.NOW + timedelta(seconds=30)
        else:
            backend.elapsed[0] = 31

    def reconciliation_expiry(self, recovery, utc):
        backend, invoke = self.context(recovery)
        reconcile = pipeline.reconcile_run_completion
        def delayed(*args, **kwargs):
            result = reconcile(*args, **kwargs)
            self.expire(backend, utc)
            return result
        with patch.object(pipeline, 'reconcile_run_completion', side_effect=delayed):
            with self.assertRaisesRegex(ValueError, 'original work duration'):
                invoke()
        self.assertNotIn('close', backend.events)
        self.assertEqual(backend.events[-1], 'process')
        if recovery:
            self.assertEqual(backend.events, ['process'])
        else:
            self.assertEqual(backend.events, ['open', 'capture-check', 'extract', 'manifest', 'process'])

    def receipt_expiry(self, recovery, utc):
        backend, invoke = self.context(recovery)
        parse = pipeline.parse_run_closeout
        def delayed(*args, **kwargs):
            result = parse(*args, **kwargs)
            self.expire(backend, utc)
            return result
        with patch.object(pipeline, 'parse_run_closeout', side_effect=delayed):
            with self.assertRaisesRegex(ValueError, 'original work duration'):
                invoke()
        # Close may already be committed. A late acknowledgement must not retry,
        # recreate the capture or pretend that committed work was rolled back.
        self.assertEqual(backend.events.count('close'), 1)
        self.assertEqual(backend.events.count('process'), 1)
        self.assertEqual(backend.events.count('open'), 0 if recovery else 1)

    def test_execute_utc_expiry_during_reconciliation_stops_before_close(self):
        self.reconciliation_expiry(False, True)

    def test_execute_monotonic_expiry_during_reconciliation_stops_before_close(self):
        self.reconciliation_expiry(False, False)

    def test_resume_utc_expiry_during_reconciliation_stops_before_close(self):
        self.reconciliation_expiry(True, True)

    def test_resume_monotonic_expiry_during_reconciliation_stops_before_close(self):
        self.reconciliation_expiry(True, False)

    def test_execute_utc_expiry_during_receipt_validation_withholds_result(self):
        self.receipt_expiry(False, True)

    def test_execute_monotonic_expiry_during_receipt_validation_withholds_result(self):
        self.receipt_expiry(False, False)

    def test_resume_utc_expiry_during_receipt_validation_withholds_result(self):
        self.receipt_expiry(True, True)

    def test_resume_monotonic_expiry_during_receipt_validation_withholds_result(self):
        self.receipt_expiry(True, False)

    def test_timely_execution_retains_original_closeout_and_once_only_order(self):
        backend, invoke = self.context(False)
        result = invoke()
        self.assertEqual(result.status, 'closed')
        self.assertEqual(result.finished_at, support.NOW)
        self.assertEqual(backend.events, ['open', 'capture-check', 'extract', 'manifest', 'process', 'close'])

    def test_timely_stored_replay_keeps_original_finish_and_never_reopens(self):
        backend, invoke = self.context(True)
        backend.close_changes = {'status': 'existing_closeout'}
        result = invoke()
        self.assertEqual(result.status, 'existing_closeout')
        self.assertEqual(result.finished_at, support.NOW)
        self.assertEqual(backend.events, ['process', 'close'])


if __name__ == '__main__':
    unittest.main()
