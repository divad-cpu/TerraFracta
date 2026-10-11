"""Recovery validation is included in the original admission-time budget."""
import unittest
from unittest.mock import patch

from tests import test_captured_update_pipeline as support
from workers import captured_update_pipeline as pipeline


class InitialRecoveryDeadlineTests(unittest.TestCase):
    def initial_expiry(self, validation):
        for entry in (pipeline.resume_manifest_processing, pipeline.process_captured_manifest):
            with self.subTest(entry=entry.__name__):
                backend, manifest, checkpoint = support.RecoveryTests().captured()
                request = support.plan().response
                original = getattr(pipeline, validation)
                def delayed(*args):
                    result = original(*args)
                    backend.elapsed[0] = 31
                    return result
                with patch.object(pipeline, validation, side_effect=delayed):
                    with self.assertRaisesRegex(ValueError, 'original work duration'):
                        entry(manifest, request.invocation, request.work, checkpoint,
                            str(request.work.lease_id), backend, utc_now=backend.clock,
                            monotonic=lambda: backend.elapsed[0])
                self.assertEqual(backend.events, [])

    def test_initial_manifest_validation_cannot_rebase_recovery_time(self):
        self.initial_expiry('canonical_run_manifest')

    def test_initial_request_identity_validation_cannot_rebase_recovery_time(self):
        self.initial_expiry('identify_update_request')

    def test_execute_request_identity_validation_cannot_rebase_initial_time(self):
        backend = support.FakePipeline()
        original = pipeline.identify_update_request
        def delayed(*args):
            result = original(*args)
            backend.elapsed[0] = 31
            return result
        with patch.object(pipeline, 'identify_update_request', side_effect=delayed):
            with self.assertRaisesRegex(ValueError, 'original work duration'):
                support.run(backend)
        self.assertEqual(backend.events, [])
        self.assertEqual(backend.response.events, [])

    def test_execute_timely_identity_preserves_initial_work(self):
        backend = support.FakePipeline()
        original = pipeline.identify_update_request
        def timely(*args):
            result = original(*args)
            backend.elapsed[0] = 5
            return result
        with patch.object(pipeline, 'identify_update_request', side_effect=timely):
            result = support.run(backend)
        self.assertEqual(result.finished_at, support.NOW)
        self.assertEqual(backend.events, ['open', 'capture-check', 'extract', 'manifest', 'process', 'close'])

    def test_timely_initial_validation_preserves_processing_and_original_finish(self):
        for entry in (pipeline.resume_manifest_processing, pipeline.process_captured_manifest):
            with self.subTest(entry=entry.__name__):
                backend, manifest, checkpoint = support.RecoveryTests().captured()
                request = support.plan().response
                original = pipeline.canonical_run_manifest
                def timely(*args):
                    result = original(*args)
                    backend.elapsed[0] = 5
                    return result
                with patch.object(pipeline, 'canonical_run_manifest', side_effect=timely):
                    result = entry(manifest, request.invocation, request.work, checkpoint,
                        str(request.work.lease_id), backend, utc_now=backend.clock,
                        monotonic=lambda: backend.elapsed[0])
                if entry is pipeline.resume_manifest_processing:
                    self.assertEqual(result.finished_at, support.NOW)
                    self.assertEqual(backend.events, ['process', 'close'])
                else:
                    self.assertEqual(result, backend.processing)
                    self.assertEqual(backend.events, ['process'])


if __name__ == '__main__':
    unittest.main()
