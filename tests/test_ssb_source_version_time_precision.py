"""Stored-source version identity cannot borrow a truncated timestamp."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import unittest

from workers.ssb_14059 import parse_ssb_14059, SSB14059ShapeError
from workers.ssb_14059_metadata import validate_ssb_14059_metadata, SSB14059MetadataError
from workers.ssb_14059_capture import (
    CapturedResponse, DATA_URL, METADATA_URL, SSB14059CaptureError,
    parse_captured_ssb_14059, parse_captured_ssb_14059_metadata,
    require_matching_metadata,
)


FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'
BASE = datetime(2026, 4, 30, 6, tzinfo=timezone.utc)


class SourceVersionTimePrecisionTests(unittest.TestCase):
    def payload(self, kind, stamp):
        name = 'ssb_14059_metadata_minimal_2024_2025.json' if kind == 'metadata' else 'ssb_14059_jsonstat_minimal_2024_2025.json'
        payload = json.loads((FIXTURES / name).read_bytes(), parse_float=Decimal)
        payload['updated'] = stamp
        return payload

    def parse(self, kind, stamp):
        payload = self.payload(kind, stamp)
        if kind == 'metadata':
            return validate_ssb_14059_metadata(payload).source_updated_at
        return parse_ssb_14059(payload)[0].source_updated_at

    def capture(self, kind, stamp, retrieved_at):
        payload = self.payload(kind, stamp)
        # Existing fixture values have one decimal; restore that JSON encoding
        # only for the pure captured-body envelope in this test.
        body = json.dumps(payload, default=lambda value: float(value) if isinstance(value, Decimal) else value).encode()
        url = METADATA_URL if kind == 'metadata' else DATA_URL
        capture = CapturedResponse(url, url, 0, 200, 'application/json', body, retrieved_at)
        parser = parse_captured_ssb_14059_metadata if kind == 'metadata' else parse_captured_ssb_14059
        return parser(capture)

    def test_both_source_parsers_refuse_unrepresentable_precision(self):
        for kind, error in (('metadata', SSB14059MetadataError), ('data', SSB14059ShapeError)):
            for fraction in ('0000001', '0000000', '7319271', '0' * 1000):
                with self.subTest(kind=kind, length=len(fraction)):
                    with self.assertRaises(error):
                        self.parse(kind, '2026-04-30T06:00:00.' + fraction + 'Z')

    def test_distinct_submicrosecond_source_versions_cannot_qualify_as_matching(self):
        retrieved_at = BASE + timedelta(days=1)
        with self.assertRaises(ValueError):
            metadata = self.capture('metadata', '2026-04-30T06:00:00.0000001Z', retrieved_at)
            data = self.capture('data', '2026-04-30T06:00:00.0000002Z', retrieved_at)
            require_matching_metadata(data, metadata)

    def test_supported_exact_utc_versions_preserve_instant_and_pair_identity(self):
        for fraction, microseconds in (('', 0), ('.0', 0), ('.000000', 0), ('.731927', 731927)):
            stamp = '2026-04-30T06:00:00' + fraction + 'Z'
            expected = BASE + timedelta(microseconds=microseconds)
            with self.subTest(fraction=fraction):
                self.assertEqual(self.parse('metadata', stamp), expected)
                self.assertEqual(self.parse('data', stamp), expected)
                metadata = self.capture('metadata', stamp, expected)
                data = self.capture('data', stamp, expected)
                require_matching_metadata(data, metadata)

    def test_exact_one_microsecond_version_drift_remains_held(self):
        metadata = self.capture('metadata', '2026-04-30T06:00:00.731927Z', BASE + timedelta(days=1))
        data = self.capture('data', '2026-04-30T06:00:00.731928Z', BASE + timedelta(days=1))
        self.assertNotEqual(data.source_updated_at, metadata.source_updated_at)
        with self.assertRaises(SSB14059CaptureError):
            require_matching_metadata(data, metadata)

    def test_lexically_future_source_update_cannot_borrow_retrieval_instant(self):
        for kind in ('metadata', 'data'):
            with self.subTest(kind=kind):
                with self.assertRaises(ValueError):
                    self.capture(kind, '2026-04-30T06:00:00.0000001Z', BASE)

    def test_existing_utc_z_policy_and_curated_errors_remain(self):
        for kind, error in (('metadata', SSB14059MetadataError), ('data', SSB14059ShapeError)):
            for stamp in ('2026-04-30T06:00:00+00:00', '2026-04-30T06:00:00+05:45', '2026-04-30T06:00:00', None, True):
                with self.subTest(kind=kind, stamp=stamp):
                    with self.assertRaises(error):
                        self.parse(kind, stamp)

    def test_unsupported_calendar_and_iso_syntax_refuse(self):
        for kind, error in (('metadata', SSB14059MetadataError), ('data', SSB14059ShapeError)):
            for stamp in (
                '2026-04-30 06:00:00Z', '20260430T060000Z', '2026-W18-4T06:00:00Z',
                '2026-04-30T06:00:00,1Z', '2026-02-30T06:00:00Z',
                '2026-04-30T06:00:60Z', '2026-04-30T06:00:00+00:00:00Z',
            ):
                with self.subTest(kind=kind, stamp=stamp):
                    with self.assertRaises(error):
                        self.parse(kind, stamp)

    def test_inexact_time_refusal_does_not_mutate_input_or_source_shape(self):
        for kind, parser in (('metadata', validate_ssb_14059_metadata), ('data', parse_ssb_14059)):
            payload = self.payload(kind, '2026-04-30T06:00:00.0000001Z')
            snapshot = repr(payload)
            with self.subTest(kind=kind):
                with self.assertRaises(ValueError):
                    parser(payload)
                self.assertEqual(repr(payload), snapshot)
                payload['updated'] = '2026-04-30T06:00:00Z'
                result = parser(payload)
                self.assertIsNotNone(result)


if __name__ == '__main__':
    unittest.main()
