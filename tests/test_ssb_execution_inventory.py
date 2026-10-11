"""Source/interpreter inventory integrity without running a collector."""
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from scripts.ssb_execution_inventory import ROOTS, closure, inventory, verify, runtime_record, CONTRACT
from scripts import ssb_execution_inventory as shared

ROOT=Path(__file__).resolve().parents[1]


class ExecutionInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.root.chmod(0o700)
        self.runtime=runtime_record()
        with patch('scripts.ssb_execution_inventory.runtime_record',return_value=self.runtime):self.raw=inventory(ROOT)
        self.payload=json.loads(self.raw);self.fingerprint=sha256(self.raw).hexdigest()
        for name in self.payload['files']:
            target=self.root/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            target.parent.chmod(0o700);target.write_bytes((ROOT/name).read_bytes());target.chmod(0o600)
        (self.root/'MANIFEST.json').write_bytes(self.raw);(self.root/'MANIFEST.json').chmod(0o600)

    def check(self):
        with patch('scripts.ssb_execution_inventory.runtime_record',return_value=self.runtime):return verify(self.root,self.fingerprint)

    def test_fixed_closure_and_contract_reopen_exactly_without_execution(self):
        from workers.ssb_14059_capture import METADATA_URL,DATA_URL,MAX_RESPONSE_BYTES
        from workers.ssb_14059_pair_transport import PAIR_DEADLINE_SECONDS
        self.assertEqual((CONTRACT['metadataUrl'],CONTRACT['dataUrl'],CONTRACT['maxBodyBytes'],CONTRACT['sharedDeadlineSeconds']),
                         (METADATA_URL,DATA_URL,MAX_RESPONSE_BYTES,PAIR_DEADLINE_SECONDS))
        result=self.check()
        self.assertEqual(set(self.payload['roots']),set(ROOTS))
        self.assertIn('workers/ssb_14059_transport.py',self.payload['files'])
        self.assertIn('workers/closed_ssb_worker.py',self.payload['files'])
        self.assertNotIn('scripts/paired_channel_fixture_child.py',self.payload['files'])
        self.assertFalse(result['workerExecuted']);self.assertFalse(result['completeRuntimeSealed'])
        self.assertFalse(self.payload['contract']['publicationEnabled'])
        self.assertFalse(self.payload['contract']['scheduleEnabled'])
        self.assertEqual(self.payload['interpreter']['inventoryScope'],
                         'interpreter_binary_and_version_only; standard_library_loader_and_os_not_sealed')

    def test_changed_source_is_not_accepted_by_rewriting_its_manifest_hash(self):
        path=self.root/'workers/closed_ssb_worker.py';path.write_bytes(path.read_bytes()+b'\n# changed\n')
        with self.assertRaisesRegex(ValueError,'bytes changed'):self.check()
        altered=json.loads(self.raw);altered['files']['workers/closed_ssb_worker.py']=sha256(path.read_bytes()).hexdigest()
        (self.root/'MANIFEST.json').write_text(json.dumps(altered))
        with self.assertRaisesRegex(ValueError,'identity changed'):self.check()

    def test_unlisted_module_cache_and_hidden_file_are_refused(self):
        for name in ('workers/unlisted.py','workers/__pycache__/stale.pyc','.env'):
            target=self.root/name;target.parent.mkdir(mode=0o700,exist_ok=True);target.write_bytes(b'private-canary');target.chmod(0o600)
            with self.subTest(name=name),self.assertRaises(ValueError):self.check()
            target.unlink()
            if target.parent.name=='__pycache__':target.parent.rmdir()

    def test_mutated_import_never_opens_an_unlisted_body_before_refusal(self):
        target=self.root/'workers/closed_ssb_worker.py';target.write_bytes(target.read_bytes()+b'\nimport workers.private_canary\n')
        canary=self.root/'workers/private_canary.py';canary.write_bytes(b'private-canary');canary.chmod(0o600)
        read=Path.read_bytes
        def refuse_canary(path):
            if path==canary:raise AssertionError('Unlisted private body opened')
            return read(path)
        with patch.object(Path,'read_bytes',refuse_canary),self.assertRaises(ValueError):self.check()

    def test_source_drift_during_interpreter_observation_cannot_be_verified(self):
        target=self.root/'workers/closed_ssb_worker.py';original=target.read_bytes()
        def change_source():
            target.write_bytes(original+b'\n# changed during interpreter observation\n');return self.runtime
        with patch.object(shared,'runtime_record',side_effect=change_source),self.assertRaisesRegex(ValueError,'bytes changed'):
            verify(self.root,self.fingerprint)

    def test_numeric_boolean_contract_cannot_be_accepted_even_under_its_new_pin(self):
        payload=json.loads(self.raw);payload['contract']['publicationEnabled']=0
        raw=json.dumps(payload).encode();(self.root/'MANIFEST.json').write_bytes(raw)
        with patch.object(shared,'runtime_record',return_value=self.runtime),self.assertRaises(ValueError):
            verify(self.root,sha256(raw).hexdigest())

    def test_source_symlink_or_hardlink_and_nonprivate_permissions_are_refused(self):
        target=self.root/'workers/closed_ssb_worker.py';data=target.read_bytes()
        target.unlink();target.symlink_to(ROOT/'workers/closed_ssb_worker.py')
        with self.assertRaises(ValueError):self.check()
        target.unlink();target.write_bytes(data);target.chmod(0o600)
        extra=self.root/'hardlinked.py';os.link(target,extra)
        with self.assertRaises(ValueError):self.check()
        extra.unlink();target.chmod(0o644)
        with self.assertRaises(ValueError):self.check()

    def test_linked_worker_directory_refuses_before_hashing_outside_root(self):
        shutil.rmtree(self.root/'workers');(self.root/'workers').symlink_to(ROOT/'workers',target_is_directory=True)
        with self.assertRaises(ValueError):self.check()

    def test_interpreter_change_or_false_runtime_version_is_held(self):
        for change in ({'sha256':'0'*64},{'version':'3.12.0 changed'}, {'resolvedPath':'/tmp/other-interpreter'}):
            with self.subTest(change=change),patch('scripts.ssb_execution_inventory.runtime_record',return_value={**self.runtime,**change}):
                with self.assertRaisesRegex(ValueError,'interpreter changed'):verify(self.root,self.fingerprint)

    def test_unsupported_relative_dynamic_or_external_imports_are_not_guessed(self):
        target=self.root/'workers/closed_ssb_worker.py';original=target.read_bytes()
        for extra in (b'\nfrom . import hidden\n',b'\nimport requests\n',b'\n__import__("hidden")\n',b'\nimport importlib\n'):
            target.write_bytes(original+extra)
            with self.subTest(extra=extra),self.assertRaises(ValueError):closure(self.root)
        target.write_bytes(original)

    def test_manifest_duplicate_nonfinite_extra_and_oversize_fail_pinned_identity(self):
        for raw in (self.raw.rstrip()[:-1]+b',"schemaVersion":1}',b'{"schemaVersion":NaN}',self.raw+b'x'*32768):
            (self.root/'MANIFEST.json').write_bytes(raw)
            with self.subTest(size=len(raw)),self.assertRaises(ValueError):self.check()
        (self.root/'MANIFEST.json').write_bytes(self.raw)
        for fingerprint in (None,True,'a'*63,'A'*64):
            with self.subTest(fingerprint=fingerprint),self.assertRaises(ValueError):verify(self.root,fingerprint)

    def test_actual_frozen_verifier_only_checks_source_and_interpreter(self):
        snapshot=self.root.parent/self.fingerprint
        # Temporary destination is fresh; originals remain until test cleanup.
        self.assertFalse(snapshot.exists());shutil.copytree(self.root,snapshot)
        self.addCleanup(shutil.rmtree,snapshot)
        result=subprocess.run(['/usr/bin/python3.12','-B','-E','-s','-m','scripts.ssb_execution_inventory'],
            cwd=snapshot,env={},capture_output=True,timeout=3,check=False)
        self.assertEqual(result.returncode,0,result.stderr)
        output=json.loads(result.stdout)
        self.assertEqual(output['fingerprint'],self.fingerprint)
        self.assertFalse(output['workerExecuted']);self.assertEqual(output['sourceRequests'],0)
        self.assertFalse(list(snapshot.rglob('__pycache__')))

    def test_actual_verifier_never_imports_modified_candidate_worker_initialization(self):
        initializer=self.root/'workers/__init__.py'
        initializer.write_text('raise RuntimeError("private-worker-initialization-canary")\n')
        snapshot=self.root.parent/self.fingerprint
        self.assertFalse(snapshot.exists());shutil.copytree(self.root,snapshot)
        self.addCleanup(shutil.rmtree,snapshot)
        result=subprocess.run(['/usr/bin/python3.12','-B','-E','-s','-m','scripts.ssb_execution_inventory'],
            cwd=snapshot,env={},capture_output=True,timeout=3,check=False)
        self.assertEqual(result.returncode,1)
        self.assertEqual(result.stdout,b'')
        self.assertEqual(result.stderr,b'Private SSB source inventory verification blocked.\n')
        self.assertNotIn(b'private-worker-initialization-canary',result.stderr)


if __name__=='__main__':unittest.main()
