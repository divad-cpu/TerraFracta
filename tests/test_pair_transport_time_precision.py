"""Network-free exact child capture times and metadata-first refusal."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import unittest

from workers.bounded_worker_process import WorkerOutput
from workers.ssb_14059_capture import (
    CapturedResponse, DATA_URL, METADATA_URL, SSB14059CaptureError,
    parse_captured_ssb_14059, parse_captured_ssb_14059_metadata,
    require_bounded_pair_chronology,
)
from workers.ssb_14059_pair_transport import (
    _decode_capture, _encode_capture, fetch_ssb_14059_pair_with_deadline,
    SSB14059PairTransportError,
)


NOW = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'


class PairTransportTimePrecisionTests(unittest.TestCase):
    def wire(self, kind, stamp=None):
        url = METADATA_URL if kind == 'metadata' else DATA_URL
        name = 'ssb_14059_metadata_minimal_2024_2025.json' if kind == 'metadata' else 'ssb_14059_jsonstat_minimal_2024_2025.json'
        capture = CapturedResponse(url, url, 0, 200, 'application/json', (FIXTURES / name).read_bytes(), NOW)
        payload = json.loads(_encode_capture(kind, capture))
        if stamp is not None:
            payload['retrieved_at'] = stamp
        return json.dumps(payload).encode()

    def decode(self, kind, stamp):
        return _decode_capture(kind, self.wire(kind, stamp))

    def process(self):
        process = MagicMock()
        process.poll.return_value = 0
        for name in ('stdin', 'stdout', 'stderr'):
            getattr(process, name).closed = False
        return process

    def test_both_capture_kinds_refuse_fractional_precision_loss(self):
        for kind in ('metadata', 'data'):
            for fraction in ('0000001', '0000000', '7319271', '0' * 500):
                with self.subTest(kind=kind, fractionLength=len(fraction)):
                    with self.assertRaises(SSB14059PairTransportError):
                        self.decode(kind, '2026-09-25T12:00:00.' + fraction + '+00:00')

    def test_supported_exact_spelling_and_writer_roundtrip_remain_valid(self):
        for kind in ('metadata', 'data'):
            for suffix in ('Z', '+00:00'):
                for fraction in ('', '.0', '.000000', '.731927'):
                    with self.subTest(kind=kind, suffix=suffix, fraction=fraction):
                        capture = self.decode(kind, '2026-09-25T12:00:00' + fraction + suffix)
                        expected = NOW + timedelta(microseconds=731927 if fraction == '.731927' else 0)
                        self.assertEqual(capture.retrieved_at, expected)
                        self.assertEqual(_decode_capture(kind, _encode_capture(kind, capture)), capture)

    def test_lexically_outside_five_minute_pair_cannot_borrow_boundary(self):
        metadata = parse_captured_ssb_14059_metadata(self.decode('metadata', NOW.isoformat()))
        with self.assertRaises(ValueError):
            data = parse_captured_ssb_14059(self.decode('data', '2026-09-25T12:05:00.0000001+00:00'))
            require_bounded_pair_chronology(data, metadata)

    def test_exact_pair_chronology_keeps_boundary_and_microsecond_controls(self):
        metadata = parse_captured_ssb_14059_metadata(self.decode('metadata', NOW.isoformat()))
        exact = parse_captured_ssb_14059(self.decode('data', (NOW + timedelta(minutes=5)).isoformat()))
        require_bounded_pair_chronology(exact, metadata)
        for instant in (NOW - timedelta(microseconds=1), NOW + timedelta(minutes=5, microseconds=1)):
            with self.subTest(instant=instant):
                data = parse_captured_ssb_14059(self.decode('data', instant.isoformat()))
                with self.assertRaises(SSB14059CaptureError):
                    require_bounded_pair_chronology(data, metadata)

    def test_invalid_metadata_time_stops_before_second_mocked_child(self):
        invalid = WorkerOutput(self.wire('metadata', '2026-09-25T12:00:00.0000001+00:00'), b'', 0)
        valid_data = WorkerOutput(self.wire('data'), b'', 0)
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen', side_effect=[self.process(), self.process()]) as launch, \
             patch('workers.ssb_14059_pair_transport.communicate_bounded', side_effect=[invalid, valid_data]) as communicate, \
             patch('workers.ssb_14059_pair_transport.monotonic', return_value=100):
            with self.assertRaises(SSB14059PairTransportError):
                fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(launch.call_count, 1)
        self.assertEqual(communicate.call_count, 1)

    def test_invalid_data_time_returns_no_pair_and_never_retries(self):
        metadata = WorkerOutput(self.wire('metadata'), b'', 0)
        invalid_data = WorkerOutput(self.wire('data', '2026-09-25T12:05:00.0000001+00:00'), b'', 0)
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen', side_effect=[self.process(), self.process()]) as launch, \
             patch('workers.ssb_14059_pair_transport.communicate_bounded', side_effect=[metadata, invalid_data]) as communicate, \
             patch('workers.ssb_14059_pair_transport.monotonic', return_value=100):
            with self.assertRaises(SSB14059PairTransportError):
                fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(launch.call_count, 2)
        self.assertEqual(communicate.call_count, 2)

    def test_unsupported_lexical_forms_refuse_curated_wire_error(self):
        for stamp in (
            '2026-09-25 12:00:00+00:00', '20260925T120000+0000',
            '2026-W39-5T12:00:00+00:00', '2026-09-25T12:00:00,1+00:00',
            '2026-09-25T12:00:00+00:00:00', '2026-09-25T12:00:00.1+00:00:00.1',
        ):
            with self.subTest(stamp=stamp):
                with self.assertRaisesRegex(SSB14059PairTransportError, '^Malformed child response$'):
                    self.decode('metadata', stamp)

    def test_existing_minute_offset_decode_does_not_expand_capture_policy(self):
        instant = NOW + timedelta(microseconds=731927)
        for kind, parser in (('metadata', parse_captured_ssb_14059_metadata), ('data', parse_captured_ssb_14059)):
            capture = self.decode(kind, instant.astimezone(timezone(timedelta(hours=5, minutes=45))).isoformat())
            self.assertEqual(capture.retrieved_at, instant)
            self.assertEqual(capture.retrieved_at.utcoffset(), timedelta(hours=5, minutes=45))
            with self.assertRaises(SSB14059CaptureError):
                parser(capture)


if __name__ == '__main__':
    unittest.main()
