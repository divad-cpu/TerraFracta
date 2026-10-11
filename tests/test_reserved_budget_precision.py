"""Exact original deadlines retain capture debt and measured acknowledgements."""
import io
import unittest
from tests.test_source_response_receipts import NOW, context
from tests.test_reserved_response_capture import FakeCommittedBackend
from workers.reserved_response_capture import capture_reserved_response, ReservedCaptureError


def capture(ticks, backend=None):
    backend = backend or FakeCommittedBackend()
    values = iter(ticks)
    opened = []
    stream = io.BytesIO(b'abc')
    def opener(endpoint, seconds):
        opened.append(seconds)
        return stream
    return capture_reserved_response(context(), backend, opener, utc_now=lambda: NOW,
                                     monotonic=lambda: next(values)), backend, opened, stream


class ReservedBudgetPrecisionTests(unittest.TestCase):
    def test_late_preread_tick_retains_uncertain_charge_and_returns_no_body(self):
        for origin in (float(2 ** 55), -float(2 ** 55)):
            backend = FakeCommittedBackend()
            with self.subTest(origin=origin), self.assertRaises(ReservedCaptureError):
                capture([origin, origin] + [int(origin) + 31] * 10, backend)
            self.assertEqual(backend.received, {'outcome': 'uncertain', 'body_bytes': 101, 'content_sha256': None})
            self.assertEqual(backend.events.count('settle-committed'), 1)

    def test_exact_residual_seconds_do_not_borrow_rounded_deadline_capacity(self):
        origin = float(2 ** 55)
        for elapsed, residual in ((1, 29), (10, 20), (29, 1)):
            with self.subTest(elapsed=elapsed):
                result, backend, opened, stream = capture([origin] + [int(origin) + elapsed] * 10)
                self.assertEqual(opened, [residual])
                self.assertEqual(result.body, b'abc')
                self.assertTrue(stream.closed)
                self.assertEqual(backend.received['body_bytes'], 3)

    def test_exact_deadline_prevents_opening_and_preserves_original_dispatch(self):
        origin = float(2 ** 55)
        backend = FakeCommittedBackend()
        with self.assertRaises(ReservedCaptureError):
            capture([origin] + [int(origin) + 30] * 10, backend)
        self.assertEqual(backend.events, ['reserve-committed', 'dispatch-committed'])
        self.assertIsNone(backend.received)

    def test_late_final_tick_preserves_one_measured_acknowledgement_without_returning_body(self):
        origin = float(2 ** 55)
        backend = FakeCommittedBackend()
        with self.assertRaises(ReservedCaptureError):
            capture([origin] * 6 + [int(origin) + 31], backend)
        self.assertEqual(backend.received['outcome'], 'measured')
        self.assertEqual(backend.received['body_bytes'], 3)
        self.assertEqual(backend.events.count('settle-committed'), 1)


if __name__ == '__main__':
    unittest.main()
