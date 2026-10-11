"""One network-free integration path across pair transport, review and retention."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from workers.bounded_worker_process import WorkerOutput
from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL
from workers.ssb_14059_batch import assemble_private_ssb_14059_batch
from workers.ssb_14059_pair_transport import _encode_capture, fetch_ssb_14059_pair_with_deadline
from workers.ssb_14059_raw_store import RETENTION, prune_expired_ssb_14059_pairs, store_private_ssb_14059_pair
from workers.ssb_14059_recovery import ExpectedRawPair, reconcile_private_ssb_14059_pairs
from workers.ssb_14059_validation_proposal import (
    PrivatePairValidationProposal,
    propose_private_ssb_14059_pair_validation,
)


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class SSB14059OfflinePipelineTests(unittest.TestCase):
    def test_fixed_pair_passes_private_pipeline_and_expires(self) -> None:
        retrieved_at = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
        metadata_body = (FIXTURES / "ssb_14059_metadata_minimal_2024_2025.json").read_bytes()
        data_body = (FIXTURES / "ssb_14059_jsonstat_minimal_2024_2025.json").read_bytes()

        def child_result(kind: str, url: str, body: bytes) -> WorkerOutput:
            response = CapturedResponse(url, url, 0, 200, "application/json", body, retrieved_at)
            return WorkerOutput(
                returncode=0,
                stdout=_encode_capture(kind, response), stderr=b"",
            )

        responses = [
            child_result("metadata", METADATA_URL, metadata_body),
            child_result("data", DATA_URL, data_body),
        ]
        process = MagicMock()
        process.poll.return_value = 0
        with patch("workers.ssb_14059_pair_transport.subprocess.Popen", return_value=process), patch("workers.ssb_14059_pair_transport.communicate_bounded", side_effect=responses) as runner:
            with patch("workers.ssb_14059_pair_transport.monotonic", side_effect=[100,100,101,101,102,102,102,103,103,104,104,104]):
                metadata, data = fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(runner.call_count, 2)
        batch = assemble_private_ssb_14059_batch(
            metadata_response=metadata,
            data_response=data,
            previous_accepted_data=None,
        )
        self.assertEqual(batch.attention_reasons, ("first_response_pair",))
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(batch),
            PrivatePairValidationProposal("pending", None),
        )
        self.assertEqual([item.survey_year for item in batch.candidates], [2024, 2025])
        self.assertTrue(all(item.review_state == "unreviewed" for item in batch.candidates))

        with TemporaryDirectory() as temporary:
            root = Path(temporary) / "raw"
            saved = store_private_ssb_14059_pair(metadata, data, root=root, now=retrieved_at)
            manifest = json.loads((saved.directory / "manifest.json").read_text())
            self.assertEqual(manifest["metadata"]["sha256"], sha256(metadata_body).hexdigest())
            self.assertEqual(manifest["data"]["sha256"], sha256(data_body).hexdigest())
            self.assertEqual(saved.expires_at, retrieved_at + RETENTION)
            reference = ExpectedRawPair(
                attempt_id=saved.attempt_id,
                metadata_sha256=batch.metadata.raw_sha256,
                data_sha256=batch.data.raw_sha256,
                expires_at=saved.expires_at,
                metadata_retrieved_at=metadata.retrieved_at,
                data_retrieved_at=data.retrieved_at,
                stored_at=retrieved_at,
            )
            self.assertEqual(
                reconcile_private_ssb_14059_pairs([reference], root=root, now=retrieved_at)[0].state,
                "matched",
            )
            self.assertEqual(
                reconcile_private_ssb_14059_pairs(
                    [replace(reference, stored_at=retrieved_at.replace(microsecond=1))],
                    root=root, now=retrieved_at,
                )[0].issues,
                ("storage_time_mismatch",),
            )
            self.assertEqual(prune_expired_ssb_14059_pairs(root=root, now=saved.expires_at, dry_run=True), 1)
            self.assertTrue(saved.directory.exists())
            self.assertEqual(prune_expired_ssb_14059_pairs(root=root, now=saved.expires_at), 1)
            self.assertFalse(saved.directory.exists())
            self.assertEqual(
                reconcile_private_ssb_14059_pairs([reference], root=root, now=saved.expires_at)[0].state,
                "expired_local_absent",
            )


if __name__ == "__main__":
    unittest.main()
