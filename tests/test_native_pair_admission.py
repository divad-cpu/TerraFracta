"""Native readback matching, without a database, account or real source call."""
from datetime import datetime, timedelta, timezone
from dataclasses import replace
from hashlib import sha256
import json
import unittest

from tests.frozen_ssb_support import admitted_context
from workers.closed_ssb_worker import parse_closed_ssb_context
from workers.native_pair_admission import confirm_native_pair_admission
from workers.update_request_identity import canonical_update_request
from workers.private_pair_native_sql import (private_operation_sql,
    private_admission_sql, private_raw_binding_sql, PRIVATE_SCHEMA)


def admission_fixture(raw_context, pin, now):
    context = parse_closed_ssb_context(raw_context,now=now); work=context.metadata.work
    return {'schemaVersion':1,'principal':context.principal,'sourceInventorySha256':pin,
        'canonicalRequest':canonical_update_request(context.metadata.invocation),
        'runId':str(work.run_id),'workClaimId':str(work.lease_id),'pairId':context.pair_id,'workAttempt':1,
        'leaseExpiresAt':work.lease_expires_at.isoformat(),'deadlineAt':work.deadline_at.isoformat(),
        'scopeExpiresAt':work.lease_expires_at.isoformat(),'observedAt':now.isoformat(),
        'responseContexts':{kind:{'registrationId':request.registration_id,'sourceVersionId':version,
            'requestKey':request.request_key,'maxBodyBytes':request.max_body_bytes,
            'endpointSha256':sha256(request.endpoint.encode()).hexdigest()}
            for kind,request,version in (('metadata',context.metadata,context.metadata_version_id),
                                        ('data',context.data,context.data_version_id))}}


class NativePairAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,10,2,10,tzinfo=timezone.utc);self.pin='a'*64
        self.context,self.expected=admitted_context(self.pin,now=self.now)
        self.value=admission_fixture(self.context,self.pin,self.now)

    def confirm(self,value=None,**options):
        raw=json.dumps(self.value if value is None else value).encode()
        return confirm_native_pair_admission(raw,self.context,options.get('pin',self.pin),now=options.get('now',self.now))

    def test_exact_native_identity_matches_full_admission_and_has_no_mutable_permission_flag(self):
        parsed=self.confirm()
        self.assertEqual(parsed.context.metadata,self.expected['metadata'])
        self.assertEqual(parsed.context.data,self.expected['data'])
        self.assertEqual(parsed.source_fingerprint,self.pin)
        self.assertEqual(parsed.expires_at,self.expected['metadata'].work.lease_expires_at)
        with self.assertRaises(AttributeError):parsed.source_fingerprint='0'*64
        self.assertFalse(hasattr(parsed,'source_permission'))

    def test_actor_run_pair_inventory_attempt_and_canonical_request_substitution_refuse(self):
        for key,value in (('schemaVersion',True),('principal','other_actor'),('runId',self.value['pairId']),
                ('workClaimId',self.value['pairId']),('pairId',self.value['runId']),
                ('sourceInventorySha256','0'*64),('workAttempt',True),('workAttempt',2),('canonicalRequest','{}')):
            with self.subTest(key=key),self.assertRaises(ValueError):self.confirm({**self.value,key:value})
        for pin in ('A'*64,'a'*63,True,'0'*64):
            with self.assertRaises(ValueError):self.confirm(pin=pin)

    def test_either_response_registration_version_key_endpoint_and_bound_must_match(self):
        for kind in ('metadata','data'):
            for key,value in (('registrationId',self.value['pairId']),('sourceVersionId',self.value['pairId']),
                    ('requestKey','changed-key'),('endpointSha256','0'*64),('maxBodyBytes',True),('maxBodyBytes',65537)):
                changed=json.loads(json.dumps(self.value));changed['responseContexts'][kind][key]=value
                with self.subTest(kind=kind,key=key),self.assertRaises(ValueError):self.confirm(changed)

    def test_future_stale_shortened_lease_and_expired_scope_are_held(self):
        for key,value in (('observedAt',(self.now+timedelta(microseconds=1)).isoformat()),
                ('scopeExpiresAt',self.now.isoformat()),('scopeExpiresAt',(self.now+timedelta(seconds=31)).isoformat()),
                ('leaseExpiresAt',(self.now+timedelta(seconds=20)).isoformat()),
                ('deadlineAt',(self.now+timedelta(seconds=20)).isoformat()),('observedAt','NaN')):
            with self.subTest(key=key),self.assertRaises(ValueError):self.confirm({**self.value,key:value})
        with self.assertRaises(ValueError):self.confirm(now=self.now+timedelta(seconds=3,microseconds=1))
        self.confirm(now=self.now+timedelta(seconds=3))

    def test_duplicate_unknown_fields_nested_permissions_and_invalid_bytes_are_held(self):
        for key in ('sourcePermission','publicationEnabled','rawPath','connection','sql'):
            with self.assertRaises(ValueError):self.confirm({**self.value,key:True})
        raw=json.dumps(self.value).encode()
        for invalid in (raw[:-1]+b',"schemaVersion":1}',b'\xff',b'[]',b'x'*16385,b'{"schemaVersion":NaN}'):
            with self.assertRaises(ValueError):confirm_native_pair_admission(invalid,self.context,self.pin,now=self.now)
        changed=json.loads(raw);changed['responseContexts']['metadata']['sourcePermission']=True
        with self.assertRaises(ValueError):self.confirm(changed)


class PrivateNativeSQLTests(unittest.TestCase):
    def test_reader_and_binding_queries_have_fixed_no_argument_targets(self):
        self.assertTrue(private_admission_sql().endswith(PRIVATE_SCHEMA+'.read_admitted_context();'))
        self.assertTrue(private_raw_binding_sql().endswith(PRIVATE_SCHEMA+'.read_raw_pair_binding();'))
        sql=private_operation_sql('reserve_response',{'kind':'metadata'})
        self.assertTrue(sql.endswith(PRIVATE_SCHEMA+".reserve_response('metadata');"))
        with self.assertRaises(ValueError):private_operation_sql('read_closeout',{},raw_attempt_id='a'*32)

    def test_replacement_never_changes_a_matching_string_inside_a_receipt_literal(self):
        from workers.private_pair_native_sql import HEAD
        payload={'text':HEAD+'terra_pair_capture_test_api.read_closeout();'}
        import base64
        sql=private_operation_sql('confirm_response',{'kind':'metadata','phase':'reserve',
            'receipt':base64.b64encode(json.dumps(payload).encode()).decode()})
        self.assertIn('terra_pair_capture_test_api.read_closeout();',sql)
        self.assertTrue(sql.startswith(HEAD+PRIVATE_SCHEMA+'.confirm_response('))


if __name__=='__main__':unittest.main()
