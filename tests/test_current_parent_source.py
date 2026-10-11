from hashlib import sha256
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import inspect_current_parent_source as observer


class CurrentParentSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.file = self.root/'workers/parent.py'; self.file.parent.mkdir(mode=0o700)
        self.file.write_bytes(b'pass\n'); self.file.chmod(0o600)
        self.manifest = {'files': {'workers/parent.py': sha256(b'pass\n').hexdigest()}}

    def test_only_prepared_names_are_opened_and_changed_bytes_remain_changed(self):
        unlisted = self.root/'workers/private_canary.py'; unlisted.write_bytes(b'private-canary')
        read = observer._read; opened = []
        def observe(path, **kwargs):
            opened.append(path); self.assertNotEqual(path, unlisted); return read(path, **kwargs)
        with patch.object(observer, '_read', side_effect=observe):
            self.assertEqual(observer.compare_named_files(self.manifest, self.root),
                {'matchedFiles': 1, 'changedFiles': 0, 'unavailableFiles': 0})
            self.file.write_bytes(b'pass\n# changed\n')
            self.assertEqual(observer.compare_named_files(self.manifest, self.root),
                {'matchedFiles': 0, 'changedFiles': 1, 'unavailableFiles': 0})
        self.assertEqual(opened, [self.file, self.file])

    def test_missing_linked_world_writable_or_unstable_source_is_unavailable(self):
        original = self.file.read_bytes(); self.file.unlink()
        self.assertEqual(observer.compare_named_files(self.manifest, self.root)['unavailableFiles'], 1)
        outside = self.root/'outside'; outside.write_bytes(original); outside.chmod(0o600)
        self.file.symlink_to(outside)
        self.assertEqual(observer.compare_named_files(self.manifest, self.root)['unavailableFiles'], 1)
        self.file.unlink(); self.file.write_bytes(original); self.file.chmod(0o666)
        self.assertEqual(observer.compare_named_files(self.manifest, self.root)['unavailableFiles'], 1)
        with patch.object(observer, '_read', side_effect=ValueError('private instability')):
            self.assertEqual(observer.compare_named_files(self.manifest, self.root)['unavailableFiles'], 1)

    def test_the_exact_manifest_bytes_used_for_comparison_must_match_the_fixed_pin(self):
        record = {'private': 'redacted'}
        def read(path, **kwargs):
            return json.dumps(record).encode() if path.name == 'PREPARATION_RESULT.json' else b'{"files":{"private":"hidden"}}'
        with patch.object(observer, '_read', side_effect=read), patch.object(observer, 'verify', return_value={}), \
                patch.object(observer, 'build_snapshot', return_value={'recordedAt': '2026-10-03T13:40:22Z', 'sourceFiles': 85}), \
                patch.object(observer, 'compare_named_files') as compare:
            with self.assertRaises(ValueError): observer.observe()
            compare.assert_not_called()

    def test_failed_observation_exports_only_a_held_reason(self):
        output = io.StringIO()
        with patch.object(observer.sys, 'argv', ['inspect']), patch.object(observer.sys, 'stdout', output), \
                patch.object(observer, 'observe', side_effect=ValueError('private-canary-path')):
            self.assertEqual(observer.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {'state': 'held', 'reason': 'parent_source_comparison_unavailable'})
        self.assertNotIn('canary', output.getvalue())

    def test_selectors_refused_before_source_reads(self):
        with patch.object(observer.sys, 'argv', ['inspect', '--target', 'private-canary']), \
                patch.object(observer, 'observe') as observe:
            with self.assertRaises(ValueError): observer.main()
            observe.assert_not_called()


if __name__ == '__main__': unittest.main()
