"""Invalid elapsed time cannot grant private fixture-body read access."""
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
import unittest
from unittest.mock import patch
from tests import test_ssb_14059_raw_custody as support
from workers.ssb_14059_raw_custody import PrivateRawCustody, PrivateRawCustodyError

BAD = (float('nan'), float('inf'), float('-inf'), True, None, '0', 10 ** 1000)


class RawReaderClockTests(unittest.TestCase):
    def prepare(self):
        fixture = support.PrivateRawCustodyTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        custody = PrivateRawCustody(fixture.root, utc_now=lambda: fixture.now)
        custody.__enter__()
        self.addCleanup(lambda: custody.__exit__(None, None, None))
        saved = custody.store(*fixture.responses, now=fixture.now)
        before = {p.name: sha256(p.read_bytes()).hexdigest() for p in saved.directory.iterdir()}
        return fixture, custody, saved, before

    def preserved(self, saved, before):
        self.assertEqual({p.name: sha256(p.read_bytes()).hexdigest() for p in saved.directory.iterdir()}, before)

    def test_invalid_initial_tick_refuses_without_opening_any_raw_body(self):
        for value in BAD:
            fixture, custody, saved, before = self.prepare()
            with self.subTest(value=repr(value)), patch('workers.ssb_14059_raw_custody.monotonic', return_value=value), \
                    patch.object(Path, 'read_bytes', side_effect=AssertionError('No private body open')):
                with self.assertRaises(PrivateRawCustodyError):
                    custody.read(saved.attempt_id, now=fixture.now)
            self.preserved(saved, before)

    def test_invalid_tick_after_manifest_preflight_refuses_before_either_body(self):
        for value in BAD:
            fixture, custody, saved, before = self.prepare()
            ticks = iter([0] + [value] * 10)
            with self.subTest(value=repr(value)), patch('workers.ssb_14059_raw_custody.monotonic', side_effect=lambda: next(ticks)), \
                    patch.object(Path, 'read_bytes', side_effect=AssertionError('No private body open')):
                with self.assertRaises(PrivateRawCustodyError):
                    custody.read(saved.attempt_id, now=fixture.now)
            self.preserved(saved, before)

    def test_backwards_after_metadata_read_withholds_data_and_preserves_stored_evidence(self):
        fixture, custody, saved, before = self.prepare()
        tick = [10]
        opened = []
        native = Path.read_bytes
        def read(path, *args, **kwargs):
            opened.append(path.name)
            result = native(path, *args, **kwargs)
            tick[0] = 9
            return result
        with patch('workers.ssb_14059_raw_custody.monotonic', side_effect=lambda: tick[0]), patch.object(Path, 'read_bytes', read):
            with self.assertRaises(PrivateRawCustodyError):
                custody.read(saved.attempt_id, now=fixture.now)
        self.assertEqual(opened, ['metadata.json'])
        self.preserved(saved, before)

    def test_exact_large_origin_cannot_round_ten_second_expiry_to_sixteen(self):
        fixture, custody, saved, before = self.prepare()
        observation = saved.expires_at - timedelta(seconds=10)
        ticks = iter([float(2 ** 56)] + [2 ** 56 + 11] * 10)
        with patch('workers.ssb_14059_raw_custody.monotonic', side_effect=lambda: next(ticks)), \
                patch.object(Path, 'read_bytes', side_effect=AssertionError('No expired private body open')):
            with self.assertRaises(PrivateRawCustodyError):
                custody.read(saved.attempt_id, now=observation)
        self.preserved(saved, before)

    def test_invalid_final_tick_returns_no_pair_and_preserves_both_bodies(self):
        fixture, custody, saved, before = self.prepare()
        tick = [0]
        opened = []
        native = Path.read_bytes
        def read(path, *args, **kwargs):
            opened.append(path.name)
            result = native(path, *args, **kwargs)
            if path.name == 'data.json':
                tick[0] = float('nan')
            return result
        with patch('workers.ssb_14059_raw_custody.monotonic', side_effect=lambda: tick[0]), patch.object(Path, 'read_bytes', read):
            with self.assertRaises(PrivateRawCustodyError):
                custody.read(saved.attempt_id, now=fixture.now)
        self.assertEqual(opened, ['metadata.json', 'data.json'])
        self.preserved(saved, before)

    def test_timely_negative_integer_and_fractional_ticks_keep_exact_saved_identity(self):
        for origin in (0, -5, 0.5, -0.5):
            fixture, custody, saved, before = self.prepare()
            with self.subTest(origin=origin), patch('workers.ssb_14059_raw_custody.monotonic', return_value=origin):
                result = custody.read(saved.attempt_id, now=fixture.now)
            self.assertEqual(result.metadata_response, fixture.responses[0])
            self.assertEqual(result.data_response, fixture.responses[1])
            self.assertEqual(result.expires_at, saved.expires_at)
            self.preserved(saved, before)


if __name__ == '__main__':
    unittest.main()
