"""No SQL is executed: invented owned pipes test retained-store timing effects."""

import unittest
from unittest.mock import patch

from tests import test_owned_pipe_deadline as pipes
from tests import test_retained_native_transaction as store
from workers import retained_native_transaction as retained
from workers.bounded_worker_process import WorkerOutput


class Timer:
    def __init__(self, *args):
        self.started = False
        self.cancelled = False
    def start(self): self.started = True
    def cancel(self): self.cancelled = True


class RetainedDeadlineTests(unittest.TestCase):
    def run_store(self, origin=0.0, *, select_tick=None, after_write=None, after_close=None, throwing=False, timeout=1):
        clock = [origin]
        process = pipes.Process(clock)
        selector = pipes.Selector(clock, select_tick)
        effects = []
        timer = Timer()

        def tick():
            if throwing:
                raise OSError('invented-private-clock-canary')
            return clock[0]

        def write(descriptor, body):
            effects.append(('write', descriptor, len(body)))
            if after_write is not None:
                clock[0] = after_write
            return len(body)

        def read(descriptor, size):
            effects.append(('read', descriptor))
            return b'{}\n'

        def prepare(raw):
            effects.append(('prepare', raw))
            return store.STORE

        def communicate(*args, **kwargs):
            effects.append(('communicate', kwargs['timeout']))
            process.returncode = 0
            return WorkerOutput(b'{}\n'+retained.COMMIT_MARKER+b'\n', b'', 0)

        close = process.stderr.close

        def close_stream():
            close()
            if after_close is not None:
                clock[0] = after_close

        process.stderr.close = close_stream
        with patch.object(retained.time, 'monotonic', side_effect=tick), \
                patch.object(retained.threading, 'Timer', return_value=timer), \
                patch.object(retained.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(retained.os, 'set_blocking'), \
                patch.object(retained.os, 'write', side_effect=write), \
                patch.object(retained.os, 'read', side_effect=read), \
                patch.object(retained, 'communicate_bounded', side_effect=communicate):
            try:
                reply = retained.retained_pair_store(process, b'invented\n', prepare, timeout=timeout)
                error = None
            except Exception as observed:
                reply = None
                error = observed
        return reply, error, effects, process, selector, timer

    def assert_held_and_closed(self, result):
        reply, error, effects, process, selector, timer = result
        self.assertIsNone(reply)
        self.assertIsInstance(error, ValueError)
        self.assertNotIn('canary', str(error))
        self.assertIsNotNone(process.poll())
        self.assertTrue(all(getattr(process, name).closed for name in ['stdin', 'stdout', 'stderr']))
        return effects, process, selector, timer

    def test_invalid_initial_clock_has_no_statement_or_callback_and_reaps_owned_process(self):
        for value in [True, None, float('nan'), float('inf'), float('-inf'), 1 << 1100]:
            with self.subTest(value_type=type(value).__name__):
                effects, process, _, _ = self.assert_held_and_closed(self.run_store(value))
                self.assertEqual(effects, [])
                self.assertEqual(process.kills, 1)

    def test_thrown_initial_clock_is_curated_and_still_cleans_owned_process(self):
        effects, process, _, _ = self.assert_held_and_closed(self.run_store(throwing=True))
        self.assertEqual(effects, [])
        self.assertEqual(process.kills, 1)

    def test_expired_invalid_or_backward_select_cannot_deliver_first_statement(self):
        for tick in [1.0, float('nan'), -1.0, True]:
            with self.subTest(tick=tick):
                effects, _, _, timer = self.assert_held_and_closed(self.run_store(select_tick=tick))
                self.assertEqual(effects, [])
                self.assertTrue(timer.cancelled)

    def test_each_selected_effect_rechecks_time_after_first_write(self):
        effects, _, _, _ = self.assert_held_and_closed(self.run_store(after_write=1.0))
        self.assertEqual(len(effects), 1)
        self.assertEqual(effects[0][0], 'write')

    def test_large_native_origin_cannot_extend_five_seconds_to_eight(self):
        effects, _, _, _ = self.assert_held_and_closed(self.run_store(float(1 << 55), select_tick=(1 << 55)+6, timeout=5))
        self.assertEqual(effects, [])

    def test_late_cleanup_withholds_receipt_after_consumed_commit_marker(self):
        result = self.run_store(after_close=1.0)
        effects, process, _, _ = self.assert_held_and_closed(result)
        self.assertTrue(any(effect[0] == 'communicate' for effect in effects))
        self.assertEqual(process.returncode, 0)
        self.assertEqual(process.kills, 0)

    def test_valid_timely_native_origins_preserve_framing_callback_and_cleanup(self):
        for origin in [0, -1, 0.5, -0.5]:
            with self.subTest(origin=origin):
                reply, error, effects, process, selector, timer = self.run_store(origin)
                self.assertIsNone(error)
                self.assertEqual(reply, '{}')
                self.assertEqual([effect[0] for effect in effects], ['write', 'read', 'prepare', 'communicate'])
                self.assertEqual(selector.waits, [1.0])
                self.assertTrue(timer.started and timer.cancelled)
                self.assertTrue(all(getattr(process, name).closed for name in ['stdin', 'stdout', 'stderr']))


if __name__ == '__main__':
    unittest.main()
