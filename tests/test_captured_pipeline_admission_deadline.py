"""Elapsed setup/validation cannot admit a later backend action."""
import unittest
from unittest.mock import patch

from tests import test_captured_update_pipeline as support
from workers import captured_update_pipeline as pipeline


class ActionAdmissionDeadlineTests(unittest.TestCase):
    def factory_expiry(self, name):
        backend = support.FakePipeline()
        original = getattr(backend, name)
        calls = []
        opener = backend.opener
        def observed_opener(plan):
            calls.append('opener')
            return opener(plan)
        backend.opener = observed_opener
        if name == 'opener':
            original = backend.opener
        def late(plan):
            result = original(plan)
            backend.elapsed[0] = 31
            return result
        setattr(backend, name, late)
        with self.assertRaisesRegex(ValueError, 'original work duration'):
            support.run(backend)
        self.assertEqual(backend.events, [])
        self.assertEqual(backend.response.events, [])
        self.assertEqual(calls, [] if name == 'response_backend' else ['opener'])

    def test_response_backend_setup_expiry_stops_before_opener_or_reservation(self):
        self.factory_expiry('response_backend')

    def test_opener_setup_expiry_stops_before_reservation_or_source_open(self):
        self.factory_expiry('opener')

    def validator_expiry(self, name, forbidden):
        backend = support.FakePipeline()
        validate = getattr(pipeline, name)
        def delayed(*args, **kwargs):
            result = validate(*args, **kwargs)
            backend.elapsed[0] = 31
            return result
        with patch.object(pipeline, name, side_effect=delayed):
            with self.assertRaisesRegex(ValueError, 'original work duration'):
                support.run(backend)
        self.assertNotIn(forbidden, backend.events)

    def test_capture_checkpoint_validation_expiry_stops_before_extraction(self):
        self.validator_expiry('require_capture_checkpoint', 'extract')

    def test_manifest_checkpoint_validation_expiry_stops_before_processing(self):
        self.validator_expiry('require_manifest_checkpoint', 'process')

    def test_recovery_checkpoint_validation_cannot_reset_the_original_budget(self):
        for function in (pipeline.resume_manifest_processing, pipeline.process_captured_manifest):
            with self.subTest(entry=function.__name__):
                backend, manifest, checkpoint = support.RecoveryTests().captured()
                request = support.plan().response
                validate = pipeline._require_manifest_claim
                def delayed(*args):
                    result = validate(*args)
                    backend.elapsed[0] = 31
                    return result
                with patch.object(pipeline, '_require_manifest_claim', side_effect=delayed):
                    with self.assertRaisesRegex(ValueError, 'original work duration'):
                        function(manifest, request.invocation, request.work, checkpoint,
                            str(request.work.lease_id), backend, utc_now=backend.clock,
                            monotonic=lambda: backend.elapsed[0])
                self.assertEqual(backend.events, [])

    def test_timely_factories_and_validators_preserve_once_only_processing(self):
        for name in ('response_backend', 'opener'):
            with self.subTest(factory=name):
                backend = support.FakePipeline()
                original = getattr(backend, name)
                def timely(plan):
                    result = original(plan)
                    backend.elapsed[0] = 5
                    return result
                setattr(backend, name, timely)
                result = support.run(backend)
                self.assertEqual(result.summary.run_state, 'completed')
                self.assertEqual(backend.events, ['open', 'capture-check', 'extract', 'manifest', 'process', 'close'])


if __name__ == '__main__':
    unittest.main()
