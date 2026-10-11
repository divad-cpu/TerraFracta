from datetime import timedelta
from hashlib import sha256
import json
import unittest
from tests.test_source_response_receipts import NOW,RID,context,reservation_payload
from workers.response_authority import parse_response_authority

PRINCIPAL='fictional_scoped_writer'
def authority_payload(receipt,phase='reserve',**changes):
    expected=context()
    p={'schemaVersion':1,'phase':phase,'principal':PRINCIPAL,'reservationId':RID,
      'runId':str(expected.work.run_id),'workClaimId':str(expected.work.lease_id),
      'registrationId':expected.registration_id,'maxBodyBytes':expected.max_body_bytes,
      'endpointSha256':sha256(expected.endpoint.encode()).hexdigest(),'receiptSha256':sha256(receipt).hexdigest(),
      'observedAt':NOW.isoformat(),'authorityExpiresAt':(NOW+timedelta(seconds=10)).isoformat()}
    return json.dumps({**p,**changes}).encode()

class AuthorityTests(unittest.TestCase):
    def parse(self,data=None,receipt=None,**changes):
        receipt=receipt or reservation_payload()
        return parse_response_authority(data or authority_payload(receipt),context(),
          phase='reserve',principal=PRINCIPAL,reservation_id=RID,receipt=receipt,now=NOW,**changes)
    def test_bound_shorter_authority_window(self):
        result=self.parse();self.assertEqual(result.remaining_seconds(NOW),10)
        self.assertEqual(result.remaining_seconds(NOW+timedelta(seconds=10)),0)
        self.assertEqual(result.remaining_seconds(NOW-timedelta(seconds=1)),0)
    def test_identity_phase_or_receipt_substitution_rejects(self):
        receipt=reservation_payload()
        for change in ({'phase':'dispatch'},{'principal':'foreign'},{'runId':RID},{'workClaimId':RID},
          {'registrationId':RID},{'receiptSha256':'a'*64},{'endpointSha256':'a'*64},{'maxBodyBytes':99}):
            with self.assertRaises(ValueError):self.parse(authority_payload(receipt,**change))
    def test_expired_future_naive_or_extended_windows_reject(self):
        receipt=reservation_payload()
        for change in ({'observedAt':(NOW+timedelta(seconds=1)).isoformat()},
          {'authorityExpiresAt':NOW.isoformat()},{'authorityExpiresAt':(NOW+timedelta(seconds=31)).isoformat()},
          {'authorityExpiresAt':'2026-10-01T06:00:05'},{'observedAt':'2026-10-01T06:00:00'}):
            with self.assertRaises(ValueError):self.parse(authority_payload(receipt,**change))
    def test_unknown_fields_duplicate_json_wrong_types_or_oversize_reject(self):
        receipt=reservation_payload()
        for data in (authority_payload(receipt,rawBody='private'),authority_payload(receipt,schemaVersion=True),
          authority_payload(receipt,maxBodyBytes=True),authority_payload(receipt).replace(b'{',b'{"phase":"dispatch",',1),b'x'*4097):
            with self.assertRaises(ValueError):self.parse(data)

if __name__=='__main__':unittest.main()
