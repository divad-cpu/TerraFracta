from pathlib import Path
import tempfile
import unittest
from scripts.check_connected_capture_copy import ROOT,SOURCE,MIGRATION,check_artifacts
class ConnectedCaptureCopyTests(unittest.TestCase):
    def prepare(self,root):
        for name in (SOURCE,MIGRATION):
            target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((ROOT/name).read_bytes())
    def test_approved_exact_copy(self):check_artifacts()
    def test_unreviewed_runtime_grant_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root);target=root/MIGRATION
            target.write_bytes(target.read_bytes()+b'grant insert on terra_private.source_pair_run_bindings to service_role;\n')
            with self.assertRaisesRegex(ValueError,'Migration 30 differs'):check_artifacts(root)
    def test_substituting_both_source_and_migration_does_not_replace_consent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root)
            for name in (SOURCE,MIGRATION):
                target=root/name;target.write_bytes(target.read_bytes()+b'-- unreviewed substitution\n')
            with self.assertRaisesRegex(ValueError,'fingerprint differs'):check_artifacts(root)
if __name__=='__main__':unittest.main()
