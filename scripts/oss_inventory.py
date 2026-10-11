"""Record declared licenses and local notice-file hashes without dependencies.

This is a deterministic package-metadata inventory, not legal clearance or a
complete audit of bundled files and artifacts. pnpm performs the discovery.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
from stat import S_IMODE
import subprocess
import sys
import tempfile
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "docs/OSS_PACKAGE_INVENTORY.json"


class InventoryError(ValueError):
    """The package-manager report is incomplete or inconsistent."""


def _is_notice_name(name: str) -> bool:
    lower = name.lower()
    return lower.startswith(("license", "licence", "copying", "notice", "third-party-notices"))


def collect_top_level_notice_evidence(
    report: Any, root: Path
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """Hash named files at installed package roots, without exporting paths."""
    if not isinstance(report, dict) or "error" in report:
        raise InventoryError("pnpm did not return a usable license report")
    node_modules = (root / "node_modules").resolve(strict=True)
    evidence: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for entries in report.values():
        if not isinstance(entries, list):
            raise InventoryError("Invalid package report group")
        for entry in entries:
            if not isinstance(entry, dict):
                raise InventoryError("Invalid package report entry")
            versions = entry.get("versions")
            paths = entry.get("paths")
            if not isinstance(versions, list) or not isinstance(paths, list) or len(versions) != len(paths):
                raise InventoryError("Package versions and installed paths do not match")
            for version, raw_path in zip(versions, paths, strict=True):
                if not isinstance(version, str) or not isinstance(raw_path, str):
                    raise InventoryError("Invalid installed package identity")
                package_path = Path(raw_path)
                if not package_path.is_absolute():
                    raise InventoryError("Installed package path is not absolute")
                try:
                    package_path = package_path.resolve(strict=True)
                    if not package_path.is_relative_to(node_modules):
                        raise InventoryError("Installed package path leaves node_modules")
                    package = json.loads((package_path / "package.json").read_text(encoding="utf-8"))
                except InventoryError:
                    raise
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    raise InventoryError("Could not inspect installed package metadata") from exc
                if package.get("name") != entry.get("name") or package.get("version") != version:
                    raise InventoryError("Installed package path has another identity")
                files: list[dict[str, Any]] = []
                for item in sorted(package_path.iterdir()):
                    if not _is_notice_name(item.name):
                        continue
                    if item.is_symlink():
                        raise InventoryError("Top-level license or notice path is a symbolic link")
                    if not item.is_file():
                        continue
                    size = item.stat().st_size
                    if size > 2 * 1024 * 1024:
                        raise InventoryError("Top-level license or notice file is unexpectedly large")
                    files.append({"file": item.name, "bytes": size, "sha256": sha256(item.read_bytes()).hexdigest()})
                key = (entry["name"], version)
                if key in evidence and evidence[key] != files:
                    raise InventoryError("Installed package version has inconsistent notice files")
                evidence[key] = files
    return evidence


def normalize_report(
    report: Any,
    lockfile_sha256: str,
    locked_package_ids: list[str],
    top_level_notice_evidence: dict[tuple[str, str], list[dict[str, Any]]],
) -> dict[str, Any]:
    """Keep installed licenses and expose locked packages absent from this OS."""
    if not isinstance(report, dict) or "error" in report or not report:
        raise InventoryError("pnpm did not return a usable license report")
    packages: dict[tuple[str, str], str] = {}
    for declared_license, entries in report.items():
        if not isinstance(declared_license, str) or not declared_license or not isinstance(entries, list):
            raise InventoryError("Invalid license group")
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("license") != declared_license:
                raise InventoryError("Package license does not match its group")
            name = entry.get("name")
            versions = entry.get("versions")
            if (
                not isinstance(name, str)
                or not name
                or not isinstance(versions, list)
                or not versions
                or any(not isinstance(version, str) or not version for version in versions)
            ):
                raise InventoryError("Package identity or version is missing")
            for version in versions:
                key = (name, version)
                previous = packages.get(key)
                if previous is not None and previous != declared_license:
                    raise InventoryError("One package version has conflicting licenses")
                packages[key] = declared_license
    if not packages:
        raise InventoryError("No installed packages were reported")
    if not isinstance(locked_package_ids, list) or not locked_package_ids:
        raise InventoryError("No lockfile packages were reported")
    locked: set[tuple[str, str]] = set()
    for package_id in locked_package_ids:
        if not isinstance(package_id, str):
            raise InventoryError("Invalid lockfile package identity")
        name, separator, version = package_id.rpartition("@")
        if not separator or not name or not version:
            raise InventoryError("Invalid lockfile package identity")
        locked.add((name, version))
    if len(locked) != len(locked_package_ids):
        raise InventoryError("Duplicate lockfile package identity")
    if not packages.keys() <= locked:
        raise InventoryError("An installed package is missing from the lockfile")
    if not isinstance(top_level_notice_evidence, dict) or set(top_level_notice_evidence) != set(packages):
        raise InventoryError("Top-level notice evidence does not cover installed packages")
    lockfile_only = locked - packages.keys()
    return {
        "format_version": 3,
        "scope": "installed pnpm package declarations and top-level notice-file hashes plus lockfile-only identities; no bundled-file audit",
        "source_command": "pnpm licenses list --json",
        "lockfile_package_source": "yq -o=json '.packages | keys' pnpm-lock.yaml",
        "pnpm_lock_sha256": lockfile_sha256,
        "locked_package_count": len(locked),
        "top_level_notice_file_count": sum(len(files) for files in top_level_notice_evidence.values()),
        "packages": [
            {
                "name": name,
                "version": version,
                "declared_license": packages[(name, version)],
                "top_level_notice_files": top_level_notice_evidence[(name, version)],
            }
            for name, version in sorted(packages)
        ],
        "lockfile_only_packages": [
            {"name": name, "version": version, "license_review": "not_assessed_on_this_platform"}
            for name, version in sorted(lockfile_only)
        ],
    }


def build_inventory() -> dict[str, Any]:
    result = subprocess.run(
        ["pnpm", "licenses", "list", "--json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise InventoryError(f"pnpm license scan failed (exit {result.returncode})")
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise InventoryError("pnpm did not return JSON") from exc
    lockfile_sha256 = sha256((ROOT / "pnpm-lock.yaml").read_bytes()).hexdigest()
    locked_result = subprocess.run(
        ["yq", "-o=json", ".packages | keys", "pnpm-lock.yaml"],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    if locked_result.returncode != 0:
        raise InventoryError(f"yq lockfile scan failed (exit {locked_result.returncode})")
    try:
        locked_package_ids = json.loads(locked_result.stdout)
    except json.JSONDecodeError as exc:
        raise InventoryError("yq did not return JSON package keys") from exc
    notice_evidence = collect_top_level_notice_evidence(report, ROOT)
    return normalize_report(report, lockfile_sha256, locked_package_ids, notice_evidence)


def serialize(inventory: dict[str, Any]) -> str:
    return json.dumps(inventory, indent=2, ensure_ascii=False) + "\n"


def write_atomically(path: Path, contents: str) -> None:
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=".oss-inventory-", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        mode = S_IMODE(path.stat().st_mode) if path.exists() else 0o644
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="write the normalized local inventory")
    mode.add_argument("--check", action="store_true", help="fail if the saved inventory differs")
    args = parser.parse_args()
    try:
        inventory = build_inventory()
        contents = serialize(inventory)
        installed_count = len(inventory["packages"])
        locked_count = inventory["locked_package_count"]
        if args.write:
            write_atomically(INVENTORY, contents)
            print(f"Recorded {installed_count} installed and {locked_count - installed_count} lockfile-only package versions in {INVENTORY}")
            return 0
        if not INVENTORY.exists() or INVENTORY.read_text(encoding="utf-8") != contents:
            raise InventoryError("Installed package inventory differs from the saved snapshot")
        print(f"License inventory matches {installed_count} installed and {locked_count - installed_count} lockfile-only package versions; {inventory['top_level_notice_file_count']} top-level notice files")
        return 0
    except (InventoryError, OSError) as exc:
        print(f"License inventory check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
