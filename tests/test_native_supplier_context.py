"""Bounded invented native archives and real packet verifier; no ELF execution."""
import base64
from copy import deepcopy
import gzip
from hashlib import sha256, sha512
import io
import json
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch

from tests import test_artifact_notice_coverage as support
from scripts import prepare_local_web_candidate as candidate

from scripts import native_supplier_context as native

class NativeSupplierContextTests(unittest.TestCase):
    def setUp(self):
        helper = support.ArtifactNoticeCoverageTests(); helper.setUp(); self.addCleanup(helper.doCleanups)
        self.root = helper.root; self.packet = helper.destination; self.upstream = self.packet.parent / "native-upstream"
        self.upstream.mkdir(mode=0o700); self.rows = []; self.payloads = []
        for index, (name, version, license_name, file) in enumerate(native.PACKAGES):
            original, shipped = helper.add_package(name, notice=False)
            metadata = {"name": name, "version": version, "license": license_name}
            body = ("invented binary " + str(index)).encode()
            for directory in (original, shipped):
                (directory / "package.json").write_text(json.dumps(metadata))
                p = directory / file; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(body)
            entries = [("package/package.json", json.dumps(metadata).encode(), tarfile.REGTYPE),
                       ("package/" + file, body, tarfile.REGTYPE)]
            stem = name.replace("/", "_") + "-" + version
            row = {**metadata, "dist": {"tarball": "https://registry.npmjs.org/" + name + "/-/" + name.split("/")[-1] + "-" + version + ".tgz"}}
            self.rows.append(row); self.payloads.append(entries); self.write_archive(index, entries)
        candidate.prepare_candidate(self.root, self.packet)

    @staticmethod
    def archive(entries):
        result = io.BytesIO()
        with tarfile.open(fileobj=result, mode="w", format=tarfile.USTAR_FORMAT) as out:
            for name, body, kind in entries:
                info = tarfile.TarInfo(name); info.type = kind
                if kind == tarfile.REGTYPE:
                    info.size = len(body); out.addfile(info, io.BytesIO(body))
                else:
                    info.linkname = "package/package.json"; out.addfile(info)
        return gzip.compress(result.getvalue(), mtime=0)

    def write_archive(self, index, entries=None, raw=None):
        data = self.archive(entries) if raw is None else raw
        self.rows[index]["dist"]["integrity"] = "sha512-" + base64.b64encode(sha512(data).digest()).decode()
        name, version, _, _ = native.PACKAGES[index]; stem = name.replace("/", "_") + "-" + version
        f = self.upstream / (stem + ".tgz"); f.write_bytes(data); f.chmod(0o600); self.save_metadata(index)
        return f

    def save_metadata(self, index, raw=None):
        name, version, _, _ = native.PACKAGES[index]; stem = name.replace("/", "_") + "-" + version
        f = self.upstream / (stem + ".json"); f.write_bytes(json.dumps(self.rows[index]).encode() if raw is None else raw); f.chmod(0o600)
        return f

    def read(self):
        return native.read_native_supplier_context(self.packet, self.upstream)

    def refused(self):
        with self.assertRaisesRegex(ValueError, "unavailable; preserve original evidence"):
            self.read()

    def test_two_native_files_match_actual_packet_without_network_or_extraction(self):
        before = candidate.verify_candidate(self.packet)
        with patch("urllib.request.urlopen", side_effect=AssertionError("Network forbidden")), \
             patch.object(tarfile.TarFile, "extract", side_effect=AssertionError("Extraction forbidden")), \
             patch.object(tarfile.TarFile, "extractall", side_effect=AssertionError("Extraction forbidden")):
            result = self.read()
        self.assertEqual(len(result["contexts"]), 2); self.assertEqual(result["buildId"], "invented-build")
        self.assertEqual(candidate.verify_candidate(self.packet), before)
        self.assertTrue(all(r["packetNativeBytesMatched"] and r["registryDeclaredIntegrityMatched"] for r in result["contexts"]))
        for field in ("packetChanged", "upstreamFetched", "archivesExtractedToFilesystem", "codeExecuted", "nativeBinaryIdentityAuthenticated", "nativeObligationsReviewed", "wholeNativeSecurityReviewed", "hostAccepted", "releaseCleared"):
            self.assertIs(result[field], False)

    def test_integrity_mismatch_is_refused_before_tar_or_gzip_parse(self):
        self.rows[0]["dist"]["integrity"] = "sha512-invalid"; self.save_metadata(0)
        with patch.object(native, "_selected_members", side_effect=AssertionError("Parser entered")):
            self.refused()

    def test_registry_name_version_license_and_distribution_are_fixed(self):
        saved = deepcopy(self.rows[0])
        for key, value in (("name", "@img/other"), ("version", "0.35.4"), ("license", "MIT"), ("dist", [])):
            with self.subTest(key=key):
                self.rows[0] = {**saved, key: value}; self.save_metadata(0); self.refused()
        self.rows[0] = saved
        for value in ("http://registry.npmjs.org/x", "https://example.test/a.tgz", saved["dist"]["tarball"] + "?token=x"):
            with self.subTest(value=value):
                self.rows[0] = deepcopy(saved); self.rows[0]["dist"]["tarball"] = value; self.save_metadata(0); self.refused()

    def test_nonobject_and_duplicate_registry_metadata_are_refused(self):
        for body in (b"[]", b"null", b'{"name":"x","name":"y"}'):
            with self.subTest(body=body):
                self.save_metadata(0, body); self.refused()

    def test_archive_metadata_identity_mismatch_is_refused(self):
        entries = list(self.payloads[0]); entries[0] = (entries[0][0], b'{"name":"@img/other","version":"0.35.5","license":"Apache-2.0"}', tarfile.REGTYPE)
        self.write_archive(0, entries); self.refused()

    def test_nonobject_duplicate_and_missing_archive_metadata_are_refused(self):
        for body in (b"[]", b'{"name":"x","name":"y"}'):
            entries = list(self.payloads[0]); entries[0] = (entries[0][0], body, tarfile.REGTYPE)
            self.write_archive(0, entries); self.refused()
        self.write_archive(0, self.payloads[0][1:]); self.refused()

    def test_missing_native_member_is_refused(self):
        self.write_archive(0, self.payloads[0][:1]); self.refused()

    def test_duplicate_selected_or_unselected_archive_name_is_refused(self):
        for extra in ([self.payloads[0][1]], [("package/ignored", b"x", tarfile.REGTYPE)] * 2):
            self.write_archive(0, self.payloads[0] + extra); self.refused()

    def test_absolute_traversal_noncanonical_and_nonpackage_names_are_refused(self):
        for name in ("/package/x", "package/../x", "package//x", "package/./x", "other/x", "package\\x"):
            with self.subTest(name=name):
                self.write_archive(0, self.payloads[0] + [(name, b"x", tarfile.REGTYPE)]); self.refused()

    def test_links_directories_devices_and_pipes_are_refused(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                self.write_archive(0, self.payloads[0] + [("package/extra", b"", kind)]); self.refused()

    def test_member_count_byte_size_and_decompression_bounds_are_enforced(self):
        with patch.object(native, "MAX_MEMBERS", 1): self.refused()
        with patch.object(native, "MAX_ARCHIVE", 1): self.refused()
        with patch.object(native, "MAX_UNPACKED", 1), patch.object(tarfile, "open", side_effect=AssertionError("Tar parser entered")): self.refused()

    def test_truncated_or_invalid_gzip_is_refused_without_filesystem_extraction(self):
        for body in (b"not gzip", self.archive(self.payloads[0])[:-10]):
            self.write_archive(0, raw=body); self.refused()

    def test_corrupt_deflate_is_a_closed_validation_refusal(self):
        self.write_archive(0, raw=b"\x1f\x8b\x08\x00" + b"\x00" * 6 + b"\xff" + b"\x00" * 8)
        self.refused()

    def test_linked_private_metadata_or_archive_is_refused(self):
        f = self.save_metadata(0); body = f.read_bytes(); target = f.with_suffix(".original"); target.write_bytes(body); target.chmod(0o600)
        f.unlink(); f.symlink_to(target.name); self.refused()

    def test_modified_packet_is_refused_and_original_evidence_is_not_repaired(self):
        name, _, _, file = native.PACKAGES[0]; path = self.packet / "node_modules" / name / file
        path.write_bytes(b"changed invented binary"); before = path.read_bytes(); self.refused(); self.assertEqual(path.read_bytes(), before)

    def test_consistently_resealed_different_packet_native_bytes_do_not_match_archive(self):
        name, _, _, file = native.PACKAGES[0]
        for parent in (self.root / "node_modules" / name, self.root / ".next/standalone/node_modules" / name):
            (parent / file).write_bytes(b"a different invented binary")
        self.packet = self.packet.parent / "different-native"; candidate.prepare_candidate(self.root, self.packet); self.refused()

    def test_archives_remain_consistency_inputs_without_original_installation(self):
        with patch("scripts.artifact_notice_coverage._source_notices", side_effect=AssertionError("Original install opened")):
            result = self.read()
        self.assertFalse(result["nativeBinaryIdentityAuthenticated"])

if __name__ == "__main__": unittest.main()
