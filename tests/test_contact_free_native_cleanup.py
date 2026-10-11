"""Actual runner failure boundary with a fake subprocess port; no Docker runs."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/check_contact_free_custody_native.py'


class NativeClosureBoundary(unittest.TestCase):
    def probe(self, failure):
        spec = importlib.util.spec_from_file_location('contact_free_native_probe', SOURCE)
        module = importlib.util.module_from_spec(spec)
        with patch.object(sys, 'path', [str(SOURCE.parent), *sys.path]):
            spec.loader.exec_module(module)
        calls = []
        ownership = {}
        inspection_count = 0

        def fake(args, **kwargs):
            nonlocal inspection_count
            self.assertEqual(kwargs['env'], {'PATH': '/usr/bin:/bin'})
            if args[0] == 'docker':
                self.assertEqual(args[:3], ['docker', '--host', 'unix:///var/run/docker.sock'])
                args = [args[0], *args[3:]]
            calls.append(args)
            if args[:3] == ['docker', 'image', 'inspect']:
                return subprocess.CompletedProcess(args, 0, json.dumps(module.IMAGE), '')
            if args[:3] == ['docker', 'container', 'inspect']:
                if failure == 'absence_timeout':
                    raise subprocess.TimeoutExpired(args, kwargs['timeout'])
                return subprocess.CompletedProcess(args, 1, '', 'No such object: ' + args[3])
            if args[:2] == ['docker', 'run']:
                label = args[args.index('--label') + 1].split('=', 1)
                ownership.update(image=module.IMAGE, labels={label[0]: label[1]}, running=True)
                return subprocess.CompletedProcess(args, 0, 'invented-container-ack', '')
            if args[:2] == ['docker', 'inspect']:
                inspection_count += 1
                if inspection_count == 1 or failure == 'cleanup_timeout':
                    raise subprocess.TimeoutExpired(args, kwargs['timeout'], output='PRIVATE_TIMEOUT_CANARY')
                if failure == 'malformed_cleanup':
                    return subprocess.CompletedProcess(args, 0, 'PRIVATE_JSON_CANARY', '')
                if failure == 'foreign_cleanup':
                    return subprocess.CompletedProcess(args, 0, json.dumps({**ownership, 'labels': {'foreign': 'fixture'}}), '')
                if failure.startswith('invalid_running:'):
                    invalid = json.loads(failure.split(':', 1)[1])
                    return subprocess.CompletedProcess(args, 0, json.dumps({**ownership, 'running': invalid}), '')
                if failure == 'extra_cleanup':
                    return subprocess.CompletedProcess(args, 0, json.dumps({**ownership, 'extra': 'PRIVATE_EXTRA_CANARY'}), '')
                return subprocess.CompletedProcess(args, 0, json.dumps(ownership), '')
            if args[:2] == ['docker', 'stop']:
                raise subprocess.TimeoutExpired(args, kwargs['timeout'], stderr='PRIVATE_STOP_CANARY')
            raise AssertionError('Unexpected fake command')

        output = io.StringIO()
        with patch.object(sys, 'argv', ['fixed-native-trial']), patch.object(module.subprocess, 'run', side_effect=fake), redirect_stdout(output):
            with self.assertRaises((AssertionError, RuntimeError)):
                module.main()
        summary = json.loads(output.getvalue())
        proof = Path(summary['privateEvidenceDirectory'])
        result = json.loads((proof / 'RESULT.json').read_text())
        synthetic = {'syntheticOnly': True, 'actualDockerCommands': 0, 'fault': failure,
                     'source': str(SOURCE), 'proof': str(proof), 'interceptedCommands': len(calls)}
        (proof / 'SYNTHETIC_FAULT_PROBE.json').write_text(json.dumps(synthetic, indent=2) + '\n')
        self.assertFalse(result['completed'])
        self.assertFalse(result['stopped'])
        self.assertTrue(any(command['timedOut'] for command in result['commands']))
        self.assertNotIn('PRIVATE_', (proof / 'RESULT.json').read_text())
        for receipt in proof.glob('*-command.json'):
            self.assertNotIn('PRIVATE_', receipt.read_text())
        if failure == 'absence_timeout':
            self.assertEqual(result['cleanupState'], 'not_started')
            self.assertFalse(any(args[:2] == ['docker', 'run'] for args in calls))
        else:
            self.assertEqual(result['cleanupState'], 'unknown')
        if failure in ('malformed_cleanup', 'foreign_cleanup', 'cleanup_timeout', 'extra_cleanup') or failure.startswith('invalid_running:'):
            self.assertFalse(any(args[:2] == ['docker', 'stop'] for args in calls))
        return result

    def test_uncertain_absence_never_starts_a_cluster(self):
        self.probe('absence_timeout')

    def test_cleanup_inspection_timeout_preserves_uncertainty(self):
        self.probe('cleanup_timeout')

    def test_stop_timeout_cannot_claim_stopped(self):
        self.probe('stop_timeout')

    def test_malformed_cleanup_reply_preserves_receipt(self):
        result = self.probe('malformed_cleanup')
        self.assertTrue(result['cleanupError'])

    def test_foreign_identity_never_authorizes_stop(self):
        self.probe('foreign_cleanup')

    def test_invalid_running_types_cannot_authorize_stop_or_claim_stopped(self):
        for value in ['null', '0', '1', '""', '"false"', '[]', '{}']:
            with self.subTest(value=value):
                self.probe('invalid_running:' + value)

    def test_extra_cleanup_fields_do_not_supply_closed_ownership(self):
        self.probe('extra_cleanup')


if __name__ == '__main__':
    unittest.main()
