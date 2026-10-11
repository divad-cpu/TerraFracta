"""Private 30-day raw-pair storage tests using local fixture bytes only."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
from stat import S_IMODE
from tempfile import TemporaryDirectory
import unittest

from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL
from workers.ssb_14059_raw_store import (
    PROJECT_ROOT,
    RETENTION,
    SSB14059RawStoreError,
    inspect_private_ssb_14059_pairs,
    prune_expired_ssb_14059_pairs,
    store_private_ssb_14059_pair,
)


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class SSB14059RawStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "raw"
        self.now = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
        self.metadata_bytes = (FIXTURES / "ssb_14059_metadata_minimal_2024_2025.json").read_bytes()
        self.data_bytes = (FIXTURES / "ssb_14059_jsonstat_minimal_2024_2025.json").read_bytes()

    def response(self, url: str, body: bytes, *, retrieved_at=None) -> CapturedResponse:
        return CapturedResponse(
            requested_url=url,
            final_url=url,
            redirect_count=0,
            status=200,
            content_type="application/json",
            body=body,
            retrieved_at=self.now if retrieved_at is None else retrieved_at,
        )

    def save(self, *, metadata_bytes=None, data_bytes=None, metadata_retrieved_at=None, data_retrieved_at=None):
        return store_private_ssb_14059_pair(
            self.response(METADATA_URL, self.metadata_bytes if metadata_bytes is None else metadata_bytes, retrieved_at=metadata_retrieved_at),
            self.response(DATA_URL, self.data_bytes if data_bytes is None else data_bytes, retrieved_at=data_retrieved_at),
            root=self.root,
            now=self.now,
        )

    def test_pair_is_private_bound_and_expires_after_thirty_days(self) -> None:
        saved = self.save()
        manifest = json.loads((saved.directory / "manifest.json").read_text())
        self.assertEqual(saved.expires_at, self.now + RETENTION)
        self.assertEqual(manifest["attempt_id"], saved.attempt_id)
        self.assertEqual(manifest["metadata"]["sha256"], sha256(self.metadata_bytes).hexdigest())
        self.assertEqual(manifest["data"]["sha256"], sha256(self.data_bytes).hexdigest())
        self.assertEqual((saved.directory / "metadata.json").read_bytes(), self.metadata_bytes)
        self.assertEqual((saved.directory / "data.json").read_bytes(), self.data_bytes)
        self.assertEqual(S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(S_IMODE(saved.directory.stat().st_mode), 0o700)
        for name in ("manifest.json", "metadata.json", "data.json"):
            self.assertEqual(S_IMODE((saved.directory / name).stat().st_mode), 0o600)
        self.assertEqual(prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION - timedelta(seconds=1)), 0)
        self.assertEqual(prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION), 1)
        self.assertFalse(saved.directory.exists())

    def test_mismatched_source_version_or_stale_pair_never_creates_a_store(self) -> None:
        changed_metadata = json.loads(self.metadata_bytes)
        changed_metadata["updated"] = "2026-05-01T06:00:00Z"
        with self.assertRaises(ValueError):
            self.save(metadata_bytes=json.dumps(changed_metadata).encode())
        with self.assertRaises(SSB14059RawStoreError):
            self.save(metadata_retrieved_at=self.now - timedelta(minutes=6))
        self.assertFalse(self.root.exists())

    def test_data_before_metadata_cannot_be_stored_as_one_attempt(self) -> None:
        with self.assertRaises(SSB14059RawStoreError):
            self.save(data_retrieved_at=self.now - timedelta(seconds=1))
        self.assertFalse(self.root.exists())

    def test_expired_input_is_rejected_before_storage(self) -> None:
        old = self.now - RETENTION
        with self.assertRaises(SSB14059RawStoreError):
            store_private_ssb_14059_pair(
                self.response(METADATA_URL, self.metadata_bytes, retrieved_at=old),
                self.response(DATA_URL, self.data_bytes, retrieved_at=old),
                root=self.root,
                now=self.now,
            )
        self.assertFalse(self.root.exists())

    def test_refuses_nonprivate_or_repository_paths(self) -> None:
        self.root.mkdir(mode=0o755)
        os.chmod(self.root, 0o755)
        with self.assertRaises(SSB14059RawStoreError):
            self.save()
        with self.assertRaises(SSB14059RawStoreError):
            store_private_ssb_14059_pair(
                self.response(METADATA_URL, self.metadata_bytes),
                self.response(DATA_URL, self.data_bytes),
                root=PROJECT_ROOT / "raw-source-data",
                now=self.now,
            )
        target = Path(self.temp.name) / "target"
        target.mkdir(mode=0o700)
        link = Path(self.temp.name) / "link"
        link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(SSB14059RawStoreError):
            store_private_ssb_14059_pair(
                self.response(METADATA_URL, self.metadata_bytes),
                self.response(DATA_URL, self.data_bytes),
                root=link,
                now=self.now,
            )

    def test_prune_preserves_unknown_or_modified_user_files(self) -> None:
        saved = self.save()
        unrelated = saved.directory / "keep.txt"
        unrelated.write_text("Keep me")
        with self.assertRaises(SSB14059RawStoreError):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue(unrelated.exists())
        unrelated.unlink()
        (saved.directory / "data.json").write_bytes(b"changed")
        with self.assertRaises(SSB14059RawStoreError):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue(saved.directory.exists())

    def test_unknown_later_item_prevents_all_deletion(self) -> None:
        saved = self.save()
        unknown = self.root / "z-unknown.txt"
        unknown.write_text("Keep me")
        with self.assertRaisesRegex(SSB14059RawStoreError, "Unknown item"):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue((saved.directory / "manifest.json").exists())
        self.assertTrue((saved.directory / "metadata.json").exists())
        self.assertTrue((saved.directory / "data.json").exists())
        self.assertEqual(unknown.read_text(), "Keep me")

    def test_manipulated_manifest_or_file_mode_blocks_expiry_deletion(self) -> None:
        saved = self.save()
        manifest_path = saved.directory / "manifest.json"
        original = json.loads(manifest_path.read_text())
        tampered = json.loads(json.dumps(original))
        tampered["metadata"]["url"] = "https://example.invalid/metadata"
        manifest_path.write_text(json.dumps(tampered))
        with self.assertRaisesRegex(SSB14059RawStoreError, "Invalid raw attempt manifest"):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue((saved.directory / "data.json").exists())
        manifest_path.write_text(json.dumps(original))
        os.chmod(saved.directory / "metadata.json", 0o644)
        with self.assertRaisesRegex(SSB14059RawStoreError, "mode 0600"):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue((saved.directory / "data.json").exists())
        os.chmod(saved.directory / "metadata.json", 0o600)
        self.assertEqual(prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION), 1)

    def test_reordered_manifest_capture_times_block_expiry_deletion(self) -> None:
        saved = self.save()
        manifest_path = saved.directory / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["metadata"]["retrieved_at"] = (self.now + timedelta(seconds=1)).isoformat()
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(SSB14059RawStoreError, "Invalid raw attempt manifest"):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue((saved.directory / "data.json").exists())

    def test_duplicate_manifest_fields_block_expiry_deletion(self) -> None:
        for duplicate, replacement in (
            ('"source_id":', '"source_id": "OTHER", "source_id":'),
            ('"sha256":', '"sha256": "0", "sha256":'),
        ):
            with self.subTest(field=duplicate):
                saved = self.save()
                manifest_path = saved.directory / "manifest.json"
                original = manifest_path.read_text()
                altered = original.replace(duplicate, replacement, 1)
                manifest_path.write_text(altered)
                with self.assertRaisesRegex(SSB14059RawStoreError, "Invalid raw attempt manifest"):
                    prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
                self.assertTrue((saved.directory / "data.json").exists())
                manifest_path.write_text(original)

    def test_invalid_source_update_time_blocks_expiry_deletion(self) -> None:
        for value in ("not-a-date", (self.now + timedelta(seconds=1)).isoformat()):
            with self.subTest(value=value):
                saved = self.save()
                manifest_path = saved.directory / "manifest.json"
                original = json.loads(manifest_path.read_text())
                altered = {**original, "source_updated_at": value}
                manifest_path.write_text(json.dumps(altered))
                with self.assertRaisesRegex(SSB14059RawStoreError, "Invalid raw attempt manifest"):
                    prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
                self.assertTrue((saved.directory / "data.json").exists())
                manifest_path.write_text(json.dumps(original))

    def test_incomplete_pending_attempt_can_expire_without_recursive_delete(self) -> None:
        saved = self.save()
        pending = self.root / f".pending-{saved.attempt_id}"
        saved.directory.rename(pending)
        (pending / "data.json").unlink()
        self.assertEqual(prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION), 1)
        self.assertFalse(pending.exists())

    def test_interrupted_prune_keeps_manifest_until_recovery_finishes(self) -> None:
        saved = self.save()
        (saved.directory / "data.json").unlink()
        self.assertTrue((saved.directory / "manifest.json").exists())
        self.assertEqual(prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION), 1)
        self.assertFalse(saved.directory.exists())
        another = self.save()
        for name in ("data.json", "metadata.json", "manifest.json"):
            (another.directory / name).unlink()
        with self.assertRaisesRegex(SSB14059RawStoreError, "no verifiable expiry"):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue(another.directory.exists())

    def test_unknown_empty_attempt_is_never_classified_as_expired(self) -> None:
        self.root.mkdir(mode=0o700)
        unknown = self.root / ("a" * 32)
        unknown.mkdir(mode=0o700)
        with self.assertRaisesRegex(SSB14059RawStoreError, "no verifiable expiry"):
            prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertTrue(unknown.exists())

    def test_dry_run_reports_expired_pair_without_deleting_it(self) -> None:
        saved = self.save()
        self.assertEqual(
            prune_expired_ssb_14059_pairs(
                root=self.root, now=self.now + RETENTION, dry_run=True
            ),
            1,
        )
        self.assertTrue((saved.directory / "manifest.json").exists())
        self.assertTrue((saved.directory / "metadata.json").exists())
        self.assertTrue((saved.directory / "data.json").exists())
        self.assertEqual(prune_expired_ssb_14059_pairs(root=self.root, now=self.now + RETENTION), 1)

    def test_inventory_identifies_complete_and_pending_attempts_without_mutation(self) -> None:
        complete = self.save()
        pending = self.save()
        pending_folder = self.root / f".pending-{pending.attempt_id}"
        pending.directory.rename(pending_folder)
        (pending_folder / "data.json").unlink()
        entries = inspect_private_ssb_14059_pairs(root=self.root, now=self.now)
        by_id = {entry.attempt_id: entry for entry in entries}
        self.assertEqual(set(by_id), {complete.attempt_id, pending.attempt_id})
        self.assertFalse(by_id[complete.attempt_id].pending)
        self.assertFalse(by_id[complete.attempt_id].expired)
        self.assertEqual(by_id[complete.attempt_id].data_sha256, sha256(self.data_bytes).hexdigest())
        self.assertEqual(by_id[complete.attempt_id].present_files, ("data.json", "manifest.json", "metadata.json"))
        self.assertTrue(by_id[pending.attempt_id].pending)
        self.assertEqual(by_id[pending.attempt_id].present_files, ("manifest.json", "metadata.json"))
        self.assertTrue((complete.directory / "data.json").exists())

    def test_inventory_rejects_modified_unexpired_bytes_and_duplicate_identity(self) -> None:
        saved = self.save()
        (saved.directory / "data.json").write_bytes(b"changed")
        with self.assertRaisesRegex(SSB14059RawStoreError, "differs from its manifest"):
            inspect_private_ssb_14059_pairs(root=self.root, now=self.now)
        (saved.directory / "data.json").write_bytes(self.data_bytes)
        duplicate = self.root / f".pending-{saved.attempt_id}"
        shutil.copytree(saved.directory, duplicate)
        with self.assertRaisesRegex(SSB14059RawStoreError, "Duplicate raw attempt identity"):
            inspect_private_ssb_14059_pairs(root=self.root, now=self.now)

    def test_inventory_exposes_expiry_but_never_prunes(self) -> None:
        saved = self.save()
        entries = inspect_private_ssb_14059_pairs(root=self.root, now=self.now + RETENTION)
        self.assertEqual(len(entries), 1)
        self.assertTrue(entries[0].expired)
        self.assertEqual(entries[0].expires_at, saved.expires_at)
        self.assertTrue((saved.directory / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
