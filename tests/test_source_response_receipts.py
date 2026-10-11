from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import unittest
from uuid import UUID

from scripts.fictional_run_admission_cases import fictional_request
from workers.source_response_receipts import (ResponseRequest, parse_response_reservation,
    parse_response_dispatch, parse_response_settlement, validate_response_request)
from workers.update_request_identity import identify_update_request
from workers.update_run_work import WorkClaim

NOW = datetime(2026, 10, 1, 6, 0, tzinfo=timezone.utc)
RUN = '11111111-1111-4111-8111-111111111111'
CLAIM = '22222222-2222-4222-8222-222222222222'
REG = '33333333-3333-4333-8333-333333333333'
RID = '44444444-4444-4444-8444-444444444444'


def context():
    return ResponseRequest(fictional_request(), WorkClaim('claimed', UUID(RUN), UUID(CLAIM), 1,
        NOW+timedelta(seconds=30), NOW+timedelta(seconds=300), NOW),
        REG, 'fictional:body:1', 'https://example.org/fictional-body', 100)


def base(status):
    return {'schemaVersion':1, 'status':status, 'reservationId':RID, 'runId':RUN,
            'requestFingerprint':identify_update_request(fictional_request()).request_fingerprint,
            'workClaimId':CLAIM}


def reservation_payload(**changes):
    p = {**base('reserved'), 'registrationId':REG, 'requestKey':context().request_key,
         'maxBodyBytes':100, 'reservedBytes':101,
         'endpointSha256':sha256(context().endpoint.encode()).hexdigest(), 'reservedAt':NOW.isoformat()}
    return json.dumps({**p, **changes}).encode()


def dispatch_payload(**changes):
    return json.dumps({**base('dispatched'), 'dispatchedAt':NOW.isoformat(), **changes}).encode()


def settlement_payload(**changes):
    return json.dumps({**base('settled'), 'outcome':'measured', 'bodyBytes':3, 'chargedBytes':3,
        'contentSha256':sha256(b'abc').hexdigest(), 'settledAt':NOW.isoformat(), **changes}).encode()


