"""Regressions for independently reproduced frame deadline and child-ACK loss."""
from io import BytesIO
import json
import subprocess
import unittest
from unittest.mock import patch
from scripts.supervised_correction_review import _end_owned_child
from workers import invented_review_custody as custody


class LateCompleteFrame:
    def __init__(self):
        self.now = 100.; self.timeout = 25; self.calls = 0
        self.body = json.dumps({'schemaVersion': 1, 'status': 'continue_invented_review'}).encode()
    def gettimeout(self): return self.timeout
    def settimeout(self, value): self.timeout = value
    def recv(self, size):
        self.calls += 1
        if self.calls == 1: return len(self.body).to_bytes(4, 'big')
        self.now += .08
        return self.body


class LostSignalAckChild:
    def __init__(self, stage, unknown=False):
        self.stage = stage; self.unknown = unknown; self.returncode = None; self.events = []; self.waits = 0
        self.stdin = BytesIO(); self.stdout = BytesIO(); self.stderr = BytesIO()
    def poll(self): return self.returncode
    def terminate(self):
        self.events.append('terminate')
        if self.stage == 'terminate': raise OSError('Invented lost signal acknowledgement')
    def kill(self):
        self.events.append('kill')
        if self.stage == 'kill': raise OSError('Invented lost kill acknowledgement')
    def wait(self, timeout=None):
        self.events.append(('wait', timeout)); self.waits += 1
        if self.unknown or (self.stage == 'kill' and self.waits == 1):
            raise subprocess.TimeoutExpired('invented-child', timeout)
        self.returncode = -9 if self.stage == 'kill' else -15
        return self.returncode


class CustodyBoundaryTests(unittest.TestCase):
    def test_complete_body_arriving_after_elapsed_deadline_is_refused_and_timeout_restored(self):
        stream = LateCompleteFrame()
        with patch.object(custody.time, 'monotonic', side_effect=lambda: stream.now), self.assertRaises(ValueError):
            custody.receive_packet(stream, timeout=.025)
        self.assertEqual(stream.timeout, 25)

    def test_signal_ack_loss_still_confirms_bounded_exit_and_closes_owned_pipes(self):
        for stage in ('terminate', 'kill'):
            child = LostSignalAckChild(stage)
            with self.subTest(stage=stage):
                _end_owned_child(child)
                self.assertIsNotNone(child.returncode)
                self.assertIn(('wait', 15), child.events)
                if stage == 'kill': self.assertIn(('wait', 5), child.events)
                self.assertTrue(all(getattr(child, key).closed for key in ('stdin', 'stdout', 'stderr')))

    def test_unknown_exit_stays_unconfirmed_but_all_signal_wait_and_pipe_cleanup_steps_are_attempted(self):
        child = LostSignalAckChild('kill', unknown=True)
        with self.assertRaises((ValueError, subprocess.TimeoutExpired)):
            _end_owned_child(child)
        self.assertIsNone(child.returncode)
        self.assertEqual(child.events, ['terminate', ('wait', 15), 'kill', ('wait', 5)])
        self.assertTrue(all(getattr(child, key).closed for key in ('stdin', 'stdout', 'stderr')))


if __name__ == '__main__': unittest.main()
