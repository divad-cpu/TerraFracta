"""Synthetic cross-store classifications without a database or live request."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL
from workers.ssb_14059_raw_store import RETENTION, store_private_ssb_14059_pair
from workers.ssb_14059_recovery import (
    ExpectedRawPair,
    SSB14059RecoveryError,
    reconcile_private_ssb_14059_pairs,
)


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class SSB14059RecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "raw"
        self.now = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
        self.metadata_bytes = (FIXTURES / "ssb_14059_metadata_minimal_2024_2025.json").read_bytes()
        self.data_bytes = (FIXTURES / "ssb_14059_jsonstat_minimal_2024_2025.json").read_bytes()

    def save(self):
        def response(url: str, body: bytes) -> CapturedResponse:
            return CapturedResponse(
                requested_url=url,
                final_url=url,
                redirect_count=0,
                status=200,
                content_type="application/json",
                body=body,
                retrieved_at=self.now,
            )
        saved = store_private_ssb_14059_pair(
            response(METADATA_URL, self.metadata_bytes),
            response(DATA_URL, self.data_bytes),
            root=self.root,
            now=self.now,
        )
        reference = ExpectedRawPair(
            saved.attempt_id,
            sha256(self.metadata_bytes).hexdigest(),
            sha256(self.data_bytes).hexdigest(),
            saved.expires_at,
            self.now,
            self.now,
            self.now,
        )
        return saved, reference

    def test_matching_complete_pair_and_expired_state_are_read_only(self) -> None:
        saved, reference = self.save()
        self.assertEqual(
            reconcile_private_ssb_14059_pairs([reference], root=self.root, now=self.now)[0].state,
            "matched",
        )
        self.assertEqual(
            reconcile_private_ssb_14059_pairs(
                [reference], root=self.root, now=self.now + RETENTION
            )[0].state,
            "matched_expired",
        )
        self.assertTrue((saved.directory / "data.json").exists())

    def test_orphan_and_missing_local_pair_are_distinct(self) -> None:
        saved, reference = self.save()
        orphan = reconcile_private_ssb_14059_pairs([], root=self.root, now=self.now)
        self.assertEqual(orphan[0].state, "local_only_complete")
        self.assertEqual(orphan[0].issues, ("database_reference_missing",))
        self.assertEqual(
            reconcile_private_ssb_14059_pairs(
                [], root=self.root, now=self.now + RETENTION
            )[0].state,
            "local_only_expired",
        )
        saved.directory.rename(self.root / f".pending-{saved.attempt_id}")
        pending = reconcile_private_ssb_14059_pairs([], root=self.root, now=self.now)
        self.assertEqual(pending[0].state, "local_only_pending")
        # A missing local root is classified, not silently accepted as matched.
        absent = reconcile_private_ssb_14059_pairs(
            [reference], root=Path(self.temp.name) / "absent", now=self.now
        )
        self.assertEqual(absent[0].state, "database_only")
        expired_absent = reconcile_private_ssb_14059_pairs(
            [reference], root=Path(self.temp.name) / "absent", now=reference.expires_at
        )
        self.assertEqual(expired_absent[0].state, "expired_local_absent")
        self.assertEqual(expired_absent[0].issues, ())

    def test_hash_expiry_and_incomplete_pair_never_match(self) -> None:
        saved, reference = self.save()
        wrong = replace(
            reference,
            metadata_sha256="a" * 64,
            data_sha256="b" * 64,
        )
        finding = reconcile_private_ssb_14059_pairs([wrong], root=self.root, now=self.now)[0]
        self.assertEqual(finding.state, "inconsistent")
        self.assertEqual(set(finding.issues), {
            "metadata_hash_mismatch", "data_hash_mismatch"
        })
        with self.assertRaisesRegex(SSB14059RecoveryError, "expiry"):
            reconcile_private_ssb_14059_pairs(
                [replace(reference, expires_at=reference.expires_at - timedelta(seconds=1))],
                root=self.root, now=self.now,
            )
        pending = self.root / f".pending-{saved.attempt_id}"
        saved.directory.rename(pending)
        (pending / "data.json").unlink()
        finding = reconcile_private_ssb_14059_pairs([reference], root=self.root, now=self.now)[0]
        self.assertEqual(finding.state, "inconsistent")
        self.assertIn("pending_local_attempt", finding.issues)
        self.assertIn("incomplete_local_attempt", finding.issues)

    def test_distinct_database_times_do_not_match_same_hashes(self) -> None:
        _, reference = self.save()
        wrong = replace(
            reference,
            data_retrieved_at=self.now + timedelta(seconds=1),
            stored_at=self.now + timedelta(seconds=1),
        )
        finding = reconcile_private_ssb_14059_pairs([wrong], root=self.root, now=self.now)[0]
        self.assertEqual(finding.state, "inconsistent")
        self.assertEqual(set(finding.issues), {
            "data_retrieval_mismatch", "storage_time_mismatch",
        })
        shifted_first = replace(
            reference,
            metadata_retrieved_at=self.now - timedelta(seconds=2),
            expires_at=reference.expires_at - timedelta(seconds=2),
        )
        finding = reconcile_private_ssb_14059_pairs([shifted_first], root=self.root, now=self.now)[0]
        self.assertEqual(set(finding.issues), {
            "metadata_retrieval_mismatch", "expiry_mismatch",
        })

    def test_invalid_or_duplicate_database_reference_is_rejected(self) -> None:
        _, reference = self.save()
        with self.assertRaisesRegex(SSB14059RecoveryError, "Duplicate"):
            reconcile_private_ssb_14059_pairs(
                [reference, reference], root=self.root, now=self.now
            )
        with self.assertRaisesRegex(SSB14059RecoveryError, "identity or hash"):
            reconcile_private_ssb_14059_pairs(
                [replace(reference, attempt_id="not-an-id")], root=self.root, now=self.now
            )
        with self.assertRaisesRegex(SSB14059RecoveryError, "UTC"):
            reconcile_private_ssb_14059_pairs(
                [replace(reference, expires_at=datetime(2026, 10, 25))],
                root=self.root,
                now=self.now,
            )
        with self.assertRaisesRegex(SSB14059RecoveryError, "chronology"):
            reconcile_private_ssb_14059_pairs(
                [replace(reference, data_retrieved_at=self.now - timedelta(seconds=1))],
                root=self.root,
                now=self.now,
            )

    def test_false_early_expiry_cannot_make_missing_raw_bytes_normal(self) -> None:
        _, reference = self.save()
        absent_root = Path(self.temp.name) / "absent"
        with self.assertRaisesRegex(SSB14059RecoveryError, "expiry"):
            reconcile_private_ssb_14059_pairs(
                [replace(reference, expires_at=self.now + timedelta(days=1))],
                root=absent_root,
                now=self.now + timedelta(days=2),
            )

    def test_database_reference_cannot_exceed_pair_span(self) -> None:
        _, reference = self.save()
        with self.assertRaisesRegex(SSB14059RecoveryError, "span"):
            reconcile_private_ssb_14059_pairs(
                [replace(reference, data_retrieved_at=self.now + timedelta(minutes=6),
                         stored_at=self.now + timedelta(minutes=6))],
                root=self.root,
                now=self.now,
            )


if __name__ == "__main__":
    unittest.main()
