from pathlib import Path
import tempfile
import unittest

from scripts.check_run_completion_copy import ROOT,SOURCE,MIGRATION,check_artifacts


class RunCompletionCopyTests(unittest.TestCase):
    def prepare(self,root):
        for name in (SOURCE,MIGRATION):
            target=root/name; target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((ROOT/name).read_bytes())

    def test_exact_reviewed_source_and_installed_copy_agree(self):
        check_artifacts(ROOT)

    def test_unreviewed_grant_added_only_to_migration_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); self.prepare(root)
            target=root/MIGRATION
            target.write_bytes(target.read_bytes()+b'grant insert on terra_private.update_run_closeouts to terra_issue_reader;\n')
            with self.assertRaisesRegex(ValueError,'Migration 29 differs'): check_artifacts(root)

    def test_altering_both_files_does_not_replace_reviewed_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); self.prepare(root)
            for name in (SOURCE,MIGRATION):
                target=root/name
                target.write_bytes(target.read_bytes().replace(b'revoke all on function',b'grant all on function'))
            with self.assertRaisesRegex(ValueError,'fingerprint differs'): check_artifacts(root)


if __name__=='__main__': unittest.main()
