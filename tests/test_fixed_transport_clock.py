"""Only invented responses exercise the fixed transport's absolute deadline."""

import unittest
from unittest.mock import patch

from tests import test_ssb_14059_transport as fixtures
from workers import ssb_14059_transport as transport


class FixedTransportClockTests(unittest.TestCase):
    def capture(self, clock, *, deadline=105, response=None, build=None):
        response = response or fixtures.FakeResponse(transport.METADATA_URL)
        opener = fixtures.FakeOpener(response)
        with patch.object(transport, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(transport, '_build_opener', side_effect=build or (lambda: opener)):
            return transport.fetch_ssb_14059_once('metadata', deadline=deadline)

    def test_invalid_initial_clock_never_builds_tls_or_opens(self):
        for value in [True, '100', None, float('nan'), float('inf'), float('-inf'), 1 << 1100]:
            with self.subTest(value_type=type(value).__name__):
                factory = unittest.mock.Mock(return_value=fixtures.FakeOpener(
                    fixtures.FakeResponse(transport.METADATA_URL)))
                with self.assertRaises(transport.SSB14059TransportError):
                    self.capture([value], build=factory)
                factory.assert_not_called()

    def test_invalid_or_backward_clock_after_tls_never_opens(self):
        for value in [True, float('nan'), float('-inf'), 99.0]:
            with self.subTest(value=value):
                clock = [100.0]
                opener = fixtures.FakeOpener(fixtures.FakeResponse(transport.METADATA_URL))

                def build():
                    clock[0] = value
                    return opener

                with self.assertRaises(transport.SSB14059TransportError):
                    self.capture(clock, build=build)
                self.assertEqual(opener.requests, [])

    def test_invalid_clock_after_open_closes_without_read(self):
        clock = [100.0]
        response = fixtures.FakeResponse(transport.METADATA_URL)
        opener = fixtures.FakeOpener(response)
        real_open = opener.open

        def open_response(*args, **kwargs):
            clock[0] = float('nan')
            return real_open(*args, **kwargs)

        opener.open = open_response
        with self.assertRaises(transport.SSB14059TransportError):
            self.capture(clock, response=response, build=lambda: opener)
        self.assertTrue(response.closed)
        self.assertEqual(response.offset, 0)

    def test_invalid_clock_after_body_read_withholds_and_closes(self):
        for value in [float('nan'), 99.0, 105.0]:
            with self.subTest(value=value):
                clock = [100.0]
                response = fixtures.FakeResponse(transport.METADATA_URL)
                read = response.read

                def read_and_expire(size):
                    result = read(size)
                    clock[0] = value
                    return result

                response.read = read_and_expire
                with self.assertRaises(transport.SSB14059TransportError):
                    self.capture(clock, response=response)
                self.assertTrue(response.closed)
                self.assertEqual(response.offset, 2)

    def test_close_cannot_release_a_late_invalid_or_backward_capture(self):
        for value in [105.0, float('nan'), 99.0]:
            with self.subTest(value=value):
                clock = [100.0]

                class CloseClockResponse(fixtures.FakeResponse):
                    def __exit__(self, *unused):
                        self.closed = True
                        clock[0] = value

                response = CloseClockResponse(transport.METADATA_URL)
                with self.assertRaises(transport.SSB14059TransportError):
                    self.capture(clock, response=response)
                self.assertEqual(response.offset, 2)
                self.assertTrue(response.closed)

    def test_mixed_native_deadline_preserves_original_seven_seconds(self):
        origin = float(1 << 56)
        clock = [origin]
        opener = fixtures.FakeOpener(fixtures.FakeResponse(transport.METADATA_URL))
        capture = self.capture(clock, deadline=(1 << 56) + 7, build=lambda: opener)
        self.assertEqual(opener.requests[0][1], 7.0)
        self.assertEqual(capture.body, b'{}')

    def test_valid_timely_capture_and_legacy_no_deadline_keep_their_contracts(self):
        for deadline in [105, 100.25]:
            with self.subTest(deadline=deadline):
                self.assertEqual(self.capture([100.0], deadline=deadline).body, b'{}')
        response = fixtures.FakeResponse(transport.METADATA_URL)
        opener = fixtures.FakeOpener(response)
        with patch.object(transport, 'monotonic', side_effect=AssertionError('no absolute deadline')), \
                patch.object(transport, '_build_opener', return_value=opener):
            self.assertEqual(transport.fetch_ssb_14059_once('metadata').body, b'{}')
        self.assertEqual(opener.requests[0][1], transport.SOCKET_TIMEOUT_SECONDS)

    def test_unrepresentable_deadline_and_thrown_clock_are_curated(self):
        for deadline, clock in [(1 << 1100, lambda: 100), (105, lambda: (_ for _ in ()).throw(OSError('invented clock error')))]:
            with self.subTest(deadline_type=type(deadline).__name__):
                with patch.object(transport, 'monotonic', side_effect=clock), \
                        patch.object(transport, '_build_opener') as factory:
                    with self.assertRaises(transport.SSB14059TransportError):
                        transport.fetch_ssb_14059_once('metadata', deadline=deadline)
                    factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
