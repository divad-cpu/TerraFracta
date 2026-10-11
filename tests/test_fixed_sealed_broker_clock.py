"""Clock refusal with invented captures and opaque sealed bytes; no HTTP/SQL."""

import unittest
from unittest.mock import Mock, patch

from tests import test_ssb_14059_pair_transport as fixtures
from workers import fixed_ssb_transport_broker as fixed
from workers import ssb_sealed_transport as sealed
from workers.ssb_frozen_source import FrozenSSBSource, seal_source


class InventedSealedBroker(sealed.SealedSSBTransportBroker):
    def _command(self, kind):
        return ['invented-command-never-executed', kind]


class FixedSealedBrokerClockTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.SSB14059PairTransportTests()
        self.fixture.setUp()
        self.responses = {kind: self.fixture.response(kind, body) for kind, body in [
            ('metadata', self.fixture.metadata_body), ('data', self.fixture.data_body)]}

    def sealed_broker(self):
        descriptor, digest = seal_source(b'Invented opaque source bytes; no runnable archive')
        source = FrozenSSBSource(descriptor, digest, 'a'*64, 1)
        self.addCleanup(source.close)
        return InventedSealedBroker(source)

    def test_fixed_invalid_initial_clock_is_curated_without_capture_or_retry(self):
        for value in [True, '100', float('nan'), float('-inf'), 1 << 1100]:
            with self.subTest(value_type=type(value).__name__):
                broker = fixed.FixedSSBTransportBroker()
                with patch.object(fixed, 'monotonic', return_value=value), \
                        patch.object(broker, '_capture', return_value=self.responses['metadata']) as capture:
                    with self.assertRaises(ValueError):
                        broker('metadata', deadline=105)
                    capture.assert_not_called()
                with patch.object(fixed, 'monotonic', return_value=100), \
                        patch.object(broker, '_capture') as replay:
                    with self.assertRaises(ValueError):
                        broker('metadata', deadline=105)
                    replay.assert_not_called()

    def test_fixed_post_capture_invalid_or_backward_clock_withholds_metadata(self):
        for value in [float('nan'), float('-inf'), 99.0, True]:
            with self.subTest(value=value):
                clock = [100.0]
                broker = fixed.FixedSSBTransportBroker()

                def capture(*args, **kwargs):
                    clock[0] = value
                    return self.responses['metadata']

                with patch.object(fixed, 'monotonic', side_effect=lambda: clock[0]), \
                        patch.object(broker, '_capture', side_effect=capture) as fetch:
                    with self.assertRaises(ValueError):
                        broker('metadata', deadline=105)
                    clock[0] = 100.0
                    with self.assertRaises(ValueError):
                        broker('data', deadline=105)
                    self.assertEqual(fetch.call_count, 1)

    def test_fixed_clock_cannot_regress_between_metadata_and_data(self):
        clock = [100.0]
        broker = fixed.FixedSSBTransportBroker()

        def capture(kind, **kwargs):
            clock[0] = 102.0
            return self.responses[kind]

        with patch.object(fixed, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(broker, '_capture', side_effect=capture) as fetch:
            broker('metadata', deadline=105)
            clock[0] = 101.0
            with self.assertRaises(ValueError):
                broker('data', deadline=105)
            self.assertEqual(fetch.call_count, 1)

    def test_fixed_exact_ten_second_cap_and_timely_mixed_native_control(self):
        origin = float(1 << 56)
        for duration, accepted in [(7, True), (10, True), (11, False)]:
            with self.subTest(duration=duration):
                broker = fixed.FixedSSBTransportBroker()
                with patch.object(fixed, 'monotonic', return_value=origin), \
                        patch.object(broker, '_capture', return_value=self.responses['metadata']) as fetch:
                    if accepted:
                        self.assertEqual(broker('metadata', deadline=(1 << 56)+duration), self.responses['metadata'])
                    else:
                        with self.assertRaises(ValueError):
                            broker('metadata', deadline=(1 << 56)+duration)
                        fetch.assert_not_called()

    def test_sealed_invalid_clock_after_launch_reaps_without_startup(self):
        for value in [float('nan'), 99.0, True]:
            with self.subTest(value=value):
                clock = [100.0]
                broker = self.sealed_broker()
                child = self.fixture.process()
                child.poll.return_value = None

                def launch(*args, **kwargs):
                    clock[0] = value
                    return child

                with patch.object(fixed, 'monotonic', return_value=100.0), \
                        patch.object(sealed, 'monotonic', side_effect=lambda: clock[0]), \
                        patch.object(sealed.subprocess, 'Popen', side_effect=launch), \
                        patch.object(sealed, 'communicate_bounded', return_value=self.fixture.result('metadata', self.fixture.metadata_body)) as communicate:
                    with self.assertRaises(ValueError):
                        broker('metadata', deadline=105)
                    communicate.assert_not_called()
                child.kill.assert_called_once()
                child.wait.assert_called_once()
                for name in ['stdin', 'stdout', 'stderr']:
                    getattr(child, name).close.assert_called_once()

    def test_sealed_post_cleanup_clock_failure_cannot_record_a_capture(self):
        clock = [100.0]
        broker = self.sealed_broker()
        child = self.fixture.process()
        child.stderr.close.side_effect = lambda: clock.__setitem__(0, float('nan'))
        with patch.object(fixed, 'monotonic', return_value=100.0), \
                patch.object(sealed, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(sealed.subprocess, 'Popen', return_value=child), \
                patch.object(sealed, 'communicate_bounded', return_value=self.fixture.result('metadata', self.fixture.metadata_body)):
            with self.assertRaises(ValueError):
                broker('metadata', deadline=105)
        self.assertEqual(broker.response_kinds, [])

    def test_sealed_decode_expiry_is_held_before_capture_is_recorded(self):
        clock = [100.0]
        broker = self.sealed_broker()
        decode = sealed._decode_capture

        def slow_decode(*args):
            result = decode(*args)
            clock[0] = 105.0
            return result

        with patch.object(fixed, 'monotonic', return_value=100.0), \
                patch.object(sealed, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(sealed.subprocess, 'Popen', return_value=self.fixture.process()), \
                patch.object(sealed, 'communicate_bounded', return_value=self.fixture.result('metadata', self.fixture.metadata_body)), \
                patch.object(sealed, '_decode_capture', side_effect=slow_decode):
            with self.assertRaises(ValueError):
                broker('metadata', deadline=105)
        self.assertEqual(broker.response_kinds, [])

    def test_sealed_exact_residual_and_valid_two_response_sequence(self):
        origin = float(1 << 56)
        broker = self.sealed_broker()
        results = [self.fixture.result('metadata', self.fixture.metadata_body),
                   self.fixture.result('data', self.fixture.data_body)]
        with patch.object(fixed, 'monotonic', return_value=origin), \
                patch.object(sealed, 'monotonic', return_value=origin), \
                patch.object(sealed.subprocess, 'Popen', side_effect=lambda *a, **kw: self.fixture.process()), \
                patch.object(sealed, 'communicate_bounded', side_effect=results) as communicate:
            self.assertEqual(broker('metadata', deadline=(1 << 56)+7), self.responses['metadata'])
            self.assertEqual(broker('data', deadline=(1 << 56)+6), self.responses['data'])
        self.assertEqual([c.kwargs['timeout'] for c in communicate.call_args_list], [7.0, 6.0])
        self.assertEqual(broker.response_kinds, ['metadata', 'data'])

    def test_command_or_startup_encoding_cannot_admit_expired_next_effect(self):
        for phase in ['command', 'encoding']:
            with self.subTest(phase=phase):
                clock = [100.0]
                broker = self.sealed_broker()
                child = self.fixture.process()
                result = self.fixture.result('metadata', self.fixture.metadata_body)
                real_command = broker._command
                real_dumps = sealed.json.dumps

                def command(kind):
                    value = real_command(kind)
                    if phase == 'command':
                        clock[0] = 105.0
                    return value

                def encode(record, **kwargs):
                    value = real_dumps(record, **kwargs)
                    if phase == 'encoding' and set(record) == {'kind', 'deadline', 'parentPid'}:
                        clock[0] = 105.0
                    return value

                with patch.object(fixed, 'monotonic', return_value=100.0), \
                        patch.object(sealed, 'monotonic', side_effect=lambda: clock[0]), \
                        patch.object(broker, '_command', side_effect=command), \
                        patch.object(sealed.json, 'dumps', side_effect=encode), \
                        patch.object(sealed.subprocess, 'Popen', return_value=child) as launch, \
                        patch.object(sealed, 'communicate_bounded', return_value=result) as communicate:
                    with self.assertRaises(ValueError):
                        broker('metadata', deadline=105)
                    communicate.assert_not_called()
                    if phase == 'command':
                        launch.assert_not_called()
                    else:
                        launch.assert_called_once()
                        for name in ['stdin', 'stdout', 'stderr']:
                            getattr(child, name).close.assert_called_once()
                self.assertEqual(broker.response_kinds, [])


if __name__ == '__main__':
    unittest.main()
