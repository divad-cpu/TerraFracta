"""Exact parent/API review identity without candidate imports or launch."""
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import ssb_private_parent_inventory as parent
from scripts import prepare_private_parent_source as prepare

ROOT = Path(__file__).resolve().parents[1]


class PrivateParentInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = parent.runtime_record()
        cls.files = parent.source_bytes(ROOT)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        for name, raw in self.files.items():
            target = self.root/name; target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            for directory in target.parents:
                if directory == self.root: break
                directory.chmod(0o700)
            target.write_bytes(raw); target.chmod(0o600)
        with patch.object(parent, 'runtime_record', return_value=self.runtime): self.raw = parent.inventory(self.root)
        self.pin = sha256(self.raw).hexdigest()
        (self.root/'MANIFEST.json').write_bytes(self.raw); (self.root/'MANIFEST.json').chmod(0o600)

    def verify(self, pin=None):
        with patch.object(parent, 'runtime_record', return_value=self.runtime):
            return parent.verify(self.root, self.pin if pin is None else pin)

    def write_manifest(self, value):
        raw = parent._canonical(value); (self.root/'MANIFEST.json').write_bytes(raw)
        return sha256(raw).hexdigest()

    def test_actual_parent_backend_transaction_journal_and_v2_api_are_covered_without_authority(self):
        result = self.verify()
        for name in ('workers/private_collector_custodian.py', 'workers/private_pair_native_backend.py',
                     'workers/retained_native_transaction.py', 'workers/private_admission_journal.py', parent.API):
            self.assertIn(name, json.loads(self.raw)['files'])
        self.assertEqual(result['sourceRequests'], 0); self.assertFalse(result['candidateModulesImported'])
        self.assertFalse(result['workerExecuted']); self.assertFalse(result['completeRuntimeSealed'])
        for key, value in parent.CONTRACT.items():
            if key != 'purpose': self.assertIs(result[key], False)
        self.assertEqual(sha256(self.files[parent.API]).hexdigest(), parent.API_SHA256)

    def test_candidate_initialization_canary_never_executes_during_inventory_or_verify(self):
        sentinel = self.root/'candidate-initialization-canary'
        target = self.root/'workers/__init__.py'
        target.write_text(f'from pathlib import Path\nPath({str(sentinel)!r}).write_text("executed")\n')
        with patch.object(parent, 'runtime_record', return_value=self.runtime): raw = parent.inventory(self.root)
        (self.root/'MANIFEST.json').write_bytes(raw)
        self.verify(sha256(raw).hexdigest()); self.assertFalse(sentinel.exists())

    def test_changed_source_or_rewritten_manifest_cannot_pass_the_original_review_pin(self):
        target = self.root/'workers/private_pair_native_backend.py'; target.write_bytes(target.read_bytes()+b'\n# altered\n')
        with self.assertRaises(ValueError): self.verify()
        value = json.loads(self.raw); value['files'][str(target.relative_to(self.root))] = sha256(target.read_bytes()).hexdigest()
        self.write_manifest(value)
        with self.assertRaises(ValueError): self.verify()

    def test_roots_purpose_and_coerced_permission_fields_refuse_even_if_caller_pins_altered_manifest(self):
        for field in ('workerLaunchAllowed', 'sourcePermissionIssued', 'copyCoverageAccepted'):
            for replacement in (True, 0):
                value = json.loads(self.raw); value['contract'][field] = replacement
                with self.subTest(field=field, replacement=replacement), self.assertRaises(ValueError):
                    self.verify(self.write_manifest(value))
        value = json.loads(self.raw); value['roots'] = ['workers.closed_ssb_worker']
        with self.assertRaises(ValueError): self.verify(self.write_manifest(value))
        value = json.loads(self.raw); value['contract']['purpose'] = 'live_private_collector'
        with self.assertRaises(ValueError): self.verify(self.write_manifest(value))

    def test_missing_dynamic_relative_external_and_importlib_dependencies_refuse(self):
        target = self.root/'workers/private_collector_custodian.py'; original = target.read_bytes()
        for extra in (b'\nfrom . import hidden\n', b'\nimport requests\n', b'\n__import__("hidden")\n',
                      b'\nimport importlib\n', b'\nfrom workers import missing\n', b'\nfrom os import *\n'):
            target.write_bytes(original+extra)
            with self.subTest(extra=extra), self.assertRaises((ValueError, OSError)):
                parent.source_bytes(self.root)
        target.write_bytes(original)

    def test_unlisted_files_namespace_initializers_and_caches_refuse_before_their_body_is_read(self):
        read = parent._read
        for name in ('.env', 'scripts/__init__.py', 'workers/unlisted.py', 'workers/__pycache__/old.pyc'):
            target = self.root/name; target.parent.mkdir(mode=0o700, exist_ok=True)
            target.write_bytes(b'private-canary'); target.chmod(0o600)
            def refuse_extra(path, **kwargs):
                if path == target: raise AssertionError('Unexpected body opened')
                return read(path, **kwargs)
            with patch.object(parent, '_read', side_effect=refuse_extra), self.assertRaises(ValueError): self.verify()
            target.unlink()
            if target.parent.name == '__pycache__': target.parent.rmdir()

    def test_changed_import_cannot_open_an_unlisted_body_before_refusal(self):
        target = self.root/'workers/private_collector_custodian.py'
        target.write_bytes(target.read_bytes()+b'\nimport workers.private_canary\n')
        canary = self.root/'workers/private_canary.py'; canary.write_bytes(b'private-canary'); canary.chmod(0o600)
        read = parent._read
        def observe(path, **kwargs):
            if path == canary: raise AssertionError('Unlisted body opened')
            return read(path, **kwargs)
        with patch.object(parent, '_read', side_effect=observe), self.assertRaises(ValueError): self.verify()

    def test_changed_listed_body_on_later_reopen_cannot_retain_verified_identity(self):
        target = self.root/'workers/private_pair_native_backend.py'; original = target.read_bytes()
        read = parent._read; reads = 0
        def alter_before_reopen(path, **kwargs):
            nonlocal reads
            if path == target:
                reads += 1
                if reads == 2: target.write_bytes(original+b'\n# late replacement\n')
            return read(path, **kwargs)
        with patch.object(parent, '_read', side_effect=alter_before_reopen), self.assertRaises(ValueError): self.verify()
        self.assertEqual(reads, 2)

    def test_pinned_manifest_requiring_missing_dependency_refuses_before_unlisted_open(self):
        target = self.root/'workers/private_collector_custodian.py'
        target.write_bytes(target.read_bytes()+b'\nimport workers.private_canary\n')
        value = json.loads(self.raw); value['files']['workers/private_collector_custodian.py'] = sha256(target.read_bytes()).hexdigest()
        pin = self.write_manifest(value); read = parent._read
        def observe(path, **kwargs):
            if path.name == 'private_canary.py': raise AssertionError('Unlisted body opened')
            return read(path, **kwargs)
        with patch.object(parent, '_read', side_effect=observe), self.assertRaises(ValueError): self.verify(pin)

    def test_snapshot_links_nonprivate_modes_and_fifo_refuse_without_following(self):
        target = self.root/'workers/private_admission_journal.py'; original = target.read_bytes()
        target.unlink(); target.symlink_to(ROOT/'workers/private_admission_journal.py')
        with self.assertRaises((ValueError, OSError)): self.verify()
        target.unlink(); target.write_bytes(original); target.chmod(0o600)
        alias = self.root/'alias'; os.link(target, alias)
        with self.assertRaises(ValueError): self.verify()
        alias.unlink(); target.chmod(0o664)
        with self.assertRaises(ValueError): self.verify()
        target.chmod(0o600); fifo = self.root/'fifo'; os.mkfifo(fifo, 0o600)
        with self.assertRaises(ValueError): self.verify()

    def test_exact_api_and_interpreter_changes_are_held(self):
        api = self.root/parent.API; api.write_bytes(api.read_bytes()+b'\n-- altered\n')
        with self.assertRaises(ValueError): self.verify()
        api.write_bytes(self.files[parent.API])
        with patch.object(parent, 'runtime_record', return_value={**self.runtime, 'sha256':'0'*64}), self.assertRaises(ValueError):
            parent.verify(self.root, self.pin)

    def test_duplicate_nonfinite_noncanonical_and_oversize_manifest_are_refused(self):
        for raw in (self.raw.rstrip()[:-1]+b',"schemaVersion":1}', b'{"schemaVersion":NaN}',
                    json.dumps(json.loads(self.raw), indent=2).encode(), self.raw+b' '*32768):
            (self.root/'MANIFEST.json').write_bytes(raw)
            with self.subTest(size=len(raw)), self.assertRaises(ValueError): self.verify(sha256(raw).hexdigest())

    def test_fixed_preparer_rejects_arguments_before_source_read_or_directory_creation(self):
        with patch.object(prepare.sys, 'argv', ['prepare', '--root', 'private-canary']), patch.object(prepare, 'inventory') as inventory:
            with self.assertRaises(ValueError): prepare.main()
            inventory.assert_not_called()


if __name__ == '__main__': unittest.main()
