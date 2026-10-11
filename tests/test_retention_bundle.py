"""Actual isolated snapshot execution and tamper/extra-import refusals."""
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.verify_retention_bundle import FILES,verify
from scripts.prepare_raw_retention_bundle import service_text,TIMER

ROOT=Path(__file__).resolve().parents[1]

class RetentionBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.snapshot=Path(self.temp.name)/'snapshot';self.snapshot.mkdir(mode=0o700)
        for name in FILES:
            target=self.snapshot/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            target.write_bytes((ROOT/name).read_bytes());target.chmod(0o600)
        self.manifest={'schemaVersion':1,'files':{name:sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}}
        file=self.snapshot/'MANIFEST.json';file.write_text(json.dumps(self.manifest));file.chmod(0o600)

    def test_actual_snapshot_verifier_imports_only_bundled_source(self):
        self.assertTrue(verify(self.snapshot))
        result=subprocess.run([sys.executable,'-B','-E','-s','-m','scripts.verify_retention_bundle'],cwd=self.snapshot,env={},capture_output=True,timeout=2)
        self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,b'');self.assertEqual(result.stderr,b'')
        self.assertFalse(list(self.snapshot.rglob('__pycache__')))

    def test_changed_module_extra_module_symlink_and_public_permissions_refuse(self):
        target=self.snapshot/'workers/ssb_14059.py';original=target.read_bytes()
        target.write_bytes(original+b'\n# changed\n')
        with self.assertRaises(ValueError):verify(self.snapshot)
        target.write_bytes(original);target.chmod(0o644)
        with self.assertRaises(ValueError):verify(self.snapshot)
        target.chmod(0o600);extra=self.snapshot/'workers/other.py';extra.write_bytes(b'pass');extra.chmod(0o600)
        with self.assertRaises(ValueError):verify(self.snapshot)
        extra.unlink();(self.snapshot/'unexpected-directory').symlink_to(self.snapshot/'workers')
        with self.assertRaises(ValueError):verify(self.snapshot)

    def test_actual_frozen_cleanup_can_run_on_separate_owned_fixture_roots(self):
        raw=Path(self.temp.name)/'raw';health=Path(self.temp.name)/'health'
        code='from pathlib import Path;import json;from scripts.ssb_raw_retention_service import run_retention_once;print(json.dumps(run_retention_once(raw_root=Path('+repr(str(raw))+'),health_root=Path('+repr(str(health))+'))))'
        result=subprocess.run([sys.executable,'-B','-E','-s','-c',code],cwd=self.snapshot,env={},capture_output=True,timeout=2)
        self.assertEqual(result.returncode,0,result.stderr)
        outcome=json.loads(result.stdout);self.assertEqual(outcome['state'],'completed');self.assertEqual(outcome['attemptsRemoved'],0)
        self.assertEqual(outcome['sourceRequests'],0);self.assertFalse(outcome['databaseChanged'])

    def test_unit_is_fixed_unprivileged_private_network_cleanup_with_boot_and_periodic_trigger(self):
        unit=service_text(Path('/private/fixed-version'))
        self.assertIn('User=dj\n',unit);self.assertIn('PrivateNetwork=yes\n',unit)
        self.assertIn('CapabilityBoundingSet=\n',unit);self.assertIn('ProtectSystem=strict\n',unit)
        self.assertIn('scripts.verify_retention_bundle',unit);self.assertIn('scripts.ssb_raw_retention_service',unit)
        self.assertIn('OnBootSec=10s\n',TIMER);self.assertIn('OnCalendar=*-*-* *:00/15:00\n',TIMER)
        self.assertNotIn('fetch',unit);self.assertNotIn('github',unit.lower())

if __name__=='__main__':unittest.main()
