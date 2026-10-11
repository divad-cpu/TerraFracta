"""An invalid monotonic observation cannot grant capture or recovery time."""
import unittest

from tests import test_captured_update_pipeline as support
from workers import captured_update_pipeline as pipeline


class PipelineClockTests(unittest.TestCase):
    def context(self, entry):
        backend, manifest, checkpoint = support.RecoveryTests().captured()
        request = support.plan().response
        if entry == 'execute':
            backend = support.FakePipeline()
            invoke = lambda: pipeline.execute_captured_update((support.plan(),), backend,
                utc_now=backend.clock, monotonic=lambda: backend.elapsed[0])
        else:
            function = pipeline.resume_manifest_processing if entry == 'resume' else pipeline.process_captured_manifest
            invoke = lambda: function(manifest, request.invocation, request.work,
                checkpoint, str(request.work.lease_id), backend,
                utc_now=backend.clock, monotonic=lambda: backend.elapsed[0])
        return backend, invoke

    def test_invalid_initial_clock_prevents_any_processing_or_response_write(self):
        for entry in ('execute', 'resume', 'process_only'):
            for value in (float('nan'), float('inf'), float('-inf'), False, '0', None):
                with self.subTest(entry=entry, value=repr(value)):
                    backend, invoke = self.context(entry)
                    backend.elapsed[0] = value
                    with self.assertRaises(ValueError):
                        invoke()
                    self.assertEqual(backend.events, [])
                    if entry == 'execute':
                        self.assertEqual(backend.response.events, [])

    def test_invalid_or_backwards_clock_after_processing_cannot_close_or_return(self):
        for entry in ('execute', 'resume', 'process_only'):
            for value in (float('nan'), float('inf'), float('-inf'), False, '0', None, 9):
                with self.subTest(entry=entry, value=repr(value)):
                    backend, invoke = self.context(entry)
                    backend.elapsed[0] = 10
                    process = backend.process
                    def invalid(*args):
                        result = process(*args)
                        backend.elapsed[0] = value
                        return result
                    backend.process = invalid
                    with self.assertRaises(ValueError):
                        invoke()
                    self.assertEqual(backend.events[-1], 'process')
                    self.assertNotIn('close', backend.events)

    def test_finite_unchanged_or_progressing_tick_keeps_original_work_budget(self):
        for entry in ('execute', 'resume', 'process_only'):
            for start, end in ((0, 0), (10, 11), (-10, -9)):
                with self.subTest(entry=entry, start=start, end=end):
                    backend, invoke = self.context(entry)
                    backend.elapsed[0] = start
                    process = backend.process
                    def timely(*args):
                        result = process(*args)
                        backend.elapsed[0] = end
                        return result
                    backend.process = timely
                    invoke()
                    self.assertEqual(backend.events.count('process'), 1)
                    self.assertEqual(backend.events.count('close'), 0 if entry == 'process_only' else 1)


if __name__ == '__main__':
    unittest.main()
