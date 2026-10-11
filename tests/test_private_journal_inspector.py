"""Explicit read-only operator input, redaction and actual CLI restart reads."""
from datetime import timedelta
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from scripts import inspect_private_custodian_journal as inspector
from tests import test_private_custodian_journal as support
from workers.private_custodian_journal import START, FINISH


class PrivateJournalInspectorTests(unittest.TestCase):
    def setUp(self):
        self.fixture = support.PrivateCustodianJournalTests('test_start_is_private_reopened_and_missing_finish_remains_unknown')
        self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)

    def invoke(self, raw, *, arguments=(), tty=False, error=None):
        source = io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8'); output = io.StringIO()
        with patch.object(sys, 'argv', ['inspector', *arguments]), patch.object(sys, 'stdin', source), \
                patch.object(source, 'isatty', return_value=tty), patch.object(sys, 'stdout', output):
            if error is None: code = inspector.main()
            else:
                with patch.object(inspector, 'inspect', side_effect=error): code = inspector.main()
        return code, json.loads(output.getvalue()), source.buffer.tell()

    def test_missing_finish_is_redacted_historical_observation_without_any_write(self):
        start = self.fixture.start()
        result = inspector.inspect(self.fixture.journal, now=self.fixture.now)
        observed = result['observation']
        self.assertEqual(observed['state'], 'outcome_not_recorded'); self.assertFalse(observed['finishRecorded'])
        self.assertIsNone(observed['nativeCleanupConfirmed']); self.assertIsNone(observed['nativeProcessCalls'])
        text = json.dumps(result)
        for private in (str(self.fixture.journal), self.fixture.pin, sha256(start).hexdigest(), 'principal'):
            self.assertNotIn(private, text)
        self.assertEqual((self.fixture.journal/START).read_bytes(), start)
        self.assertEqual(set(path.name for path in self.fixture.journal.iterdir()), {START})

    def test_finished_observation_preserves_unknown_and_false_grants(self):
        start = self.fixture.start(); process = support.UnconfirmedProcess()
        self.fixture.client._active = process; self.fixture.client.cancel(); self.fixture.backend.closed = True
        self.fixture.finish(start); original = (self.fixture.journal/FINISH).read_bytes()
        try:
            process.returncode = -9; self.assertTrue(self.fixture.client.confirm_cleanup())
            report = inspector.inspect(self.fixture.journal, now=self.fixture.now)['observation']
            self.assertEqual(report['state'], 'local_cleanup_unconfirmed'); self.assertFalse(report['nativeCleanupConfirmed'])
            for key in ('automaticRetry', 'remoteWriteOutcomeVerified', 'sourcePermissionIssued', 'publicationEnabled',
                        'filesChanged', 'configurationChanged', 'liveLocationSelected'):
                self.assertIs(report[key], False)
            self.assertEqual((report['inspectorSourceRequests'], report['inspectorNativeQueries']), (0, 0))
            self.assertEqual((self.fixture.journal/FINISH).read_bytes(), original)
        finally: process.returncode = -9; self.fixture.client.confirm_cleanup()

    def test_explicit_stdin_path_succeeds_without_argument_or_default_location(self):
        self.fixture.start()
        code, value, consumed = self.invoke((str(self.fixture.journal)+'\n').encode())
        self.assertEqual(code, 0); self.assertEqual(value['state'], 'observed'); self.assertGreater(consumed, 0)
        for options in ({'arguments': ('private-selector-canary',)}, {'tty': True}):
            with self.subTest(options=options):
                code, value, consumed = self.invoke(b'private-input-canary\n', **options)
                self.assertEqual((code, value, consumed), (1, inspector.HELD, 0))

    def test_bad_or_oversized_input_does_not_dispatch_or_echo_private_input(self):
        values = (b'', b'relative', b'/a\n/b\n', b'/a\r\n', b'/a\0\n', b'/\xff\n', b'/' + b'a'*4096 + b'\n')
        for raw in values:
            with self.subTest(raw_size=len(raw)), patch.object(inspector, 'inspect') as observe:
                code, value, consumed = self.invoke(raw)
                self.assertEqual((code, value), (1, inspector.HELD)); self.assertLessEqual(consumed, 4097)
                observe.assert_not_called()

    def test_unsafe_directory_namespace_and_future_clock_are_held(self):
        self.fixture.start()
        for directory in (Path('relative'), self.fixture.base/'missing', self.fixture.journal/'..'):
            with self.subTest(directory=str(directory)), self.assertRaises(ValueError):
                inspector.inspect(directory, now=self.fixture.now)
        with self.assertRaises(ValueError): inspector.inspect(self.fixture.journal, now=self.fixture.now-timedelta(microseconds=1))
        (self.fixture.journal/'unrelated-canary').write_text('retained')
        code, value, _ = self.invoke((str(self.fixture.journal)+'\n').encode())
        self.assertEqual((code, value), (1, inspector.HELD))
        self.assertEqual((self.fixture.journal/'unrelated-canary').read_text(), 'retained')

    def test_exception_and_interruption_only_emit_fixed_held_report(self):
        for error, expected in ((OSError('private-path-clock-canary'), 1), (KeyboardInterrupt('private-canary'), 130)):
            with self.subTest(error=type(error).__name__):
                code, value, _ = self.invoke(b'/explicit/private/path\n', error=error)
                self.assertEqual((code, value), (expected, inspector.HELD))

    def test_unknown_reader_field_or_grant_is_not_exported(self):
        self.fixture.start()
        value = support.read_private_custodian_journal(self.fixture.journal)
        for changed in ({**value, 'untrustedPrivateBody': 'private-canary'}, {**value, 'sourcePermissionIssued': True}):
            with self.subTest(fields=len(changed)), patch.object(inspector, 'read_private_custodian_journal', return_value=changed):
                with self.assertRaises(ValueError): inspector.inspect(self.fixture.journal, now=self.fixture.now)

    def test_actual_cli_restart_reopens_same_bytes_without_database_or_source(self):
        start = self.fixture.start(); self.fixture.finish(start)
        before = {path.name: path.read_bytes() for path in self.fixture.journal.iterdir()}
        result = subprocess.run((sys.executable, '-B', '-E', '-s', '-m', 'scripts.inspect_private_custodian_journal'),
            cwd=Path(__file__).resolve().parents[1], input=(str(self.fixture.journal)+'\n').encode(),
            capture_output=True, env={}, close_fds=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr.decode()); self.assertEqual(result.stderr, b'')
        self.assertEqual(json.loads(result.stdout)['observation']['state'], 'failed_held')
        self.assertLess(len(result.stdout), 4096); self.assertNotIn(str(self.fixture.journal).encode(), result.stdout)
        self.assertEqual({path.name: path.read_bytes() for path in self.fixture.journal.iterdir()}, before)

    def test_failed_output_is_not_retried_and_does_not_raise_private_diagnostics(self):
        self.fixture.start()
        class Output(io.StringIO):
            calls = 0
            def write(self, value):
                self.calls += 1
                super().write(value[:5])
                raise OSError('private-output-canary')
        source = io.TextIOWrapper(io.BytesIO((str(self.fixture.journal)+'\n').encode()), encoding='utf-8')
        output, errors = Output(), io.StringIO()
        with patch.object(sys, 'argv', ['inspector']), patch.object(sys, 'stdin', source), \
                patch.object(source, 'isatty', return_value=False), patch.object(sys, 'stdout', output), \
                patch.object(sys, 'stderr', errors):
            self.assertEqual(inspector.main(), 1)
        self.assertEqual(output.calls, 1); self.assertEqual(errors.getvalue(), '')
        self.assertNotIn('canary', output.getvalue())

    def test_short_write_or_failed_flush_cannot_report_success(self):
        self.fixture.start()
        for fault in ('short', 'flush'):
            with self.subTest(fault=fault):
                class Output(io.StringIO):
                    calls = 0
                    def write(self, value):
                        self.calls += 1
                        return super().write(value[:5] if fault == 'short' else value)
                    def flush(self):
                        if fault == 'flush': raise OSError('private-flush-canary')
                source = io.TextIOWrapper(io.BytesIO((str(self.fixture.journal)+'\n').encode()), encoding='utf-8')
                output = Output()
                with patch.object(sys, 'argv', ['inspector']), patch.object(sys, 'stdin', source), \
                        patch.object(source, 'isatty', return_value=False), patch.object(sys, 'stdout', output):
                    self.assertEqual(inspector.main(), 1)
                self.assertEqual(output.calls, 1); self.assertNotIn('canary', output.getvalue())


if __name__ == '__main__': unittest.main()
