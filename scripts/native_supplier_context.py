"""Read fixed Linux native supplier archives as data, never execute or extract.

Exact byte consistency between a locally verified packet and registry-declared
archives is not authenticated authorship, safe native code, complete notices,
source/replacement obligations, platform compatibility or release permission.
No archive path is written to disk; only fixed selected members are inspected.
"""
from __future__ import annotations

import argparse
import base64
import gzip
from hashlib import sha256, sha512
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile
import zlib

from scripts.artifact_notice_coverage import _read_json, FOLDER, MANIFEST as NOTICE_MANIFEST
from scripts.check_private_attempt_readiness import private_directory, private_read
from scripts.prepare_local_web_candidate import verify_candidate, MANIFEST as PACKET_MANIFEST

MAX_ARCHIVE = 32 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
MAX_MEMBERS = 128
PACKAGES = (
    ("@img/sharp-linux-x64", "0.35.5", "Apache-2.0", "lib/sharp-linux-x64-0.35.5.node"),
    ("@img/sharp-libvips-linux-x64", "1.3.4", "LGPL-3.0-or-later", "lib/libvips-cpp.so.8.18.7"),
)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate package metadata field")
        result[key] = value
    return result


def _selected_members(archive):
    # Bound decompression before tar parsing and bound member enumeration before
    # allocating an unbounded member list. tarfile.extract/extractall are unused.
    with gzip.GzipFile(fileobj=io.BytesIO(archive)) as compressed:
        unpacked = compressed.read(MAX_UNPACKED + 1)
    if len(unpacked) > MAX_UNPACKED:
        raise ValueError("Native archive decompression exceeds the byte bound")
    selected = {}; seen = set()
    with tarfile.open(fileobj=io.BytesIO(unpacked), mode="r:") as stream:
        for index, member in enumerate(stream):
            if index >= MAX_MEMBERS:
                raise ValueError("Native archive has too many members")
            name = member.name; path = PurePosixPath(name)
            if type(name) is not str or not 1 <= len(name) <= 512 or "\\" in name or "\0" in name \
                    or path.is_absolute() or str(path) != name or ".." in path.parts \
                    or not path.parts or path.parts[0] != "package" or name in seen:
                raise ValueError("Invalid or repeated native archive member")
            seen.add(name)
            if member.pax_headers or member.issparse() or not member.isreg() \
                    or not 0 <= member.size <= MAX_ARCHIVE:
                raise ValueError("Native archive has unsupported member type or size")
            wanted = {"package/package.json", *("package/" + item[3] for item in PACKAGES)}
            if name not in wanted:
                continue
            with stream.extractfile(member) as source:
                body = source.read(member.size + 1)
            if len(body) != member.size:
                raise ValueError("Native archive member is incomplete")
            selected[name] = body
    return selected


def inspect_supplier_archives(upstream):
    """Return fixed archive/native fingerprints; input declarations stay untrusted."""
    upstream = Path(upstream); private_directory(upstream); rows = []
    for name, version, license_name, native in PACKAGES:
        stem = name.replace("/", "_") + "-" + version
        metadata_path = upstream / (stem + ".json")
        metadata_body = private_read(metadata_path, limit=2 * 1024 * 1024)
        metadata = json.loads(metadata_body, object_pairs_hook=_unique)
        if type(metadata) is not dict:
            raise ValueError("Native registry metadata is not an object")
        if metadata.get("name") != name or metadata.get("version") != version \
                or metadata.get("license") != license_name or type(metadata.get("dist")) is not dict:
            raise ValueError("Native registry package identity differs")
        dist = metadata["dist"]
        expected_url = "https://registry.npmjs.org/" + name + "/-/" + name.split("/")[-1] + "-" + version + ".tgz"
        if dist.get("tarball") != expected_url or type(dist.get("integrity")) is not str:
            raise ValueError("Native distribution declaration differs")
        archive = private_read(upstream / (stem + ".tgz"), limit=MAX_ARCHIVE)
        digest = "sha512-" + base64.b64encode(sha512(archive).digest()).decode("ascii")
        if dist["integrity"] != digest:
            raise ValueError("Native archive integrity differs from supplied registry metadata")
        members = _selected_members(archive)
        package = json.loads(members["package/package.json"], object_pairs_hook=_unique)
        if type(package) is not dict:
            raise ValueError("Native archive metadata is not an object")
        if package.get("name") != name or package.get("version") != version or package.get("license") != license_name:
            raise ValueError("Native archive package identity differs")
        body = members["package/" + native]
        rows.append({"name": name, "version": version, "declaredLicense": license_name,
            "archiveFile": stem + ".tgz", "archiveBytes": len(archive),
            "archiveSha256": sha256(archive).hexdigest(), "registryDeclaredIntegrityMatched": True,
            "nativeFile": native, "nativeBytes": len(body), "nativeSha256": sha256(body).hexdigest(),
            "metadataSha256": sha256(metadata_body).hexdigest()})
    return rows


def read_native_supplier_context(packet, upstream):
    """Bind both fixed native members to this exact verified private packet."""
    try:
        packet = Path(packet); before = verify_candidate(packet)
        identity = private_read(packet / PACKET_MANIFEST, limit=4 * 1024 * 1024)
        artifact = _read_json(packet / FOLDER / NOTICE_MANIFEST, private=True)
        contexts = []
        for row in inspect_supplier_archives(upstream):
            packages = [p for p in artifact["packages"] if p["name"] == row["name"]]
            if len(packages) != 1 or packages[0]["version"] != row["version"] \
                    or packages[0]["declaredLicense"] != row["declaredLicense"]:
                raise ValueError("Packet native package identity differs")
            selected_path = packages[0]["root"] + "/" + row["nativeFile"]
            matches = [p for p in artifact["nativeFiles"] if p["path"] == selected_path]
            if len(matches) != 1 or matches[0]["bytes"] != row["nativeBytes"] \
                    or matches[0]["sha256"] != row["nativeSha256"]:
                raise ValueError("Packet native bytes differ from supplied supplier archive")
            contexts.append({**row, "packetPath": selected_path, "packetNativeBytesMatched": True})
        if verify_candidate(packet) != before \
                or private_read(packet / PACKET_MANIFEST, limit=4 * 1024 * 1024) != identity:
            raise ValueError("Packet changed during native byte comparison")
        return {"schemaVersion": 1, "evidenceKind": "private_native_supplier_archive_byte_context",
            "buildId": before["buildId"], "candidateManifestSha256": sha256(identity).hexdigest(),
            "contexts": contexts, "packetChanged": False, "upstreamFetched": False,
            "archivesExtractedToFilesystem": False, "codeExecuted": False,
            "nativeBinaryIdentityAuthenticated": False, "nativeObligationsReviewed": False,
            "wholeNativeSecurityReviewed": False, "hostAccepted": False, "releaseCleared": False}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, EOFError, tarfile.TarError, zlib.error, RecursionError):
        raise ValueError("Native supplier byte context unavailable; preserve original evidence") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", type=Path)
    parser.add_argument("upstream", type=Path)
    args = parser.parse_args()
    try:
        result = read_native_supplier_context(args.packet, args.upstream)
    except ValueError as exc:
        print(str(exc), file=sys.stderr); return 1
    print(json.dumps(result, indent=2, sort_keys=True)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
