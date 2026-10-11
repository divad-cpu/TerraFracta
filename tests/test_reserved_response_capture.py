from dataclasses import replace
from datetime import timedelta
import io
import json
import unittest

from tests.test_source_response_receipts import (NOW, context, reservation_payload,
    dispatch_payload, settlement_payload)
from workers.reserved_response_capture import capture_reserved_response, ReservedCaptureError


class FakeCommittedBackend:
    def __init__(self):
        self.events = []; self.dispatched = False; self.received = None
        self.reserve_data = reservation_payload(); self.dispatch_data = None
        self.fail_settle = False; self.settle_changes = {}

    def reserve(self, expected):
        self.events.append('reserve-committed')
        return self.reserve_data

    def dispatch(self, expected, reservation):
        self.events.append('dispatch-committed')
        if self.dispatch_data is not None:return self.dispatch_data
        status = 'existing' if self.dispatched else 'dispatched'
        self.dispatched = True
        return dispatch_payload(status=status)

    def settle(self, expected, reservation, **data):
        self.events.append('settle-committed'); self.received = data
        if self.fail_settle:raise RuntimeError('private database diagnostic')
        return settlement_payload(outcome=data['outcome'],bodyBytes=data['body_bytes'],
            chargedBytes=data['body_bytes'],contentSha256=data['content_sha256'],**self.settle_changes)


