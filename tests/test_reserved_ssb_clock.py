"""Invented ledgers retain measured debt when later source clock checks refuse."""

from datetime import timedelta
import json
import unittest
from unittest.mock import Mock, patch

from tests import test_reserved_ssb_capture as fixtures
from workers import reserved_ssb_capture as reserved
from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL


class ReservedSSBClockTests(unittest.TestCase):
    def setUp(self):
        self.helper = fixtures.ReservedSSBTests()
        self.helper.setUp()

    def fetch(self, kind, *, deadline):
        self.helper.events.append((kind, 'fetch'))
        url = METADATA_URL if kind == 'metadata' else DATA_URL
        return CapturedResponse(url, url, 0, 200, 'application/json', self.helper.wires[kind], fixtures.NOW)

    def test_pair_invalid_start_clock_never_constructs_a_backend(self):
        for value in [True, float('nan'), float('inf'), 1 << 1100]:
            with self.subTest(value_type=type(value).__name__):
                factory = Mock(side_effect=self.helper.factory)
                self.helper.ticks = value
                with self.assertRaises(ValueError):
                    reserved.capture_reserved_ssb_pair(*fixtures.contexts(), factory, self.fetch,
                        utc_now=lambda: fixtures.NOW, monotonic=lambda: self.helper.ticks)
                factory.assert_not_called()
                self.assertEqual(self.helper.events, [])

    def test_parser_invalid_or_backward_tick_cannot_release_measured_capture(self):
        for value in [float('nan'), float('-inf'), -1.0, True]:
            with self.subTest(value=value):
                self.setUp()
                real_parse = reserved.parse_captured_ssb_14059

                def parse(capture):
                    result = real_parse(capture)
                    self.helper.ticks = value
                    return result

                with patch.object(reserved, 'parse_captured_ssb_14059', side_effect=parse):
                    with self.assertRaises(ValueError):
                        self.helper.once(fetcher=self.fetch)
                charge = next(iter(self.helper.ledgers.values())).charge
                self.assertEqual(charge['outcome'], 'measured')
                self.assertEqual(charge['body_bytes'], len(self.helper.wires['data']))

    def test_pair_reconciliation_invalid_or_backward_tick_cannot_release_pair(self):
        for value in [float('nan'), -1.0]:
            with self.subTest(value=value):
                self.setUp()
                matching = reserved.require_matching_metadata

                def reconcile(*args):
                    matching(*args)
                    self.helper.ticks = value

                with patch.object(reserved, 'require_matching_metadata', side_effect=reconcile):
                    with self.assertRaises(ValueError):
                        self.helper.pair(fetcher=self.fetch)
                self.assertEqual([self.helper.ledgers[c.request_key].charge['outcome'] for c in fixtures.contexts()], ['measured', 'measured'])

    def test_backward_clock_between_calls_cannot_reserve_data_after_measured_metadata(self):
        parser = reserved.parse_captured_ssb_14059_metadata
        factory_calls = []

        def parse(capture):
            result = parser(capture)
            self.helper.ticks = 4.0
            return result

        def factory(expected):
            factory_calls.append(expected.request_key)
            if expected.request_key == fixtures.contexts()[1].request_key:
                self.helper.ticks = 3.0
            return self.helper.factory(expected)

        with patch.object(reserved, 'parse_captured_ssb_14059_metadata', side_effect=parse):
            with self.assertRaises(ValueError):
                reserved.capture_reserved_ssb_pair(*fixtures.contexts(), factory, self.fetch,
                    utc_now=lambda: fixtures.NOW, monotonic=lambda: self.helper.ticks)
        self.assertTrue(factory_calls)
        data_key = fixtures.contexts()[1].request_key
        self.assertFalse(any(event[0] == data_key and event[1] in ['reserve', 'dispatch'] for event in self.helper.events))
        self.assertEqual(self.helper.ledgers[fixtures.contexts()[0].request_key].charge['outcome'], 'measured')

    def test_inexact_internal_ten_second_wire_interval_is_refused_before_backend(self):
        self.helper.ticks = float(1 << 56)
        factory = Mock(side_effect=self.helper.factory)
        with self.assertRaises(ValueError):
            reserved.capture_reserved_ssb_pair(*fixtures.contexts(), factory, self.fetch,
                utc_now=lambda: fixtures.NOW, monotonic=lambda: self.helper.ticks)
        factory.assert_not_called()
        self.assertEqual(self.helper.events, [])

    def test_native_deadline_cap_refuses_eleven_seconds_but_keeps_seven_second_capture(self):
        for duration, accepted in [(11, False), (7, True)]:
            with self.subTest(duration=duration):
                self.setUp()
                self.helper.ticks = float(1 << 56)
                expected = fixtures.contexts()[1]
                backend = self.helper.factory(expected)
                operation = lambda: reserved.capture_reserved_ssb_once('data', expected, backend, self.fetch,
                    pair_deadline=(1 << 56)+duration, utc_now=lambda: fixtures.NOW, monotonic=lambda: self.helper.ticks)
                if accepted:
                    self.assertEqual(operation().capture.body, self.helper.wires['data'])
                else:
                    with self.assertRaises(ValueError):
                        operation()
                    self.assertEqual(self.helper.events, [])

    def test_timely_pair_preserves_confirmation_measured_charges_and_replay_hold(self):
        first, second = self.helper.pair(fetcher=self.fetch)
        self.assertEqual((first.kind, second.kind), ('metadata', 'data'))
        for expected, response in zip(fixtures.contexts(), [first, second], strict=True):
            self.assertIn((expected.request_key, 'confirm:dispatch'), self.helper.events)
            self.assertEqual(self.helper.ledgers[expected.request_key].charge['body_bytes'], len(response.capture.body))
        count = len([event for event in self.helper.events if event[1] == 'fetch'])
        with self.assertRaises(ValueError):
            self.helper.pair(fetcher=self.fetch)
        self.assertEqual(len([event for event in self.helper.events if event[1] == 'fetch']), count)

    def test_inner_authority_duration_cannot_round_five_seconds_to_eight(self):
        self.helper.ticks = float(1 << 55)
        expected = fixtures.contexts()[1]
        backend = self.helper.factory(expected)
        confirmer = self.helper.confirmers[expected.request_key]
        confirm = confirmer.confirm

        def five_seconds(*args):
            record = json.loads(confirm(*args))
            record['authorityExpiresAt'] = (fixtures.NOW+timedelta(seconds=5)).isoformat()
            return json.dumps(record).encode()

        with patch.object(confirmer, 'confirm', side_effect=five_seconds), \
                patch.object(self, 'fetch', side_effect=self.fetch) as fetch:
            with self.assertRaises(ValueError):
                reserved.capture_reserved_ssb_once('data', expected, backend, fetch,
                    pair_deadline=(1 << 55)+10, utc_now=lambda: fixtures.NOW, monotonic=lambda: self.helper.ticks)
            fetch.assert_not_called()
        self.assertEqual(self.helper.ledgers[expected.request_key].charge['outcome'], 'uncertain')
        self.assertEqual(self.helper.ledgers[expected.request_key].charge['body_bytes'], expected.max_body_bytes+1)


if __name__ == '__main__':
    unittest.main()
