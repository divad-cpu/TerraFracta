"""Finite native origins must not leak overflow when an interval is refused."""
import io
import unittest
from unittest.mock import patch
from tests import test_confirmed_response_backend as confirmed_support
from tests import test_reserved_response_capture as reserved_support
from tests import test_source_response_receipts as receipt_support
from workers.captured_update_pipeline import _bounded_work_check
from workers.reserved_response_capture import capture_reserved_response, ReservedCaptureError
from workers.bounded_worker_process import BoundedWorkerError, communicate_bounded

ORIGIN=(1<<1024)-(1<<970)-1


class IntervalCurationTests(unittest.TestCase):
    def test_pipeline_interval_conversion_overflow_is_a_curated_refusal(self):
        with self.assertRaisesRegex(ValueError,'Original duration unavailable'):
            _bounded_work_check(receipt_support.context().work,receipt_support.NOW,
                lambda:receipt_support.NOW,lambda:ORIGIN,'Original duration unavailable')

    def test_reserved_interval_conversion_overflow_admits_no_backend_or_opener(self):
        backend=reserved_support.FakeCommittedBackend();opened=[]
        with self.assertRaises(ReservedCaptureError):
            capture_reserved_response(receipt_support.context(),backend,
                lambda *args:opened.append(args) or io.BytesIO(b'invented'),
                utc_now=lambda:receipt_support.NOW,monotonic=lambda:ORIGIN)
        self.assertEqual(backend.events,[]);self.assertEqual(opened,[]);self.assertIsNone(backend.received)

    def test_confirmed_interval_conversion_overflow_cannot_open_a_dispatched_stream(self):
        raw,_,backend=confirmed_support.ConfirmedTests().setup_backend()
        expected=receipt_support.context();opened=[]
        reservation=receipt_support.parse_response_reservation(backend.reserve(expected),expected,now=receipt_support.NOW)
        backend.dispatch(expected,reservation);backend.monotonic=lambda:ORIGIN
        with self.assertRaisesRegex(ValueError,'cannot represent'):
            backend.authorized_opener(lambda *args:opened.append(args) or io.BytesIO(b'invented'))(expected.endpoint,1)
        self.assertEqual(opened,[]);self.assertEqual(raw.events,['reserve-committed','dispatch-committed'])
        self.assertIsNone(raw.received)

    def test_owned_pipe_interval_overflow_still_closes_and_reaps_the_child(self):
        class Stream:
            closed=False
            def close(self):self.closed=True
            def fileno(self):return 10
        class Process:
            def __init__(self):
                self.stdin=Stream();self.stdout=Stream();self.stderr=Stream();self.returncode=None;self.kills=0;self.waits=[]
            def poll(self):return self.returncode
            def kill(self):self.kills+=1
            def wait(self,timeout):self.waits.append(timeout);self.returncode=-9;return -9
        child=Process()
        with patch('workers.bounded_worker_process.time.monotonic',return_value=ORIGIN),patch('workers.bounded_worker_process.selectors.DefaultSelector',side_effect=AssertionError('No pipe admission')):
            with self.assertRaises(BoundedWorkerError):communicate_bounded(child,b'invented',timeout=1)
        self.assertEqual((child.kills,child.returncode,child.waits),(1,-9,[5]))
        self.assertTrue(all(getattr(child,n).closed for n in ('stdin','stdout','stderr')))


if __name__=='__main__':unittest.main()
