"""Regression checks for the local declared-license inventory."""

from __future__ import annotations

import unittest
import json
from hashlib import sha256
from pathlib import Path
from stat import S_IMODE
import tempfile

from scripts.oss_inventory import (
    InventoryError,
    collect_top_level_notice_evidence,
    normalize_report,
    serialize,
    write_atomically,
)


class OSSInventoryTests(unittest.TestCase):
    def test_normalization_is_stable_and_omits_machine_paths(self) -> None:
        report = {
            "MIT": [
                {"name": "zeta", "versions": ["2.0", "1.0"], "license": "MIT", "paths": ["/private/path"]}
            ],
            "Apache-2.0": [
                {"name": "alpha", "versions": ["1.0"], "license": "Apache-2.0"}
            ],
        }
        result = normalize_report(
            report, "a" * 64,
            ["alpha@1.0", "zeta@1.0", "zeta@2.0", "optional@3.0"],
            {("alpha", "1.0"): [], ("zeta", "1.0"): [], ("zeta", "2.0"): []},
        )
        self.assertEqual(result["locked_package_count"], 4)
        self.assertEqual(
            result["lockfile_only_packages"],
            [{"name": "optional", "version": "3.0", "license_review": "not_assessed_on_this_platform"}],
        )
        self.assertEqual(
            result["packages"],
            [
                {"name": "alpha", "version": "1.0", "declared_license": "Apache-2.0", "top_level_notice_files": []},
                {"name": "zeta", "version": "1.0", "declared_license": "MIT", "top_level_notice_files": []},
                {"name": "zeta", "version": "2.0", "declared_license": "MIT", "top_level_notice_files": []},
            ],
        )
        self.assertNotIn("/private/path", serialize(result))

    def test_error_and_conflicting_license_do_not_create_an_inventory(self) -> None:
        with self.assertRaises(InventoryError):
            normalize_report({"error": {"code": "EROFS"}}, "a" * 64, ["same@1"], {})
        report = {
            "MIT": [{"name": "same", "versions": ["1"], "license": "MIT"}],
            "Apache-2.0": [
                {"name": "same", "versions": ["1"], "license": "Apache-2.0"}
            ],
        }
        with self.assertRaises(InventoryError):
            normalize_report(report, "a" * 64, ["same@1"], {})

    def test_installed_package_must_be_in_the_lockfile(self) -> None:
        report = {
            "MIT": [{"name": "installed", "versions": ["1"], "license": "MIT"}]
        }
        with self.assertRaises(InventoryError):
            normalize_report(report, "a" * 64, ["different@1"], {})
        with self.assertRaises(InventoryError):
            normalize_report(report, "a" * 64, ["installed@1", "installed@1"], {})

    def test_notice_files_are_hashed_without_exporting_install_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "node_modules" / "example"
            package.mkdir(parents=True)
            (package / "package.json").write_text(json.dumps({"name": "example", "version": "1.0"}))
            (package / "LICENSE.md").write_text("permission text\n")
            (package / "README.md").write_text("unrelated")
            report = {"MIT": [{"name": "example", "version": "1.0", "versions": ["1.0"], "license": "MIT", "paths": [str(package)]}]}
            evidence = collect_top_level_notice_evidence(report, root)
            self.assertEqual(evidence, {("example", "1.0"): [
                {"file": "LICENSE.md", "bytes": 16, "sha256": sha256(b"permission text\n").hexdigest()}
            ]})
            result = normalize_report(report, "a" * 64, ["example@1.0"], evidence)
            self.assertEqual(result["top_level_notice_file_count"], 1)
            self.assertNotIn(str(root), serialize(result))
            with self.assertRaises(InventoryError):
                normalize_report(report, "a" * 64, ["example@1.0"], {})

    def test_notice_scan_rejects_path_outside_installation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "node_modules").mkdir()
            outside = root / "outside"
            outside.mkdir()
            (outside / "package.json").write_text(json.dumps({"name": "example", "version": "1.0"}))
            report = {"MIT": [{"name": "example", "versions": ["1.0"], "license": "MIT", "paths": [str(outside)]}]}
            with self.assertRaises(InventoryError):
                collect_top_level_notice_evidence(report, root)

    def test_refresh_preserves_existing_read_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inventory.json"
            path.write_text("old", encoding="utf-8")
            path.chmod(0o644)
            write_atomically(path, "new\n")
            self.assertEqual(path.read_text(encoding="utf-8"), "new\n")
            self.assertEqual(S_IMODE(path.stat().st_mode), 0o644)


if __name__ == "__main__":
    unittest.main()
