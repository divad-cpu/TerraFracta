"""Detect source-copy drift without executing or modifying any SQL database."""

from pathlib import Path
import tempfile
import unittest

from scripts.check_runner_controls_copy import APPROVED,MIGRATION,ROOT,check_artifacts


class RunnerControlCopyTests(unittest.TestCase):
    def test_original_reviewed_artifacts_match(self):
        check_artifacts(ROOT)

    def test_changed_guard_or_application_grant_cannot_pass_the_copy_check(self):
        for changed in ["research/pending/TF009_machine_activation.sql",MIGRATION]:
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                for relative in [*("research/pending/"+name for name in APPROVED),MIGRATION]:
                    path=root/relative;path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_bytes((ROOT/relative).read_bytes())
                path=root/changed
                path.write_bytes(path.read_bytes()+b"\ngrant insert on terra_private.update_run_requests to anon;\n")
                with self.assertRaises(ValueError):
                    check_artifacts(root)


if __name__=="__main__":
    unittest.main()
