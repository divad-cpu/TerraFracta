"""Shared trial logger only, with constructor/process/communication bypasses."""
import ast
import importlib
import json
from hashlib import sha256
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class FeedTrialInspectLoggingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('Import started native process')), \
             patch.object(subprocess, 'run', side_effect=AssertionError('Import dispatched native process')):
            cls.module = importlib.import_module('scripts.rehearse_postgres_feed_journal')

    def trial(self, directory):
        # Never call __init__: no real tool paths, environment, source freeze,
        # Docker configuration, native targets or process are discovered.
        trial = self.module.FreshFeedPostgres.__new__(self.module.FreshFeedPostgres)
        trial.proof = Path(directory)
        trial.counter = 0
        trial.docker = ['/usr/bin/docker', '--host', 'unix:///fictional-closed-socket']
        trial.environment = {'PATH': '/fictional/tools', 'LC_ALL': 'C.UTF-8'}
        return trial

    def run_mocked(self, trial, command, result, *, payload=b'', allowed=False, callback=None):
        process = object()
        def make(*args, **kwargs):
            if callback: callback()
            return process
        with patch.object(self.module.subprocess, 'Popen', side_effect=make) as popen, \
             patch.object(self.module, 'communicate_bounded', return_value=result) as communicate:
            if result.returncode and not allowed:
                with self.assertRaises(self.module.FeedPgTrialError): trial.run(command, payload=payload, timeout=7, allowed=allowed)
            else:
                self.assertIs(trial.run(command, payload=payload, timeout=7, allowed=allowed), result)
            self.assertEqual(communicate.call_args.args, (process, payload))
            self.assertEqual(communicate.call_args.kwargs, {'timeout': 7, 'max_input': 294912, 'max_stdout': 131072, 'max_stderr': 4096})
            self.assertIs(popen.call_args.kwargs['env'], trial.environment)
            self.assertEqual(popen.call_args.args[0][:3], trial.docker)
            self.assertEqual(trial.counter, 1)
        return {path.name: path.read_bytes() for path in trial.proof.iterdir()}

    def test_shared_inspect_logger_does_not_persist_body_stderr_or_input_canaries(self):
        with tempfile.TemporaryDirectory() as directory:
            trial = self.trial(directory)
            output = SimpleNamespace(stdout=b'{"Other":"fictional-stdout-canary"}\nfictional-trailer-canary',
                                     stderr=b'fictional-stderr-canary', returncode=0)
            files = self.run_mocked(trial, ['docker', 'inspect', 'fictional-private-target'], output, payload=b'fictional-input-canary')
            for raw in files.values(): self.assertNotIn(b'canary', raw)
            self.assertNotIn('001_input.sql', files)
            record = json.loads(files['001_COMMAND.json'])
            self.assertEqual(record, {'evidenceKind': 'docker_inspect_command_result', 'objectKind': 'object',
                'exitCode': 0, 'stdoutRetained': False, 'stderrRetained': False, 'metadataRetained': False})
            self.assertNotIn(b'fictional-private-target', files['001_COMMAND.json'])
            for name in ('001_stdout.txt', '001_stderr.txt'): self.assertEqual(files[name], b'<omitted>\n')
            for path in trial.proof.iterdir(): self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_original_command_classification_survives_process_callback_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            trial = self.trial(directory)
            command = ['docker', 'container', 'inspect', 'fictional']
            result = SimpleNamespace(stdout=b'fictional-canary', stderr=b'fictional-error-canary', returncode=0)
            files = self.run_mocked(trial, command, result, callback=lambda: command.__setitem__(slice(None), ['docker', 'exec', 'fictional']))
            self.assertEqual(json.loads(files['001_COMMAND.json'])['objectKind'], 'container')
            for raw in files.values(): self.assertNotIn(b'canary', raw)

    def test_container_image_volume_and_nonzero_inspect_results_keep_exit_and_return_semantics(self):
        for kind in ('container', 'image', 'volume'):
            for code, allowed in ((0, False), (17, True), (17, False), (-9, True)):
                with self.subTest(kind=kind, code=code), tempfile.TemporaryDirectory() as directory:
                    trial = self.trial(directory)
                    result = SimpleNamespace(stdout=b'\xfffictional-canary', stderr=b'\xfffictional-error-canary', returncode=code)
                    files = self.run_mocked(trial, ['docker', kind, 'inspect', 'fictional'], result, allowed=allowed)
                    record = json.loads(files['001_COMMAND.json'])
                    self.assertEqual(record['objectKind'], kind); self.assertEqual(record['exitCode'], code)
                    for raw in files.values(): self.assertNotIn(b'canary', raw)

    def test_inspect_logging_does_not_observe_output_for_sizes_or_content(self):
        class NoOutput:
            returncode = 0
            @property
            def stdout(self): raise AssertionError('Inspect stdout observed for logging')
            @property
            def stderr(self): raise AssertionError('Inspect stderr observed for logging')
        with tempfile.TemporaryDirectory() as directory:
            files = self.run_mocked(self.trial(directory), ['docker', 'inspect', 'fictional'], NoOutput())
            self.assertFalse(json.loads(files['001_COMMAND.json'])['metadataRetained'])

    def test_ordinary_sql_input_command_and_output_bytes_keep_the_original_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            trial = self.trial(directory)
            command = ['docker', 'exec', '-i', 'fictional', 'psql']
            payload = b'select 1;\n'
            result = SimpleNamespace(stdout=b'1\n', stderr=b'ordinary fictional notice\n', returncode=0)
            files = self.run_mocked(trial, command, result, payload=payload)
            self.assertEqual(files['001_input.sql'], payload)
            self.assertEqual(files['001_stdout.txt'], result.stdout)
            self.assertEqual(files['001_stderr.txt'], result.stderr)
            self.assertEqual(json.loads(files['001_COMMAND.json']), {'argv': trial.docker + command[1:], 'returncode': 0,
                'stdoutBytes': 2, 'stderrBytes': len(result.stderr), 'inputBytes': len(payload), 'inputSHA256': sha256(payload).hexdigest()})

    def test_preexisting_command_evidence_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            trial = self.trial(directory)
            path = trial.proof / '001_COMMAND.json'; path.write_bytes(b'preserved evidence'); path.chmod(0o600)
            result = SimpleNamespace(stdout=b'fictional-canary', stderr=b'fictional-error-canary', returncode=0)
            with patch.object(self.module.subprocess, 'Popen', return_value=object()), \
                 patch.object(self.module, 'communicate_bounded', return_value=result), self.assertRaises(FileExistsError):
                trial.run(['docker', 'inspect', 'fictional'])
            self.assertEqual(path.read_bytes(), b'preserved evidence')
            self.assertEqual(sorted(p.name for p in trial.proof.iterdir()), ['001_COMMAND.json'])

    def test_shared_logger_import_is_in_the_existing_recursive_source_freeze_closure(self):
        path = Path(self.module.__file__)
        modules = {node.module for node in ast.walk(ast.parse(path.read_bytes())) if isinstance(node, ast.ImportFrom)}
        self.assertIn('scripts.docker_inspect_command_log', modules)
        self.assertTrue((path.parent / 'docker_inspect_command_log.py').is_file())

if __name__ == '__main__': unittest.main()
