"""Independent expectation binding for an untrusted closeout message."""

from dataclasses import replace
from datetime import timedelta
import json
import unittest

from tests.test_update_run_completion import NOW, OTHER, manifest, decision
from workers.update_run_closeout import completion_summary_payload, parse_run_closeout
from workers.update_run_completion import reconcile_run_completion


def expected():
    return reconcile_run_completion(manifest(), (decision("held"),), (), (), now=NOW)


def payload():
    return {"schemaVersion": 1, "status": "closed", "runId": manifest().run_id,
            "requestFingerprint": manifest().request_fingerprint, "workClaimId": OTHER,
            "manifestSha256": expected().manifest_sha256, "finishedAt": NOW.isoformat(),
            "summary": completion_summary_payload(expected())}


def parse(data):
    return parse_run_closeout(json.dumps(data).encode(), manifest(), OTHER, expected(), started_at=NOW-timedelta(minutes=1), now=NOW)


class CloseoutTests(unittest.TestCase):
    def test_exact_and_replayed_receipts_keep_the_original_finish(self):
        self.assertEqual(parse(payload()).summary, expected())
        data = payload()
        data["status"] = "existing_closeout"
        data["finishedAt"] = (NOW - timedelta(seconds=30)).isoformat()
        self.assertEqual(parse(data).finished_at, NOW - timedelta(seconds=30))

    def test_separate_run_manifest_work_claim_and_fingerprint_are_bound(self):
        for key, value in (("runId", OTHER), ("workClaimId", manifest().run_id),
                           ("requestFingerprint", "b" * 64), ("manifestSha256", "b" * 64)):
            data = payload(); data[key] = value
            with self.assertRaises(ValueError):
                parse(data)

    def test_changed_counters_sources_stage_and_unknown_private_fields_reject(self):
        for key, value in (("expectedItems", True), ("decidedItems", 1.0),
                           ("heldItems", 0), ("coveredSourceKeys", ["other-source"]),
                           ("runState", "partial"), ("visibilityState", "verified"),
                           ("rawSource", "fictional-placeholder")):
            data = payload(); data["summary"][key] = value
            with self.assertRaises(ValueError):
                parse(data)
        data = payload(); data["ownerCredential"] = "fictional-placeholder"
        with self.assertRaises(ValueError):
            parse(data)

    def test_duplicate_keys_wrong_schema_and_bad_time_reject(self):
        encoded = json.dumps(payload()).encode()
        for data in (b'{"status":"closed",' + encoded[1:], encoded.replace(b'"heldItems": 1', b'"heldItems": 1, "heldItems": 1'),
                     b"\xff", b"[]", b" " * 16385):
            with self.assertRaises(ValueError):
                parse_run_closeout(data, manifest(), OTHER, expected(), started_at=NOW-timedelta(minutes=1), now=NOW)
        for key, value in (("schemaVersion", True), ("status", "verified"),
                           ("finishedAt", NOW.replace(tzinfo=None).isoformat()),
                           ("finishedAt", (NOW + timedelta(seconds=1)).isoformat()),
                           ("finishedAt", (NOW - timedelta(minutes=2)).isoformat()),
                           ("finishedAt", NOW.isoformat().replace("T", " ")),
                           ("finishedAt", "infinity")):
            data = payload(); data[key] = value
            with self.assertRaises(ValueError):
                parse(data)

    def test_malformed_expectations_do_not_expand_processing_authority(self):
        for summary in (replace(expected(), manifest_sha256="b" * 64), replace(expected(), visibility_state="verified")):
            with self.assertRaises(ValueError):
                parse_run_closeout(json.dumps(payload()).encode(), manifest(), OTHER, summary, started_at=NOW-timedelta(minutes=1), now=NOW)


if __name__ == "__main__":
    unittest.main()
