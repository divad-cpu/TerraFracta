"""The direct driver must refuse invalid clocks without refunding dispatched work."""
import io
import unittest

from tests import test_reserved_response_capture as support
from tests.test_source_response_receipts import NOW, context
from workers.reserved_response_capture import capture_reserved_response, ReservedCaptureError


BAD_TICKS = (float("nan"), float("inf"), float("-inf"), True, None, "0", 10 ** 1000)


def run(ticks, backend=None, stream=None):
    backend = backend or support.FakeCommittedBackend()
    stream = stream if stream is not None else io.BytesIO(b"abc")
    values = iter(ticks)
    def opener(endpoint, seconds):
        backend.events.append("opened")
        return stream
    result = capture_reserved_response(context(), backend, opener,
        utc_now=lambda: NOW, monotonic=lambda: next(values))
    return result, backend, stream


class ReservedCaptureClockTests(unittest.TestCase):
    def test_finite_tick_that_cannot_represent_remaining_duration_denies_backend_work(self):
        for value in (1e308, -1e308):
            backend = support.FakeCommittedBackend()
            with self.subTest(value=value), self.assertRaises(ReservedCaptureError):
                run([value] * 10, backend)
            self.assertEqual(backend.events, [])

    def test_invalid_initial_clock_prevents_all_backend_and_transport_work(self):
        for value in BAD_TICKS:
            backend = support.FakeCommittedBackend()
            with self.subTest(type=type(value).__name__), self.assertRaises(ReservedCaptureError):
                run([value] + [0] * 10, backend)
            self.assertEqual(backend.events, [])
            self.assertIsNone(backend.received)

    def test_invalid_preopen_tick_keeps_dispatch_and_denies_the_opener(self):
        for value in BAD_TICKS:
            backend = support.FakeCommittedBackend()
            with self.subTest(type=type(value).__name__), self.assertRaises(ReservedCaptureError):
                run([0, value] + [0] * 10, backend)
            self.assertEqual(backend.events, ["reserve-committed", "dispatch-committed"])
            self.assertIsNone(backend.received)

    def test_invalid_preread_tick_closes_stream_and_retains_full_uncertain_charge(self):
        for value in BAD_TICKS:
            backend = support.FakeCommittedBackend()
            stream = io.BytesIO(b"abc")
            with self.subTest(type=type(value).__name__), self.assertRaises(ReservedCaptureError):
                run([0, 0, value] + [0] * 10, backend, stream)
            self.assertTrue(stream.closed)
            self.assertEqual(backend.received, {"outcome": "uncertain", "body_bytes": 101, "content_sha256": None})
            self.assertEqual(backend.events, ["reserve-committed", "dispatch-committed", "opened", "settle-committed"])

    def test_invalid_postread_tick_cannot_admit_the_bytes_just_consumed(self):
        for value in BAD_TICKS:
            backend = support.FakeCommittedBackend()
            stream = io.BytesIO(b"abc")
            with self.subTest(type=type(value).__name__), self.assertRaises(ReservedCaptureError):
                run([0, 0, 0, value] + [0] * 10, backend, stream)
            self.assertTrue(stream.closed)
            self.assertEqual(backend.received, {"outcome": "uncertain", "body_bytes": 101, "content_sha256": None})

    def test_invalid_final_tick_returns_no_body_but_does_not_rewrite_committed_measurement(self):
        for value in BAD_TICKS:
            backend = support.FakeCommittedBackend()
            with self.subTest(type=type(value).__name__), self.assertRaises(ReservedCaptureError):
                run([0] * 6 + [value], backend)
            self.assertEqual((backend.received["outcome"], backend.received["body_bytes"]), ("measured", 3))
            self.assertEqual(backend.events.count("settle-committed"), 1)

    def test_backwards_preopen_tick_cannot_extend_the_original_duration(self):
        backend = support.FakeCommittedBackend()
        with self.assertRaises(ReservedCaptureError):
            run([5, 4] + [4] * 10, backend)
        self.assertEqual(backend.events, ["reserve-committed", "dispatch-committed"])

    def test_backwards_read_ticks_are_refused_even_if_below_the_deadline(self):
        for ticks in ([5, 5, 4], [5, 5, 6, 5], [5, 5, 6, 6, 5]):
            backend = support.FakeCommittedBackend()
            with self.subTest(ticks=ticks), self.assertRaises(ReservedCaptureError):
                run(ticks + [10] * 10, backend)
            self.assertEqual((backend.received["outcome"], backend.received["body_bytes"]), ("uncertain", 101))

    def test_backwards_final_tick_never_returns_body_or_adds_another_settlement(self):
        backend = support.FakeCommittedBackend()
        with self.assertRaises(ReservedCaptureError):
            run([5, 5, 6, 6, 7, 7, 6], backend)
        self.assertEqual((backend.received["outcome"], backend.received["body_bytes"]), ("measured", 3))
        self.assertEqual(backend.events.count("settle-committed"), 1)

    def test_equal_and_increasing_finite_ticks_keep_the_original_success(self):
        for ticks in ([0] * 7, [0, 0, 1, 1, 2, 2, 3], [-5] * 7):
            with self.subTest(ticks=ticks):
                result, backend, stream = run(ticks)
                self.assertEqual(result.body, b"abc")
                self.assertEqual((backend.received["outcome"], backend.received["body_bytes"]), ("measured", 3))
                self.assertTrue(stream.closed)

    def test_dispatch_replay_has_no_new_opener_settlement_or_clock_read(self):
        backend = support.FakeCommittedBackend()
        backend.dispatched = True
        result, _, _ = run([0], backend)
        self.assertIsNone(result)
        self.assertEqual(backend.events, ["reserve-committed", "dispatch-committed"])
        self.assertIsNone(backend.received)


if __name__ == "__main__":
    unittest.main()
