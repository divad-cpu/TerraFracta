"""Post-COMMIT authority must not borrow duration from an invalid local clock."""
import io
import unittest
from tests import test_confirmed_response_backend as support
from tests.test_source_response_receipts import NOW, context
from workers.reserved_response_capture import capture_reserved_response, ReservedCaptureError

BAD = (float('nan'), float('inf'), float('-inf'), True, None, '0', 10 ** 1000)


def setup(ticks, stream=None):
    raw, confirmer, backend = support.ConfirmedTests().setup_backend()
    values = iter(ticks)
    backend.monotonic = lambda: next(values)
    stream = stream if stream is not None else io.BytesIO(b'abc')
    opened = []
    def opener(endpoint, seconds):
        opened.append(seconds)
        return stream
    invoke = lambda: capture_reserved_response(context(), backend, backend.authorized_opener(opener),
                                               utc_now=lambda: NOW, monotonic=lambda: 0)
    return raw, confirmer, opened, stream, invoke


class ConfirmedResponseClockTests(unittest.TestCase):
    def test_invalid_initial_tick_never_opens_and_retains_dispatched_capacity(self):
        for value in BAD:
            raw, confirm, opened, stream, invoke = setup([value] * 10)
            with self.subTest(value=repr(value)), self.assertRaises(ReservedCaptureError):
                invoke()
            self.assertEqual(opened, [])
            self.assertEqual(raw.received['outcome'], 'uncertain')
            self.assertEqual(raw.received['body_bytes'], 101)
            self.assertEqual(confirm.events, ['reserve', 'dispatch', 'settle'])
            stream.close()

    def test_invalid_preread_tick_closes_the_owned_stream_and_returns_no_body(self):
        for value in BAD:
            raw, _, opened, stream, invoke = setup([0, value] + [0] * 10)
            with self.subTest(value=repr(value)), self.assertRaises(ReservedCaptureError):
                invoke()
            self.assertEqual(opened, [10])
            self.assertTrue(stream.closed)
            self.assertEqual(raw.received['body_bytes'], 101)

    def test_invalid_postread_tick_never_admits_consumed_bytes(self):
        for value in BAD:
            raw, _, opened, stream, invoke = setup([0, 0, value] + [0] * 10)
            with self.subTest(value=repr(value)), self.assertRaises(ReservedCaptureError):
                invoke()
            self.assertEqual(opened, [10])
            self.assertTrue(stream.closed)
            self.assertEqual(raw.received['outcome'], 'uncertain')

    def test_backwards_preread_or_postread_tick_cannot_renew_dispatch_authority(self):
        for ticks in ([5, 4], [5, 6, 5]):
            raw, _, _, stream, invoke = setup(ticks + [6] * 10)
            with self.subTest(ticks=ticks), self.assertRaises(ReservedCaptureError):
                invoke()
            self.assertTrue(stream.closed)
            self.assertEqual(raw.received['body_bytes'], 101)

    def test_large_float_origin_does_not_round_ten_second_authority_up_to_sixteen(self):
        origin = float(2 ** 56)
        raw, _, _, stream, invoke = setup([origin] + [2 ** 56 + 11] * 10)
        with self.assertRaises(ReservedCaptureError):
            invoke()
        self.assertTrue(stream.closed)
        self.assertEqual(raw.received['outcome'], 'uncertain')

    def test_unrepresentable_interval_holds_before_opening_without_a_new_clock(self):
        for origin in (1e308, -1e308):
            raw, _, opened, stream, invoke = setup([origin] * 10)
            with self.subTest(origin=origin), self.assertRaises(ReservedCaptureError):
                invoke()
            self.assertEqual(opened, [])
            self.assertEqual(raw.received['body_bytes'], 101)
            stream.close()

    def test_valid_integer_float_negative_and_large_origins_keep_one_measured_settlement(self):
        for origin in (0, -5, 0.5, -0.5, float(2 ** 56)):
            ticks = [origin] + [int(origin) + 1 if type(origin) is float and abs(origin) > 10 else origin] * 10
            raw, confirm, opened, stream, invoke = setup(ticks)
            with self.subTest(origin=origin):
                self.assertEqual(invoke().body, b'abc')
            self.assertEqual(opened, [10])
            self.assertTrue(stream.closed)
            self.assertEqual(raw.received['body_bytes'], 3)
            self.assertEqual(confirm.events, ['reserve', 'dispatch', 'settle'])

    def test_advancing_clock_hits_original_deadline_without_reset_and_replay_never_samples_it(self):
        raw, _, _, stream, invoke = setup([0, 4, 5, 9, 10])
        with self.assertRaises(ReservedCaptureError):
            invoke()
        self.assertTrue(stream.closed)
        self.assertEqual(raw.received['body_bytes'], 101)
        raw, confirm, backend = support.ConfirmedTests().setup_backend()
        raw.dispatched = True
        backend.monotonic = lambda: self.fail('No new clock on replay')
        result = capture_reserved_response(context(), backend,
            backend.authorized_opener(lambda *args: self.fail('No new opener')),
            utc_now=lambda: NOW, monotonic=lambda: 0)
        self.assertIsNone(result)
        self.assertEqual(confirm.events, ['reserve', 'dispatch'])
        self.assertIsNone(raw.received)


if __name__ == '__main__':
    unittest.main()
