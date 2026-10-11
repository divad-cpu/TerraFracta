"""Invented pipes expose refusal at the pair's parent and child clock seams."""

from io import BytesIO
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tests import test_ssb_14059_pair_transport as fixtures
from workers import ssb_14059_pair_transport as transport


class PairTransportClockTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.SSB14059PairTransportTests()
        self.fixture.setUp()

    def run_parent(self, clock, *, deadline=105, launch=None, communicate=None):
        process = self.fixture.process()
        result = self.fixture.result('metadata', self.fixture.metadata_body)
        with patch.object(transport, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(transport.subprocess, 'Popen', side_effect=launch or (lambda *a, **kw: process)), \
                patch.object(transport, 'communicate_bounded', side_effect=communicate or (lambda *a, **kw: result)):
            return transport._run_one('metadata', deadline=deadline)

    def run_child(self, clock, *, fetch=None, arm=None, deadline=105):
        output = BytesIO()
        wire = json.dumps({'kind': 'metadata', 'deadline': deadline, 'parentPid': os.getppid()}).encode()
        capture = self.fixture.response('metadata', self.fixture.metadata_body)
        with patch.object(transport, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(transport.sys, 'stdin', SimpleNamespace(buffer=BytesIO(wire))), \
                patch.object(transport.sys, 'stdout', SimpleNamespace(buffer=output)), \
                patch.object(transport, 'arm_parent_lifetime', side_effect=arm or (lambda *a: None)):
            code = transport._serve_child(['--single-response-child', 'metadata'], fetch or (lambda *a, **kw: capture))
        return code, output.getvalue()

    def test_parent_invalid_initial_clock_never_launches(self):
        for value in [True, '100', float('nan'), float('-inf'), 1 << 1100]:
            with self.subTest(value_type=type(value).__name__):
                launch = Mock(return_value=self.fixture.process())
                with self.assertRaises(transport.SSB14059PairTransportError):
                    self.run_parent([value], launch=launch)
                launch.assert_not_called()

    def test_parent_invalid_or_backward_clock_after_launch_reaps_without_authorization(self):
        for value in [float('nan'), 99.0, True]:
            with self.subTest(value=value):
                clock = [100.0]
                process = self.fixture.process()
                process.poll.return_value = None
                communicate = Mock(return_value=self.fixture.result('metadata', self.fixture.metadata_body))

                def launch(*args, **kwargs):
                    clock[0] = value
                    return process

                with self.assertRaises(transport.SSB14059PairTransportError):
                    self.run_parent(clock, launch=launch, communicate=communicate)
                communicate.assert_not_called()
                process.kill.assert_called_once()
                process.wait.assert_called_once()
                for name in ['stdin', 'stdout', 'stderr']:
                    getattr(process, name).close.assert_called_once()

    def test_parent_invalid_or_backward_clock_after_pipe_withholds_result(self):
        for value in [float('nan'), 99.0, True]:
            with self.subTest(value=value):
                clock = [100.0]

                def communicate(*args, **kwargs):
                    clock[0] = value
                    return self.fixture.result('metadata', self.fixture.metadata_body)

                with self.assertRaises(transport.SSB14059PairTransportError):
                    self.run_parent(clock, communicate=communicate)

    def test_decode_time_is_inside_parent_acceptance_boundary(self):
        clock = [100.0]
        real_decode = transport._decode_capture

        def decode(*args):
            capture = real_decode(*args)
            clock[0] = 105.0
            return capture

        with patch.object(transport, '_decode_capture', side_effect=decode):
            with self.assertRaises(transport.SSB14059PairTransportError):
                self.run_parent(clock)

    def test_child_invalid_or_backward_clock_after_arming_never_fetches(self):
        for value in [float('nan'), 99.0, True]:
            with self.subTest(value=value):
                clock = [100.0]
                fetch = Mock(return_value=self.fixture.response('metadata', self.fixture.metadata_body))

                def arm(*args):
                    clock[0] = value

                code, output = self.run_child(clock, fetch=fetch, arm=arm)
                self.assertNotEqual(code, 0)
                self.assertEqual(output, b'')
                fetch.assert_not_called()

    def test_child_invalid_clock_after_fetch_or_expiry_after_encode_cannot_write(self):
        clock = [100.0]

        def fetch(*args, **kwargs):
            clock[0] = float('nan')
            return self.fixture.response('metadata', self.fixture.metadata_body)

        code, output = self.run_child(clock, fetch=fetch)
        self.assertNotEqual(code, 0)
        self.assertEqual(output, b'')
        clock[0] = 100.0
        real_encode = transport._encode_capture

        def encode(*args):
            packet = real_encode(*args)
            clock[0] = 105.0
            return packet

        with patch.object(transport, '_encode_capture', side_effect=encode):
            code, output = self.run_child(clock)
        self.assertNotEqual(code, 0)
        self.assertEqual(output, b'')

    def test_native_mixed_deadline_and_valid_parent_child_controls(self):
        origin = float(1 << 56)
        communicate = Mock(return_value=self.fixture.result('metadata', self.fixture.metadata_body))
        self.assertEqual(self.run_parent([origin], deadline=(1 << 56) + 7, communicate=communicate).body, self.fixture.metadata_body)
        self.assertEqual(communicate.call_args.kwargs['timeout'], 7.0)
        self.assertEqual(self.run_parent([100.0]).body, self.fixture.metadata_body)
        code, output = self.run_child([100.0])
        self.assertEqual(code, 0)
        self.assertEqual(transport._decode_capture('metadata', output).body, self.fixture.metadata_body)

    def test_pair_start_clock_and_rounded_extended_interval_are_refused(self):
        for value in [True, float('nan'), float('inf'), float(1 << 56)]:
            with self.subTest(value=value), patch.object(transport, 'monotonic', return_value=value), \
                    patch.object(transport.subprocess, 'Popen') as launch:
                with self.assertRaises(transport.SSB14059PairTransportError):
                    transport.fetch_ssb_14059_pair_with_deadline()
                launch.assert_not_called()

    def test_shared_clock_cannot_regress_between_the_two_requests(self):
        clock = [100.0]
        results = iter([self.fixture.result('metadata', self.fixture.metadata_body),
                        self.fixture.result('data', self.fixture.data_body)])
        real_parse = transport.parse_captured_ssb_14059_metadata

        def communicate(*args, **kwargs):
            clock[0] = 102.0
            return next(results)

        def parse_metadata(*args):
            parsed = real_parse(*args)
            clock[0] = 101.0
            return parsed

        with patch.object(transport, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(transport.subprocess, 'Popen', side_effect=lambda *a, **kw: self.fixture.process()) as launch, \
                patch.object(transport, 'communicate_bounded', side_effect=communicate), \
                patch.object(transport, 'parse_captured_ssb_14059_metadata', side_effect=parse_metadata):
            with self.assertRaises(transport.SSB14059PairTransportError):
                transport.fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(launch.call_count, 1)

    def test_shared_clock_cannot_regress_during_final_pair_validation(self):
        clock = [100.0]
        results = iter([self.fixture.result('metadata', self.fixture.metadata_body),
                        self.fixture.result('data', self.fixture.data_body)])
        real_chronology = transport.require_bounded_pair_chronology

        def communicate(*args, **kwargs):
            clock[0] += 1
            return next(results)

        def chronology(*args):
            real_chronology(*args)
            clock[0] -= 0.5

        with patch.object(transport, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(transport.subprocess, 'Popen', side_effect=lambda *a, **kw: self.fixture.process()), \
                patch.object(transport, 'communicate_bounded', side_effect=communicate), \
                patch.object(transport, 'require_bounded_pair_chronology', side_effect=chronology):
            with self.assertRaises(transport.SSB14059PairTransportError):
                transport.fetch_ssb_14059_pair_with_deadline()


if __name__ == '__main__':
    unittest.main()
