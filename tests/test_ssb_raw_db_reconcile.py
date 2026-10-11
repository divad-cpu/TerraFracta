"""Pure input-bound checks for the read-only local raw/database audit."""

from __future__ import annotations

from contextlib import redirect_stdout
from dataclasses import replace
from io import StringIO
import json
import unittest
from unittest.mock import patch

from scripts.ssb_raw_db_reconcile import RawDbAuditError, main, parse_artifact_rows
from workers.ssb_14059_recovery import RawPairRecoveryFinding


class RawDbAuditParseTests(unittest.TestCase):
    def test_empty_query_has_no_expected_pairs(self) -> None:
        self.assertEqual(parse_artifact_rows("[]"), ())

    def test_valid_utc_row_preserves_identity_and_expiry(self) -> None:
        row = {
            "source_key": "SSB-14059-NO-HOUSING-COSTS",
            "attempt_id": "a" * 32,
            "metadata_sha256": "b" * 64,
            "data_sha256": "c" * 64,
            "metadata_retrieved_at": "2026-09-25T12:00:00+00:00",
            "data_retrieved_at": "2026-09-25T12:00:01+00:00",
            "stored_at": "2026-09-25T12:00:02+00:00",
            "expires_at": "2026-10-25T12:00:00+00:00",
        }
        parsed = parse_artifact_rows(json.dumps([row]))
        self.assertEqual(parsed[0].attempt_id, row["attempt_id"])
        self.assertEqual(parsed[0].expires_at.isoformat(), row["expires_at"])
        self.assertEqual(parsed[0].data_retrieved_at.isoformat(), row["data_retrieved_at"])

    def test_unexpected_fields_or_non_utc_expiry_fail_closed(self) -> None:
        row = {
            "source_key": "SSB-14059-NO-HOUSING-COSTS",
            "attempt_id": "a" * 32,
            "metadata_sha256": "b" * 64,
            "data_sha256": "c" * 64,
            "metadata_retrieved_at": "2026-09-25T12:00:00+00:00",
            "data_retrieved_at": "2026-09-25T12:00:01+00:00",
            "stored_at": "2026-09-25T12:00:02+00:00",
            "expires_at": "2026-10-25T12:00:00+02:00",
        }
        with self.assertRaises(RawDbAuditError):
            parse_artifact_rows(json.dumps([row]))
        row["expires_at"] = "2026-10-25T12:00:00+00:00"
        row["stored_at"] = "2026-09-25T12:00:02+02:00"
        with self.assertRaises(RawDbAuditError):
            parse_artifact_rows(json.dumps([row]))
        row["stored_at"] = "2026-09-25T12:00:02+00:00"
        row["source_key"] = "OTHER-SOURCE"
        with self.assertRaises(RawDbAuditError):
            parse_artifact_rows(json.dumps([row]))
        row["source_key"] = "SSB-14059-NO-HOUSING-COSTS"
        row["private_path"] = "/unwanted"
        with self.assertRaises(RawDbAuditError):
            parse_artifact_rows(json.dumps([row]))

    def test_row_and_size_limits_fail_closed(self) -> None:
        with self.assertRaises(RawDbAuditError):
            parse_artifact_rows(json.dumps([{}] * 1001))
        with self.assertRaises(RawDbAuditError):
            parse_artifact_rows("x" * (256 * 1024 + 1))

    def test_audit_distinguishes_expired_absence_from_early_missing(self) -> None:
        for state, expected_result, expected_exit in (
            ("expired_local_absent", "PASS", 0),
            ("database_only", "ATTENTION", 1),
            ("matched_expired", "ATTENTION", 1),
        ):
            with self.subTest(state=state):
                finding = RawPairRecoveryFinding("a" * 32, state, ())
                output = StringIO()
                with patch("scripts.ssb_raw_db_reconcile.read_local_artifact_rows", return_value=()):
                    with patch("scripts.ssb_raw_db_reconcile.reconcile_private_ssb_14059_pairs", return_value=(finding,)):
                        with redirect_stdout(output):
                            self.assertEqual(main(), expected_exit)
                self.assertEqual(json.loads(output.getvalue())["result"], expected_result)

    def test_attention_is_rechecked_without_silently_becoming_a_pass(self) -> None:
        missing = (RawPairRecoveryFinding("a" * 32, "database_only", ("local_pair_missing",)),)
        matched = (RawPairRecoveryFinding("a" * 32, "matched", ()),)
        for observations, expected in (
            ((missing, missing), "ATTENTION"),
            ((missing, matched), "CHANGED_DURING_AUDIT"),
        ):
            with self.subTest(expected=expected):
                output = StringIO()
                with patch("scripts.ssb_raw_db_reconcile.read_local_artifact_rows", return_value=()) as reader:
                    with patch("scripts.ssb_raw_db_reconcile.reconcile_private_ssb_14059_pairs", side_effect=observations) as comparator:
                        with redirect_stdout(output):
                            self.assertEqual(main(), 1)
                self.assertEqual(reader.call_count, 2)
                self.assertEqual(comparator.call_count, 2)
                self.assertEqual(json.loads(output.getvalue())["result"], expected)

    def test_changed_database_reference_is_reported_even_if_finding_label_stays_the_same(self) -> None:
        row = {
            "source_key": "SSB-14059-NO-HOUSING-COSTS",
            "attempt_id": "a" * 32,
            "metadata_sha256": "b" * 64,
            "data_sha256": "c" * 64,
            "metadata_retrieved_at": "2026-09-25T12:00:00+00:00",
            "data_retrieved_at": "2026-09-25T12:00:01+00:00",
            "stored_at": "2026-09-25T12:00:02+00:00",
            "expires_at": "2026-10-25T12:00:00+00:00",
        }
        first = parse_artifact_rows(json.dumps([row]))
        second = (replace(first[0], data_sha256="d" * 64),)
        missing = (RawPairRecoveryFinding("a" * 32, "database_only", ("local_pair_missing",)),)
        output = StringIO()
        with patch("scripts.ssb_raw_db_reconcile.read_local_artifact_rows", side_effect=(first, second)):
            with patch("scripts.ssb_raw_db_reconcile.reconcile_private_ssb_14059_pairs", return_value=missing):
                with redirect_stdout(output):
                    self.assertEqual(main(), 1)
        self.assertEqual(json.loads(output.getvalue())["result"], "CHANGED_DURING_AUDIT")

    def test_filesystem_error_is_blocked_without_exposing_private_path(self) -> None:
        output = StringIO()
        with patch("scripts.ssb_raw_db_reconcile.read_local_artifact_rows", return_value=()):
            with patch("scripts.ssb_raw_db_reconcile.reconcile_private_ssb_14059_pairs",
                       side_effect=OSError("permission denied: /private/raw/location")):
                with redirect_stdout(output):
                    self.assertEqual(main(), 2)
        report = json.loads(output.getvalue())
        self.assertEqual(report["result"], "BLOCKED")
        self.assertNotIn("/private/raw/location", output.getvalue())


if __name__ == "__main__":
    unittest.main()
