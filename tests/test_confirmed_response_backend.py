from datetime import timedelta
import io
import unittest
from tests.test_source_response_receipts import NOW,context
from tests.test_reserved_response_capture import FakeCommittedBackend
from tests.test_response_authority import PRINCIPAL,authority_payload
from workers.confirmed_response_backend import ConfirmedResponseBackend
from workers.reserved_response_capture import capture_reserved_response,ReservedCaptureError

class Confirmer:
    def __init__(self,backend):self.backend=backend;self.events=[];self.fail_phase=None;self.changes={}
    def confirm(self,phase,receipt):
        self.events.append(phase)
        if phase==self.fail_phase:raise ValueError('Private expired scope')
        return authority_payload(receipt,phase,**self.changes)

class ConfirmedTests(unittest.TestCase):
    def setup_backend(self,**opts):
        raw=FakeCommittedBackend();confirm=Confirmer(raw)
        backend=ConfirmedResponseBackend(context(),PRINCIPAL,raw,confirm,utc_now=lambda:NOW,monotonic=lambda:0,**opts)
        return raw,confirm,backend
    def test_each_committed_phase_is_confirmed_and_opener_gets_shorter_window(self):
        raw,confirm,backend=self.setup_backend();opened=[]
        def opener(endpoint,seconds):opened.append(seconds);self.assertEqual(confirm.events,['reserve','dispatch']);return io.BytesIO(b'abc')
        result=capture_reserved_response(context(),backend,backend.authorized_opener(opener),utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertEqual(result.body,b'abc');self.assertEqual(opened,[10]);self.assertEqual(confirm.events,['reserve','dispatch','settle'])
    def test_failed_postcommit_confirmation_opens_no_stream(self):
        for phase in ('reserve','dispatch'):
            raw,confirm,backend=self.setup_backend();confirm.fail_phase=phase
            with self.assertRaises(ValueError):capture_reserved_response(context(),backend,
              backend.authorized_opener(lambda *args:self.fail('No source')),utc_now=lambda:NOW,monotonic=lambda:0)
            self.assertNotIn('settle-committed',raw.events)
    def test_failed_settlement_confirmation_returns_no_body(self):
        raw,confirm,backend=self.setup_backend();confirm.fail_phase='settle'
        with self.assertRaises(ReservedCaptureError):capture_reserved_response(context(),backend,
          backend.authorized_opener(lambda *args:io.BytesIO(b'abc')),utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertEqual(raw.received['outcome'],'measured')
    def test_replay_still_opens_no_second_stream(self):
        raw,confirm,backend=self.setup_backend();raw.dispatched=True
        result=capture_reserved_response(context(),backend,backend.authorized_opener(lambda *args:self.fail('No replay opener')),
          utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertIsNone(result);self.assertEqual(confirm.events,['reserve','dispatch'])
    def test_stream_crossing_authority_expiry_is_closed_and_uncertain(self):
        raw,confirm,backend=self.setup_backend();observed=[NOW];backend.utc_now=lambda:observed[0]
        class Expiring(io.BytesIO):
            def read(self,n):body=super().read(n);observed[0]=NOW+timedelta(seconds=11);return body
        stream=Expiring(b'abc')
        with self.assertRaises(ReservedCaptureError):capture_reserved_response(context(),backend,
          backend.authorized_opener(lambda *args:stream),utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertTrue(stream.closed);self.assertEqual(raw.received['outcome'],'uncertain');self.assertEqual(raw.received['body_bytes'],101)
    def test_monotonic_expiry_survives_unchanged_wall_clock(self):
        raw,confirm,backend=self.setup_backend();ticks=[0];backend.monotonic=lambda:ticks[0]
        class Slow(io.BytesIO):
            def read(self,n):body=super().read(n);ticks[0]=11;return body
        stream=Slow(b'abc')
        with self.assertRaises(ReservedCaptureError):capture_reserved_response(context(),backend,
          backend.authorized_opener(lambda *args:stream),utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertTrue(stream.closed);self.assertEqual(raw.received['body_bytes'],101)

if __name__=='__main__':unittest.main()
