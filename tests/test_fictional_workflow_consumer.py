"""Stable local-pipe/frame and isolated cleanup probes, no child/DB/network."""
from contextlib import ExitStack
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from scripts import fictional_workflow_consumer as consumer


class FictionalWorkflowConsumerTests(unittest.TestCase):
    def context(self):
        value = consumer.FixedWorkflowConsumer(Path('/invented-private-proof'))
        value.process = SimpleNamespace(stdout=SimpleNamespace(fileno=lambda: 123))
        value.selector = Mock()
        value.selector.select.return_value = [(None, None)]
        return value

    def test_partial_frame_stops_at_whole_frame_deadline_without_blocking_readline(self):
        value = self.context()
        with patch.object(consumer.time, 'monotonic', side_effect=[0, 0, 29, 31]), \
             patch.object(consumer.os, 'read', side_effect=[b'{', b'"operation":']):
            with self.assertRaisesRegex(ValueError, 'deadline'):
                value.receive()
        self.assertEqual(value.pending, b'{"operation":')
        self.assertEqual(value.selector.select.call_count, 2)

    def test_complete_chunked_frames_are_strict_json_and_keep_only_unread_tail(self):
        value = self.context()
        with patch.object(consumer.time, 'monotonic', return_value=1), \
             patch.object(consumer.os, 'read', side_effect=[b'{"operation":', b'"current"}\n{"operation":"queue"}\n']):
            self.assertEqual(value.receive(), {'operation': 'current'})
            self.assertEqual(value.receive(), {'operation': 'queue'})
            self.assertEqual(value.pending, b'')

    def test_frame_size_eof_utf8_and_clock_failures_are_held(self):
        for pending, part, times in [(b'x'*consumer.MAX_FRAME_BYTES, b'', [0, 0]),
            (b'', b'', [0, 0]), (b'', b'\xff\n', [0, 0, 0]),
            (b'{}\n', b'', [0, 31]), (b'{}\n', b'', [1, 0]),
            (b'{}\n', b'', [float('nan')])]:
            with self.subTest(pendingLength=len(pending), clocks=times):
                value = self.context(); value.pending.extend(pending)
                with patch.object(consumer.time, 'monotonic', side_effect=times), patch.object(consumer.os, 'read', return_value=part):
                    with self.assertRaises((ValueError, UnicodeDecodeError)):
                        value.receive()

    def test_real_pipe_readiness_after_partial_byte_still_has_bounded_full_frame_wait(self):
        read_fd, write_fd = os.pipe(); stream = os.fdopen(read_fd, 'rb', buffering=0)
        value = consumer.FixedWorkflowConsumer(Path('/invented-private-proof'))
        value.process = SimpleNamespace(stdout=stream)
        value.selector = consumer.selectors.DefaultSelector()
        try:
            os.set_blocking(read_fd, False); value.selector.register(stream, consumer.selectors.EVENT_READ)
            os.write(write_fd, b'{')
            with patch.object(consumer, 'FRAME_TIMEOUT_SECONDS', 0.02):
                with self.assertRaisesRegex(ValueError, 'deadline'):
                    value.receive()
            self.assertEqual(value.pending, b'{')
        finally:
            value.selector.close(); stream.close(); os.close(write_fd)

    def test_setup_and_cleanup_failures_attempt_reaping_independently(self):
        for mode in ['register', 'selector_close', 'terminate', 'timeout', 'communicate', 'already_exited', 'normal']:
            with self.subTest(mode=mode), ExitStack() as stack:
                process = Mock(); process.returncode = None
                process.poll.side_effect = lambda: process.returncode
                def communicate(timeout):
                    if mode == 'timeout' and process.communicate.call_count == 1:
                        raise subprocess.TimeoutExpired('fixed fictional child', timeout)
                    if mode == 'communicate' and process.communicate.call_count == 1:
                        raise OSError('invented communication failure')
                    process.returncode = -15; return ('', 'fixed invented stderr')
                process.communicate.side_effect = communicate
                if mode == 'already_exited': process.returncode = 1
                if mode == 'terminate': process.terminate.side_effect = OSError('invented failure')
                selector = Mock()
                if mode == 'register': selector.register.side_effect = OSError('invented failure')
                if mode == 'selector_close': selector.close.side_effect = OSError('invented failure')
                stack.enter_context(patch.object(consumer.subprocess, 'Popen', return_value=process))
                stack.enter_context(patch.object(consumer.selectors, 'DefaultSelector', return_value=selector))
                stack.enter_context(patch.object(consumer.os, 'set_blocking'))
                evidence = stack.enter_context(patch.object(consumer, 'private_file'))
                value = consumer.FixedWorkflowConsumer(Path('/invented-private-proof'))
                try:
                    with value:
                        raise ValueError('invented workflow held')
                except (ValueError, OSError, RuntimeError):
                    pass
                self.assertIsNotNone(process.poll()); self.assertTrue(value.consumed)
                self.assertEqual(selector.close.call_count, 1)
                self.assertTrue(evidence.called)
                if mode in ['timeout', 'communicate']: self.assertEqual(process.kill.call_count, 1)
                if mode == 'already_exited': self.assertEqual(process.terminate.call_count, 0)
                value.close(); self.assertEqual(selector.close.call_count, 1)

if __name__ == '__main__': unittest.main()