class CaptureTests(unittest.TestCase):
    def run_capture(self, backend=None, stream=None, **options):
        backend = backend or FakeCommittedBackend()
        stream = stream if stream is not None else io.BytesIO(b'abc')
        def opener(endpoint, seconds):
            self.assertEqual(backend.events,['reserve-committed','dispatch-committed'])
            self.assertEqual(endpoint,context().endpoint); self.assertGreater(seconds,0)
            backend.events.append('opened');return stream
        result = capture_reserved_response(context(),backend,opener,utc_now=lambda:NOW,
                                           monotonic=lambda:0,**options)
        return result,backend,stream

    def test_reserve_dispatch_commit_before_transport_and_measured_release(self):
        result,backend,stream = self.run_capture()
        self.assertEqual(result.body,b'abc');self.assertEqual(result.settlement.charged_bytes,3)
        self.assertEqual(backend.events,['reserve-committed','dispatch-committed','opened','settle-committed'])
        self.assertTrue(stream.closed)

    def test_empty_body_measured_zero(self):
        result,_,_ = self.run_capture(stream=io.BytesIO())
        self.assertEqual(result.body,b'');self.assertEqual(result.settlement.charged_bytes,0)

    def test_exact_maximum_needs_eof_probe(self):
        result,_,_ = self.run_capture(stream=io.BytesIO(b'a'*100))
        self.assertEqual(len(result.body),100)

    def test_replay_dispatch_never_reopens_or_resettles(self):
        backend = FakeCommittedBackend();backend.dispatched = True
        def forbidden(*args):raise AssertionError('No transport on replay')
        self.assertIsNone(capture_reserved_response(context(),backend,forbidden,utc_now=lambda:NOW,monotonic=lambda:0))
        self.assertIsNone(backend.received)

    def test_crash_after_dispatch_before_open_loses_attempt(self):
        backend = FakeCommittedBackend();backend.dispatched = True
        result,backend,_ = self.run_capture(backend)
        self.assertIsNone(result);self.assertEqual(backend.events,['reserve-committed','dispatch-committed'])

    def test_invalid_reservation_receipt_denies_dispatch_and_transport(self):
        for change in ({'runId':'foreign'},{'reservedBytes':1},{'rawBody':'private'}):
            backend = FakeCommittedBackend();backend.reserve_data = reservation_payload(**change)
            with self.assertRaises(ValueError):self.run_capture(backend)
            self.assertEqual(backend.events,['reserve-committed'])

    def test_invalid_dispatch_receipt_denies_transport(self):
        backend = FakeCommittedBackend();backend.dispatch_data = dispatch_payload(status='forged')
        with self.assertRaises(ValueError):self.run_capture(backend)
        self.assertEqual(backend.events,['reserve-committed','dispatch-committed'])

    def test_open_error_conservatively_charges(self):
        backend = FakeCommittedBackend()
        def failed(*args):raise OSError('private source diagnostic')
        with self.assertRaisesRegex(ReservedCaptureError,'capacity is retained') as cm:
            capture_reserved_response(context(),backend,failed,utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertNotIn('private source',str(cm.exception))
        self.assertEqual(backend.received,{'outcome':'uncertain','body_bytes':101,'content_sha256':None})

    def test_partial_read_error_or_unbounded_stream_conservatively_charges(self):
        class Broken(io.BytesIO):
            def read(self,n):raise OSError('private diagnostic')
        class Unbounded(io.BytesIO):
            def read(self,n):return b'x'*(n+1)
        class Text(io.BytesIO):
            def read(self,n):return 'abc'
        for stream in (Broken(b'abc'),Unbounded(),Text()):
            backend = FakeCommittedBackend()
            with self.assertRaises(ReservedCaptureError):self.run_capture(backend,stream)
            self.assertEqual(backend.received['outcome'],'uncertain')
            self.assertEqual(backend.received['body_bytes'],101);self.assertTrue(stream.closed)

    def test_measured_oversize_charges_probe_byte_and_returns_no_body(self):
        backend = FakeCommittedBackend()
        with self.assertRaises(ReservedCaptureError):self.run_capture(backend,io.BytesIO(b'a'*102))
        self.assertEqual(backend.received['outcome'],'measured')
        self.assertEqual(backend.received['body_bytes'],101)

    def test_cancellation_preserves_full_charge_and_original_signal(self):
        class Cancelled(io.BytesIO):
            def read(self,n):raise KeyboardInterrupt()
        backend = FakeCommittedBackend()
        with self.assertRaises(KeyboardInterrupt):self.run_capture(backend,Cancelled())
        self.assertEqual(backend.received['outcome'],'uncertain');self.assertEqual(backend.received['body_bytes'],101)

    def test_close_failure_conservatively_charges_full_even_after_eof(self):
        class BrokenClose(io.BytesIO):
            def close(self):super().close();raise OSError('private close diagnostic')
        backend = FakeCommittedBackend()
        with self.assertRaises(ReservedCaptureError):self.run_capture(backend,BrokenClose(b'abc'))
        self.assertEqual(backend.received['outcome'],'uncertain');self.assertEqual(backend.received['body_bytes'],101)

    def test_invalid_or_unavailable_settlement_never_returns_unchecked_body(self):
        for changes in ({'chargedBytes':2},{'bodyBytes':2},{'rawBody':'private'}):
            backend = FakeCommittedBackend();backend.settle_changes = changes
            with self.assertRaises(ReservedCaptureError):self.run_capture(backend)
        backend = FakeCommittedBackend();backend.fail_settle = True
        with self.assertRaisesRegex(ReservedCaptureError,'unavailable or invalid'):self.run_capture(backend)

    def test_expiry_after_committed_dispatch_never_opens(self):
        backend = FakeCommittedBackend();values = iter([NOW,NOW,NOW,NOW+timedelta(seconds=30)])
        with self.assertRaises(ReservedCaptureError):
            capture_reserved_response(context(),backend,lambda *args:self.fail('Transport after expiry'),
                utc_now=lambda:next(values),monotonic=lambda:0)
        self.assertEqual(backend.events,['reserve-committed','dispatch-committed'])

    def test_monotonic_deadline_stops_reads_with_wall_clock_unchanged(self):
        backend = FakeCommittedBackend();clock = iter([0,0,31])
        with self.assertRaises(ReservedCaptureError):
            capture_reserved_response(context(),backend,lambda *args:io.BytesIO(b'abc'),
                utc_now=lambda:NOW,monotonic=lambda:next(clock))
        self.assertEqual(backend.received['outcome'],'uncertain')


    def test_wall_clock_rollback_cannot_extend_opener_timeout(self):
        backend=FakeCommittedBackend();utc=iter([NOW+timedelta(seconds=20)]+[NOW+timedelta(seconds=5)]*20)
        ticks=iter([0]+[2]*20);opened=[]
        def opener(endpoint,seconds):
            opened.append(seconds);return io.BytesIO(b'abc')
        result=capture_reserved_response(context(),backend,opener,utc_now=lambda:next(utc),monotonic=lambda:next(ticks))
        self.assertEqual(result.body,b'abc');self.assertEqual(opened,[8])

    def test_receipt_delay_spends_initial_duration_even_after_clock_rollback(self):
        backend=FakeCommittedBackend();utc=iter([NOW+timedelta(seconds=20)]+[NOW+timedelta(seconds=5)]*20)
        ticks=iter([0]+[11]*20)
        with self.assertRaises(ReservedCaptureError):
            capture_reserved_response(context(),backend,lambda *args:self.fail('No time for transport'),
              utc_now=lambda:next(utc),monotonic=lambda:next(ticks))
        self.assertEqual(backend.events,['reserve-committed','dispatch-committed'])

    def test_slow_settlement_returns_no_body_after_monotonic_deadline(self):
        backend=FakeCommittedBackend();elapsed=[0]
        original=backend.settle
        def delayed(*args,**kwargs):
            result=original(*args,**kwargs);elapsed[0]=31;return result
        backend.settle=delayed
        with self.assertRaises(ReservedCaptureError):
            capture_reserved_response(context(),backend,lambda *args:io.BytesIO(b'abc'),
              utc_now=lambda:NOW,monotonic=lambda:elapsed[0])
        self.assertEqual(backend.received['outcome'],'measured')


if __name__ == '__main__':unittest.main()
