"""The private timestamp grammar admits exact, bounded datetime values only."""
from datetime import datetime, timedelta, timezone
import unittest

from workers.exact_timestamp import parse_exact_timestamp


class ExactTimestampTests(unittest.TestCase):
    def test_fractional_places_preserve_each_exact_microsecond_value(self):
        for digits in ("", "1", "12", "123", "1234", "12345", "123456", "000001", "999999"):
            for offset in ("Z", "+00:00", "-00:00", "+05:30", "-12:45", "+23:59", "-23:59"):
                with self.subTest(digits=digits, offset=offset):
                    value = "2026-10-09T08:00:00" + ("." + digits if digits else "") + offset
                    parsed = parse_exact_timestamp(value)
                    self.assertEqual(parsed.microsecond, int(digits.ljust(6, "0")) if digits else 0)
                    self.assertEqual(parsed, datetime.fromisoformat(value))

    def test_calendar_edges_and_supported_leap_day_remain_exact(self):
        for value in ("0001-01-01T00:00:00Z", "9999-12-31T23:59:59.999999Z",
                      "2000-02-29T12:34:56Z", "2024-02-29T00:00:00+00:00"):
            with self.subTest(value=value):
                self.assertEqual(parse_exact_timestamp(value), datetime.fromisoformat(value))

    def test_minute_offsets_are_preserved_for_the_callers_own_policy(self):
        parsed = parse_exact_timestamp("2026-10-09T10:00:00.000001+02:00")
        self.assertEqual(parsed.utcoffset(), timedelta(hours=2))
        self.assertEqual(parsed.astimezone(timezone.utc),
                         datetime(2026, 10, 9, 8, 0, 0, 1, tzinfo=timezone.utc))

    def test_more_than_six_places_are_refused_even_when_the_excess_is_zero(self):
        for digits in ("0000000", "0000001", "1234560", "9999999", "0" * 10000):
            for offset in ("Z", "+00:00"):
                with self.subTest(digits=len(digits), offset=offset), self.assertRaises(ValueError):
                    parse_exact_timestamp("2026-10-09T08:00:00." + digits + offset)

    def test_unsupported_iso_forms_are_not_silently_normalized(self):
        for value in ("2026-10-09 08:00:00Z", "2026-10-09t08:00:00Z",
                      "20261009T080000Z", "2026-W41-5T08:00:00Z",
                      "2026-10-09T08:00Z", "2026-10-09T08:00:00",
                      "2026-10-09T08:00:00,1Z", "2026-10-09T08:00:00+0000",
                      "2026-10-09T08:00:00+00:00:01",
                      "2026-10-09T08:00:00+00:00:00.1",
                      "2026-10-09T08:00:00Z\n", " 2026-10-09T08:00:00Z",
                      "２０２６-10-09T08:00:00Z", "2026-10-09T08:00:00z"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_exact_timestamp(value)

    def test_invalid_calendar_time_and_offset_fields_are_refused(self):
        for value in ("0000-01-01T00:00:00Z", "1900-02-29T00:00:00Z",
                      "2026-13-01T00:00:00Z", "2026-10-32T00:00:00Z",
                      "2026-10-09T24:00:00Z", "2026-10-09T08:60:00Z",
                      "2026-10-09T08:00:60Z", "2026-10-09T08:00:00+24:00",
                      "2026-10-09T08:00:00+00:60", "2026-10-09T08:00:00-01:99"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_exact_timestamp(value)

    def test_non_string_values_and_unbounded_inputs_refuse(self):
        class StringSubclass(str):
            pass
        for value in (None, True, 123, b"2026-10-09T08:00:00Z", [], {},
                      StringSubclass("2026-10-09T08:00:00Z"), "x" * 100000):
            with self.subTest(type=type(value).__name__), self.assertRaises(ValueError):
                parse_exact_timestamp(value)


if __name__ == "__main__":
    unittest.main()
