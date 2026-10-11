"""Work response and clock boundaries for the future private driver."""

from dataclasses import replace
from datetime import datetime,timedelta,timezone
import json
import unittest
from uuid import UUID

from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import identify_update_request
from workers.update_run_admission import RunAdmission
from workers.update_run_work import parse_work_claim,parse_work_renewal,remaining_work_seconds


NOW=datetime(2026,9,30,14,0,tzinfo=timezone.utc)
RUN=UUID("11111111-1111-4111-8111-111111111111")
LEASE="22222222-2222-4222-8222-222222222222"


def admission(request=None):
    identity=identify_update_request(request or fictional_request())
    return RunAdmission("admitted",RUN,identity.request_key,identity.request_fingerprint,
                        "queued","none","not_required")


def payload(**changes):
    data={"schemaVersion":1,"status":"claimed","runId":str(RUN),"leaseId":LEASE,"attempt":1,
          "observedAt":NOW.isoformat(),"leaseExpiresAt":(NOW+timedelta(seconds=30)).isoformat(),
          "deadlineAt":(NOW+timedelta(seconds=300)).isoformat()}
    data.update(changes)
    return json.dumps(data).encode()


class UpdateRunWorkTests(unittest.TestCase):
    def test_exact_claim_has_only_remaining_lease_time(self):
        claim=parse_work_claim(payload(),fictional_request(),admission(),NOW)
        self.assertEqual(claim.status,"claimed")
        self.assertEqual(remaining_work_seconds(claim,NOW),30)
        self.assertEqual(remaining_work_seconds(claim,NOW+timedelta(seconds=29.5)),0)
        self.assertEqual(remaining_work_seconds(claim,NOW+timedelta(seconds=31)),0)

    def test_existing_claim_preserves_attempt_and_fencing_id(self):
        claim=parse_work_claim(payload(status="existing_claim",attempt=2),fictional_request(),admission(),NOW)
        self.assertEqual(claim.attempt,2)
        self.assertEqual(str(claim.lease_id),LEASE)

    def test_held_results_carry_no_lease_or_work_budget(self):
        for status in ("busy","stale_claim","deadline_reached","attempt_limit","finished"):
            data=json.dumps({"schemaVersion":1,"status":status,"runId":str(RUN)}).encode()
            claim=parse_work_claim(data,fictional_request(),admission(),NOW)
            self.assertIsNone(claim.lease_id)
            self.assertEqual(remaining_work_seconds(claim,NOW),0)
            with self.assertRaises(ValueError):
                parse_work_claim(payload(status=status),fictional_request(),admission(),NOW)

    def test_mismatch_extra_fields_wrong_types_and_duplicate_keys_reject(self):
        for data in (payload(runId=LEASE),payload(attempt=True),payload(attempt=3),payload(attempt=0),
                     payload(leaseId="bad"),payload(schemaVersion=True),payload(rawSource="fictional"),
                     payload(workerCredential="fictional-placeholder"),
                     b'{"status":"claimed",'+payload()[1:]):
            with self.assertRaises(ValueError):
                parse_work_claim(data,fictional_request(),admission(),NOW)

    def test_request_and_admission_are_bound(self):
        with self.assertRaises(ValueError):
            parse_work_claim(payload(),replace(fictional_request(),policy_version="fictional-v2"),admission(),NOW)
        with self.assertRaises(ValueError):
            parse_work_claim(payload(),fictional_request(),None,NOW)

    def test_expired_future_overlong_and_naive_windows_reject(self):
        for changes in ({"leaseExpiresAt":NOW.isoformat()},
                        {"observedAt":(NOW+timedelta(seconds=1)).isoformat()},
                        {"leaseExpiresAt":(NOW+timedelta(seconds=31)).isoformat()},
                        {"deadlineAt":(NOW+timedelta(seconds=301)).isoformat()},
                        {"deadlineAt":(NOW+timedelta(seconds=20)).isoformat()},
                        {"observedAt":"2026-09-30T14:00:00"},
                        {"leaseExpiresAt":"infinity"}):
            with self.assertRaises(ValueError):
                parse_work_claim(payload(**changes),fictional_request(),admission(),NOW)
        with self.assertRaises(ValueError):
            parse_work_claim(payload(),fictional_request(),admission(),NOW.replace(tzinfo=None))

    def test_short_admitted_duration_caps_the_entire_window(self):
        request=replace(fictional_request(),limits=replace(fictional_request().limits,max_duration_seconds=5))
        with self.assertRaises(ValueError):
            parse_work_claim(payload(),request,admission(request),NOW)
        claim=parse_work_claim(payload(leaseExpiresAt=(NOW+timedelta(seconds=5)).isoformat(),
            deadlineAt=(NOW+timedelta(seconds=5)).isoformat()),request,admission(request),NOW)
        self.assertEqual(remaining_work_seconds(claim,NOW),5)

    def test_renewal_keeps_id_attempt_and_original_deadline(self):
        claim=parse_work_claim(payload(),fictional_request(),admission(),NOW)
        data=json.loads(payload(status="renewed",observedAt=(NOW+timedelta(seconds=10)).isoformat(),
                               leaseExpiresAt=(NOW+timedelta(seconds=40)).isoformat()))
        del data["attempt"]
        renewed=parse_work_renewal(json.dumps(data).encode(),fictional_request(),claim,NOW+timedelta(seconds=10))
        self.assertEqual(renewed.lease_id,claim.lease_id)
        self.assertEqual(renewed.deadline_at,claim.deadline_at)
        self.assertEqual(renewed.attempt,1)

    def test_renewal_cannot_extend_deadline_change_holder_or_revive_expired_lease(self):
        claim=parse_work_claim(payload(),fictional_request(),admission(),NOW)
        for changes in ({"deadlineAt":(NOW+timedelta(seconds=301)).isoformat()},
                        {"leaseId":str(RUN)},
                        {"observedAt":(NOW+timedelta(seconds=30)).isoformat(),
                         "leaseExpiresAt":(NOW+timedelta(seconds=60)).isoformat()}):
            data=json.loads(payload(status="renewed",**changes))
            del data["attempt"]
            with self.assertRaises(ValueError):
                parse_work_renewal(json.dumps(data).encode(),fictional_request(),claim,NOW+timedelta(seconds=30))

    def test_malformed_unbounded_and_empty_work_receipts_reject(self):
        for data in (None,"{}",b"{}",b"null",b"[]",b"{",b"\xff",b" "*4097,
                     b"["*2000+b"]"*2000):
            with self.assertRaises(ValueError):
                parse_work_claim(data,fictional_request(),admission(),NOW)


if __name__=="__main__":
    unittest.main()
