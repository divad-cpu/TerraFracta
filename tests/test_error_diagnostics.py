"""Actual invented local filesystem checks; no source/network/database use."""
from pathlib import Path
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from workers.error_diagnostics import diagnostic_worker, record_worker_error


class ErrorDiagnosticsTests(unittest.TestCase):
    def fixture(self):
        return Path(tempfile.mkdtemp(prefix='terrafracta-worker-error-test-')) / 'log'

    def test_private_closed_event(self):
        directory = self.fixture()
        self.assertTrue(record_worker_error('update_worker', directory=directory))
        file, = directory.iterdir()
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        event = json.loads(file.read_text())
        self.assertEqual(set(event), {'schemaVersion', 'eventId', 'occurredAt', 'origin', 'code'})
        self.assertEqual(event['origin'], 'worker')
        self.assertEqual(file.name, event['eventId'] + '.json')

    def test_failure_preserves_original_exception_without_reading_body(self):
        directory = self.fixture()
        original = RuntimeError('PRIVATE_CANARY')
        with self.assertRaises(RuntimeError) as caught:
            with diagnostic_worker('collector_worker', directory=directory):
                raise original
        self.assertIs(caught.exception, original)
        for file in directory.iterdir():
            self.assertNotIn('PRIVATE_CANARY', file.read_text())

    def test_logging_failure_does_not_replace_exception(self):
        directory = self.fixture()
        original = ValueError('PRIVATE_CANARY')
        with patch('workers.error_diagnostics.os.fsync', side_effect=OSError('PRIVATE_CANARY')):
            with self.assertRaises(ValueError) as caught:
                with diagnostic_worker('update_worker', directory=directory):
                    raise original
        self.assertIs(caught.exception, original)
        self.assertEqual(len(list(directory.iterdir())), 1)  # Failed write retained, no pruning.

    def test_disabled_mode_and_unknown_code_create_nothing(self):
        directory = self.fixture()
        self.assertFalse(record_worker_error('browser_runtime', directory=directory))
        self.assertFalse(directory.exists())
        with patch.dict(os.environ, {'NODE_ENV': 'production'}):
            self.assertFalse(record_worker_error('update_worker'))

    def test_insecure_and_symlinked_sink_refused(self):
        directory = self.fixture(); directory.mkdir(mode=0o755)
        self.assertFalse(record_worker_error('update_worker', directory=directory))
        alias = directory.parent / 'alias'; alias.symlink_to(directory)
        self.assertFalse(record_worker_error('update_worker', directory=alias))
        self.assertEqual(list(directory.iterdir()), [])

    def test_locked_and_capacity_full_preserved(self):
        directory = self.fixture(); directory.mkdir(mode=0o700)
        (directory / '.write-lock').mkdir(mode=0o700)
        self.assertFalse(record_worker_error('update_worker', directory=directory))
        full = self.fixture(); full.mkdir(mode=0o700)
        for i in range(1000):
            (full / str(i)).touch(mode=0o600)
        self.assertFalse(record_worker_error('update_worker', directory=full))
        self.assertEqual(len(list(full.iterdir())), 1000)


if __name__ == '__main__':
    unittest.main()
