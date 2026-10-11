"""Invented documentation trees exercise the private-read boundary, never stores."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import check_docs


class DocumentationBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(prefix="terrafracta-docs-boundary-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.root_patch = patch.object(check_docs, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def write(self, name, body):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return path

    def run_check(self):
        out, err = StringIO(), StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = check_docs.main()
        return code, out.getvalue(), err.getvalue()

    def test_ordinary_links_and_fenced_examples_keep_existing_results(self):
        self.write("README.md", '[guide](docs/guide.md)\n```\n[example](absent.md)\n```\n')
        self.write("docs/guide.md", "# Ordinary guide\n")
        self.assertEqual(self.run_check(), (0, "Checked 1 local Markdown file links; none missing.\n", ""))

    def test_ordinary_missing_links_still_fail_with_their_exact_location(self):
        self.write("docs/guide.md", "# Guide\n[missing](absent.md)\n")
        code, out, err = self.run_check()
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("docs/guide.md:2: absent.md", err)

    def test_named_private_trees_are_pruned_before_body_discovery(self):
        ordinary = self.write("docs/ordinary.md", "# Ordinary guide\n")
        for name in [".local-error-log", ".local-connected-reader", ".local-fictional-runs",
                     ".local-connected-trial", "ssb-14059-raw", "TerraFracta-private-trials",
                     ".git", ".ssh", ".aws", ".codex", ".next", ".venv", "node_modules"]:
            self.write(f"nested/{name}/invented.md", "[private](invented-private-canary)\n")
        walk = check_docs.os.walk
        visited = []

        def observed(*args, **kwargs):
            for row in walk(*args, **kwargs):
                visited.append(Path(row[0]).relative_to(self.root).parts)
                yield row

        with patch.object(check_docs.os, "walk", observed):
            self.assertEqual(check_docs.markdown_files(), [ordinary])
        self.assertTrue(all(not any(part.startswith(".") or part in {
            "ssb-14059-raw", "TerraFracta-private-trials", "node_modules"
        } for part in parts) for parts in visited))
        self.assertEqual(self.run_check()[0], 0)

    def test_environment_names_are_skipped_while_similar_ordinary_names_remain(self):
        self.write(".env.example.md", "[private](invented-env-canary)\n")
        self.write("docs/.env-notes/private.md", "[private](invented-env-canary)\n")
        expected = [self.write("docs/ssb-14059-raw-guide.md", "# Ordinary guide\n"),
                    self.write("docs/local-error-log-guide.md", "# Ordinary guide\n")]
        self.assertEqual(check_docs.markdown_files(), sorted(expected))
        self.assertEqual(self.run_check()[0], 0)

    def test_linked_sources_never_open_private_or_external_bodies(self):
        ordinary = self.write("docs/ordinary.md", "# Ordinary guide\n")
        private = self.write(".local-error-log/invented.md", "[private](invented-private-canary)\n")
        with TemporaryDirectory(prefix="terrafracta-external-doc-") as tmp:
            external = Path(tmp) / "outside.md"
            external.write_text("[private](invented-outside-canary)\n")
            (self.root / "docs/linked-private.md").symlink_to(private)
            (self.root / "docs/linked-external.md").symlink_to(external)
            (self.root / "docs/linked-ordinary.md").symlink_to(ordinary)
            (self.root / "linked-directory").symlink_to(external.parent, target_is_directory=True)
            self.assertEqual(check_docs.markdown_files(), [ordinary])
            self.assertEqual(self.run_check()[0], 0)

    def test_main_revalidates_sources_without_opening_an_injected_private_list(self):
        ordinary = self.write("README.md", "# Ordinary guide\n")
        private = self.write(".local-error-log/invented.md", "[private](invented-private-canary)\n")
        with TemporaryDirectory(prefix="terrafracta-external-doc-") as tmp:
            external = Path(tmp) / "outside.md"
            external.write_text("[private](invented-outside-canary)\n")
            read = Path.read_text

            def guarded(path, *args, **kwargs):
                self.assertNotIn(path, {private, external}, "private body was opened")
                return read(path, *args, **kwargs)

            with patch.object(check_docs, "markdown_files", return_value=[ordinary, private, external]), \
                    patch.object(Path, "read_text", guarded):
                self.assertEqual(self.run_check(), (0, "Checked 0 local Markdown file links; none missing.\n", ""))

    def test_main_revalidates_build_and_dependency_cache_sources_before_read(self):
        ordinary = self.write("README.md", "# Ordinary guide\n")
        cached = {self.write(f"{name}/invented.md", "[cache](invented-cache-canary)\n")
                  for name in [".next", ".venv", "node_modules"]}
        read = Path.read_text

        def guarded(path, *args, **kwargs):
            self.assertNotIn(path, cached, "cache body was opened")
            return read(path, *args, **kwargs)

        with patch.object(check_docs, "markdown_files", return_value=[ordinary, *cached]), \
                patch.object(Path, "read_text", guarded):
            self.assertEqual(self.run_check(), (0, "Checked 0 local Markdown file links; none missing.\n", ""))

    def test_direct_script_preserves_cli_compatibility_without_pythonpath_setup(self):
        project = Path(__file__).resolve().parents[1]
        script = self.root / "scripts/check_docs.py"
        script.parent.mkdir()
        shutil.copyfile(check_docs.__file__, script)
        shutil.copyfile(project / "scripts/private_material_names.py", script.parent / "private_material_names.py")
        self.write("README.md", "[guide](docs/ordinary.md)\n")
        self.write("docs/ordinary.md", "# Ordinary guide\n")
        self.write(".local-error-log/invented.md", "[private](invented-private-canary)\n")
        result = subprocess.run([sys.executable, "-B", "-E", "-s", str(script)],
                                cwd=self.root.parent, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "Checked 1 local Markdown file links; none missing.\n")
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