class ReceiptTests(unittest.TestCase):
    def reserve(self, data=None, expected=None, now=NOW):
        return parse_response_reservation(data or reservation_payload(), expected or context(), now=now)

    def dispatch(self, data=None):
        return parse_response_dispatch(data or dispatch_payload(), context(), self.reserve(), now=NOW)

    def settle(self, data=None, **changes):
        options = {'outcome':'measured', 'body_bytes':3, 'content_sha256':sha256(b'abc').hexdigest(), 'now':NOW}
        return parse_response_settlement(data or settlement_payload(), context(), self.reserve(),
                                         self.dispatch(), **{**options, **changes})

    def test_bound_reservation_and_exact_replay(self):
        self.assertEqual(self.reserve().reserved_bytes, 101)
        self.assertEqual(self.reserve(reservation_payload(status='existing')).status, 'existing')

    def test_same_fence_renewal_can_acknowledge_older_reservation(self):
        renewed=replace(context().work,status='renewed',observed_at=NOW+timedelta(seconds=10),
                        lease_expires_at=NOW+timedelta(seconds=40))
        expected=replace(context(),work=renewed)
        result=self.reserve(reservation_payload(status='existing'),expected,now=NOW+timedelta(seconds=11))
        self.assertEqual(result.reserved_at,NOW)
        with self.assertRaises(ValueError):
            self.reserve(reservation_payload(status='reserved'),expected,now=NOW+timedelta(seconds=11))

    def test_dispatch_and_no_new_authority_on_replay(self):
        self.assertEqual(self.dispatch().reservation_id, RID)
        self.assertEqual(self.dispatch(dispatch_payload(status='existing')).status, 'existing')

    def test_measured_settlement_and_exact_replay(self):
        self.assertEqual(self.settle().charged_bytes, 3)
        self.assertEqual(self.settle(settlement_payload(status='existing')).status, 'existing')

    def test_uncertain_settlement_charges_capacity(self):
        p = settlement_payload(outcome='uncertain', bodyBytes=101, chargedBytes=101, contentSha256=None)
        s = self.settle(p, outcome='uncertain', body_bytes=101, content_sha256=None)
        self.assertEqual(s.charged_bytes,101)

    def test_identity_field_substitution_rejected(self):
        for change in ({'runId':RID}, {'workClaimId':RID}, {'requestFingerprint':'a'*64},
                       {'registrationId':RID}, {'requestKey':'foreign:body'},
                       {'endpointSha256':'a'*64}, {'maxBodyBytes':99}, {'reservedBytes':100},
                       {'reservationId':'bad'}, {'reservationId':'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.reserve(reservation_payload(**change))

    def test_reserved_shape_types_and_extra_keys(self):
        for change in ({'schemaVersion':True}, {'maxBodyBytes':100.0}, {'reservedBytes':'101'},
                       {'status':'dispatched'}, {'endpoint':'https://example.org/extra'},
                       {'secret':'placeholder'}, {'rawBody':'private'}, {'reservedAt':None}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.reserve(reservation_payload(**change))

    def test_duplicate_invalid_large_json(self):
        for data in (b'{"status":"reserved",'+reservation_payload()[1:], b'[]', b'null', b'{',
                     b'x'*4097, b'\xff', b'[[['+b'['*2000):
            with self.subTest(data=data[:20]), self.assertRaises(ValueError):
                self.reserve(data)

    def test_missing_fields_in_all_receipts(self):
        for payload, parser in ((reservation_payload(),self.reserve),
                                (dispatch_payload(),self.dispatch), (settlement_payload(),self.settle)):
            for field in json.loads(payload):
                p = json.loads(payload); del p[field]
                with self.subTest(field=field), self.assertRaises(ValueError):
                    parser(json.dumps(p).encode())

    def test_expired_future_naive_and_before_claim(self):
        for changes in ({'reservedAt':(NOW-timedelta(seconds=1)).isoformat()},
                        {'reservedAt':(NOW+timedelta(seconds=1)).isoformat()},
                        {'reservedAt':NOW.replace(tzinfo=None).isoformat()}, {'reservedAt':'infinity'}):
            with self.assertRaises(ValueError):self.reserve(reservation_payload(**changes))
        for now in (NOW+timedelta(seconds=30), NOW.replace(tzinfo=None)):
            with self.assertRaises(ValueError):self.reserve(now=now)

    def test_zero_fractional_or_above_cap_bound_rejected(self):
        for n in (0,-1,True,100.0,2_000_000):
            with self.assertRaises(ValueError):
                self.reserve(expected=replace(context(),max_body_bytes=n))

    def test_untrusted_url_shape_or_context_rejected(self):
        for url in ('http://example.org/x','https://localhost/x','https://example.org/x?token=placeholder'):
            with self.assertRaises(ValueError):
                self.reserve(expected=replace(context(),endpoint=url))
        for work in (replace(context().work,status='busy'), replace(context().work,lease_id=None),
                     replace(context().work,observed_at=NOW+timedelta(seconds=1))):
            with self.assertRaises(ValueError):
                validate_response_request(replace(context(),work=work),NOW)

    def test_dispatch_cannot_change_bound_identity_or_timestamp(self):
        for change in ({'reservationId':REG}, {'runId':REG}, {'workClaimId':REG},
                       {'dispatchedAt':(NOW-timedelta(seconds=1)).isoformat()},
                       {'dispatchedAt':(NOW+timedelta(seconds=1)).isoformat()},
                       {'status':'reserved'}, {'endpoint':'https://example.org/forged'}):
            with self.assertRaises(ValueError):self.dispatch(dispatch_payload(**change))

    def test_settlement_cannot_refund_uncertainty_or_forge_measurement(self):
        for change in ({'bodyBytes':2}, {'chargedBytes':2}, {'contentSha256':'a'*64},
                       {'outcome':'uncertain'}, {'bodyBytes':True}, {'chargedBytes':3.0},
                       {'settledAt':(NOW-timedelta(seconds=1)).isoformat()}, {'runId':REG}):
            with self.assertRaises(ValueError):self.settle(settlement_payload(**change))
        for fields in ({'outcome':'uncertain','body_bytes':1,'content_sha256':None},
                       {'body_bytes':102}, {'body_bytes':True}, {'content_sha256':None}):
            with self.assertRaises(ValueError):self.settle(**fields)


if __name__ == '__main__':unittest.main()
