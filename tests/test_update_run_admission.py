"""Private database admission responses remain distinct from publication authority."""

from dataclasses import replace
import json
import unittest

from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import identify_update_request
from workers.update_run_admission import parse_run_admission


def receipt(request=None, **changes):
    request=request or fictional_request()
    identity=identify_update_request(request)
    payload={"schemaVersion":1,"status":"admitted",
        "runId":"11111111-1111-4111-8111-111111111111",
        "requestKey":identity.request_key,"requestFingerprint":identity.request_fingerprint,
        "runState":"queued","commitState":"none","visibilityState":"not_required"}
    payload.update(changes)
    return json.dumps(payload).encode("utf-8")


class UpdateRunAdmissionTests(unittest.TestCase):
    def test_exact_queued_response_is_an_admission(self):
        result=parse_run_admission(receipt(),fictional_request())
        self.assertEqual(result.status,"admitted")
        self.assertEqual(str(result.run_id),"11111111-1111-4111-8111-111111111111")
        self.assertEqual(result.commit_state,"none")

    def test_completed_existing_response_is_not_restarted(self):
        result=parse_run_admission(receipt(status="existing",runState="completed"),fictional_request())
        self.assertEqual(result.status,"existing")
        self.assertEqual(result.run_state,"completed")

    def test_stale_or_changed_request_identity_is_rejected(self):
        for changed in (replace(fictional_request(),policy_version="fictional-v2"),
                        replace(fictional_request(),request_key="fictional:other")):
            with self.assertRaisesRegex(ValueError,"Admission receipt is invalid"):
                parse_run_admission(receipt(),changed)

    def test_extra_missing_duplicate_and_unexpected_private_fields_reject(self):
        payload=json.loads(receipt())
        missing=payload.copy()
        del missing["requestFingerprint"]
        for data in (receipt(rawSource="fictional"),receipt(authToken="fictional-placeholder"),
                     json.dumps(missing).encode(),b'{"schemaVersion":1,'+receipt()[1:]):
            with self.assertRaises(ValueError):
                parse_run_admission(data,fictional_request())

    def test_malformed_oversized_and_wrong_runtime_types_reject(self):
        for data in (None,"{}",b"{}",b"null",b"[]",b"{",b"\xff",b" "*4097,
                     b"["*2000+b"]"*2000):
            with self.assertRaises(ValueError):
                parse_run_admission(data,fictional_request())

    def test_all_ids_use_exact_database_uuid_spelling(self):
        for value in ("11111111111141118111111111111111",
                      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
                      "11111111-1111-5111-8111-111111111111",
                      "00000000-0000-0000-0000-000000000000",None):
            with self.assertRaises(ValueError):
                parse_run_admission(receipt(runId=value),fictional_request())

    def test_invalid_schema_states_and_boolean_version_reject(self):
        for changes in ({"schemaVersion":True},{"status":"authorized"},{"runState":"active"},
                        {"commitState":"accepted"},{"visibilityState":"public"},
                        {"runState":"completed"},{"requestFingerprint":"x"*64}):
            with self.assertRaises(ValueError):
                parse_run_admission(receipt(**changes),fictional_request())

    def test_shadow_response_cannot_claim_a_public_commit(self):
        with self.assertRaises(ValueError):
            parse_run_admission(receipt(status="existing",runState="completed",
                commitState="committed",visibilityState="pending"),fictional_request())

    def test_committed_existing_response_keeps_unverified_visibility(self):
        request=replace(fictional_request(),mode="publish_eligible")
        result=parse_run_admission(receipt(request,status="existing",runState="completed",
            commitState="committed",visibilityState="pending"),request)
        self.assertEqual(result.visibility_state,"pending")

    def test_visibility_cannot_be_verified_without_a_commit(self):
        for visibility in ("pending","verified","mixed","failed"):
            with self.assertRaises(ValueError):
                parse_run_admission(receipt(status="existing",visibilityState=visibility),fictional_request())


if __name__=="__main__":
    unittest.main()
