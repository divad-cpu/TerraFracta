import unittest
import json
from pathlib import Path

from scripts.fictional_activation_payload import fictional_activation_payload
from scripts.update_rehearsal import fictional_request
from workers.update_request_identity import identify_update_request


class FictionalActivationPayloadTests(unittest.TestCase):
    def test_distinct_target_fixture_matches_current_parsed_input(self):
        payload = fictional_activation_payload(distinct_public_target=True)
        stored = json.loads((Path(__file__).resolve().parents[1] / "fixtures/fictional_machine_activation_payload.json").read_text())
        self.assertEqual(stored, payload)
        self.assertNotEqual(payload["retrievalUrl"], payload["draft"]["decision"]["publicCitationUrl"])
    def test_fixed_draft_and_eligible_trace_share_exact_evidence(self):
        payload = fictional_activation_payload()
        draft = payload["draft"]
        self.assertEqual(payload["fixtureKind"], "rollback_only_machine_activation")
        self.assertEqual(draft["publication"]["kind"], "draft")
        self.assertEqual(draft["observation"]["value"], "27.4")
        self.assertEqual(draft["decision"]["publicCitationUrl"], payload["retrievalUrl"])
        self.assertEqual(draft["publication"]["snapshot"]["claims"][0]["evidence"][0]["url"], payload["retrievalUrl"])
        self.assertEqual(payload["reasonCodes"], ["qualified_checks_passed"])
        self.assertEqual(len(payload["checkTrace"]), 9)
        self.assertTrue(all(value is True for value in payload["checkTrace"].values()))

    def test_fingerprint_is_for_publish_admission_and_standard_web_sample_is_unchanged(self):
        payload = fictional_activation_payload()
        shadow = identify_update_request(fictional_request("manual").invocation)
        publish = identify_update_request(fictional_request("manual", mode="publish_eligible").invocation)
        self.assertEqual(payload["requestFingerprint"], publish.request_fingerprint)
        self.assertNotEqual(payload["requestFingerprint"], shadow.request_fingerprint)
        self.assertEqual(fictional_request("manual").items[0].source.url, "https://example.org/fictional-table")


if __name__ == "__main__":
    unittest.main()
