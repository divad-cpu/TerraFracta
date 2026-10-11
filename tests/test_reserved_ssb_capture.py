from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from tests.test_source_response_receipts import NOW,RID,context
from workers.confirmed_response_backend import ConfirmedResponseBackend
from workers.reserved_response_capture import ReservedCaptureError
from workers.reserved_ssb_capture import capture_reserved_ssb_once,capture_reserved_ssb_pair
from workers.ssb_14059_capture import CapturedResponse,DATA_URL,METADATA_URL,MAX_RESPONSE_BYTES
from workers.update_request_identity import identify_update_request

ROOT=Path(__file__).resolve().parents[1]
PRINCIPAL='fictional_reserved_ssb'

def contexts():
    baseline=context()
    return (replace(baseline,endpoint=METADATA_URL,max_body_bytes=MAX_RESPONSE_BYTES,request_key='fictional:ssb:metadata'),
      replace(baseline,endpoint=DATA_URL,max_body_bytes=MAX_RESPONSE_BYTES,request_key='fictional:ssb:data',
        registration_id='55555555-5555-4555-8555-555555555555'))

class Ledger:
    def __init__(self,expected,events):self.expected=expected;self.events=events;self.dispatched=False;self.charge=None;self.fail=False
    def base(self,status):
        e=self.expected
        return {'schemaVersion':1,'status':status,'reservationId':RID,'runId':str(e.work.run_id),
          'workClaimId':str(e.work.lease_id),'requestFingerprint':identify_update_request(e.invocation).request_fingerprint}
    def reserve(self,expected):
        self.events.append((self.expected.request_key,'reserve'))
        return json.dumps({**self.base('reserved'),'registrationId':expected.registration_id,'requestKey':expected.request_key,
          'maxBodyBytes':MAX_RESPONSE_BYTES,'reservedBytes':MAX_RESPONSE_BYTES+1,'endpointSha256':sha256(expected.endpoint.encode()).hexdigest(),'reservedAt':NOW.isoformat()}).encode()
    def dispatch(self,expected,reservation):
        self.events.append((self.expected.request_key,'dispatch'))
        status='existing' if self.dispatched else 'dispatched';self.dispatched=True
        return json.dumps({**self.base(status),'dispatchedAt':NOW.isoformat()}).encode()
    def settle(self,expected,reservation,**data):
        self.events.append((self.expected.request_key,'settle'));self.charge=data
        if self.fail:raise ValueError('Fictional settlement failure')
        return json.dumps({**self.base('settled'),'outcome':data['outcome'],'bodyBytes':data['body_bytes'],'chargedBytes':data['body_bytes'],
          'contentSha256':data['content_sha256'],'settledAt':NOW.isoformat()}).encode()

class Confirmer:
    def __init__(self,expected,events):self.expected=expected;self.events=events;self.fail=None
    def confirm(self,phase,receipt):
        if phase==self.fail:raise ValueError('Fictional authority expired')
        e=self.expected;self.events.append((e.request_key,'confirm:'+phase))
        return json.dumps({'schemaVersion':1,'phase':phase,'principal':PRINCIPAL,'reservationId':RID,
          'runId':str(e.work.run_id),'workClaimId':str(e.work.lease_id),'registrationId':e.registration_id,
          'maxBodyBytes':e.max_body_bytes,'endpointSha256':sha256(e.endpoint.encode()).hexdigest(),'receiptSha256':sha256(receipt).hexdigest(),
          'observedAt':NOW.isoformat(),'authorityExpiresAt':(NOW+timedelta(seconds=10)).isoformat()}).encode()

class ReservedSSBTests(unittest.TestCase):
    def setUp(self):
        self.events=[];self.ticks=0.;self.backends={};self.ledgers={};self.confirmers={};self.wires={}
        for kind,name in (('metadata','ssb_14059_metadata_minimal_2024_2025.json'),('data','ssb_14059_jsonstat_minimal_2024_2025.json')):
            self.wires[kind]=json.dumps(json.loads((ROOT/'fixtures'/name).read_text()),separators=(',',':')).encode()
    def factory(self,expected):
        if expected.request_key not in self.backends:
            ledger=Ledger(expected,self.events);confirmer=Confirmer(expected,self.events)
            self.ledgers[expected.request_key]=ledger;self.confirmers[expected.request_key]=confirmer
            self.backends[expected.request_key]=ConfirmedResponseBackend(expected,PRINCIPAL,ledger,confirmer,utc_now=lambda:NOW,monotonic=lambda:self.ticks)
        return self.backends[expected.request_key]
    def fetch(self,kind,*,deadline):
        expected=contexts()[0 if kind=='metadata' else 1]
        self.assertIn((expected.request_key,'confirm:dispatch'),self.events)
        self.assertLessEqual(deadline,10);self.events.append((kind,'fetch'))
        url=METADATA_URL if kind=='metadata' else DATA_URL
        return CapturedResponse(url,url,0,200,'application/json',self.wires[kind],NOW)
    def once(self,kind='data',**options):
        expected=contexts()[0 if kind=='metadata' else 1]
        return capture_reserved_ssb_once(kind,expected,self.factory(expected),options.pop('fetcher',self.fetch),
          pair_deadline=10.,utc_now=lambda:NOW,monotonic=lambda:self.ticks,**options)
    def pair(self,**options):
        return capture_reserved_ssb_pair(*contexts(),self.factory,options.pop('fetcher',self.fetch),
          utc_now=lambda:NOW,monotonic=lambda:self.ticks,**options)
    def test_fixed_pair_confirms_each_dispatch_and_charges_exact_bodies(self):
        metadata,data=self.pair();self.assertEqual(metadata.kind,'metadata');self.assertEqual(data.kind,'data')
        self.assertEqual(data.parsed.raw_sha256,sha256(data.capture.body).hexdigest())
        self.assertEqual([x.receipt.settlement.charged_bytes for x in (metadata,data)],[len(self.wires['metadata']),len(self.wires['data'])])
        self.assertEqual([x for x in self.events if x[1]=='fetch'],[('metadata','fetch'),('data','fetch')])
    def test_metadata_failure_stops_pair_before_data_reservation(self):
        def broken(kind,*,deadline):raise TimeoutError('Fictional blocked broker')
        with self.assertRaises(ReservedCaptureError):self.pair(fetcher=broken)
        self.assertEqual(set(self.ledgers),{contexts()[0].request_key});self.assertEqual(next(iter(self.ledgers.values())).charge['body_bytes'],MAX_RESPONSE_BYTES+1)
    def test_exact_dispatch_replay_never_calls_broker(self):
        e=contexts()[1];self.factory(e);self.ledgers[e.request_key].dispatched=True
        self.assertIsNone(self.once(fetcher=lambda *a,**k:self.fail('Replay fetch')))
    def test_pair_replay_holds_incomplete_pair_without_new_data_work(self):
        e=contexts()[0];self.factory(e);self.ledgers[e.request_key].dispatched=True
        with self.assertRaisesRegex(ValueError,'already exists'):self.pair(fetcher=lambda *a,**k:self.fail('Replay fetch'))
        self.assertEqual(len(self.ledgers),1)
    def test_postcommit_authority_denial_prevents_real_transport(self):
        e=contexts()[1];self.factory(e);self.confirmers[e.request_key].fail='dispatch'
        with self.assertRaises(ValueError):self.once(fetcher=lambda *a,**k:self.fail('Unconfirmed transport'))
    def test_foreign_url_redirect_status_encoding_or_cached_capture_retains_full_charge(self):
        for change in ({'final_url':'https://example.org/other'},{'redirect_count':1},{'status':304},
          {'content_type':'text/html'},{'body':b''},{'body':b'x'*(MAX_RESPONSE_BYTES+1)},
          {'retrieved_at':NOW-timedelta(seconds=1)},{'retrieved_at':NOW+timedelta(seconds=1)}):
            self.setUp()
            def changed(kind,*,deadline):return replace(self.fetch(kind,deadline=deadline),**change)
            with self.assertRaises(ReservedCaptureError):self.once(fetcher=changed)
            ledger=next(iter(self.ledgers.values()));self.assertEqual(ledger.charge['outcome'],'uncertain');self.assertEqual(ledger.charge['body_bytes'],MAX_RESPONSE_BYTES+1)
    def test_invalid_json_is_not_source_coverage_even_after_measured_charge(self):
        self.wires['data']=b'{bad'
        with self.assertRaises(ValueError):self.once()
        self.assertEqual(next(iter(self.ledgers.values())).charge['body_bytes'],4)
    def test_failed_settlement_returns_no_accepted_capture(self):
        e=contexts()[1];self.factory(e);self.ledgers[e.request_key].fail=True
        with self.assertRaises(ReservedCaptureError):self.once()
    def test_one_parent_deadline_cannot_reset_for_second_response(self):
        seen=[]
        def slow(kind,*,deadline):
            seen.append(deadline);wire=self.fetch(kind,deadline=deadline);self.ticks+=6;return wire
        with self.assertRaises(ReservedCaptureError):self.pair(fetcher=slow)
        self.assertEqual(seen,[10.,10.]);self.assertEqual(self.ledgers[contexts()[1].request_key].charge['outcome'],'uncertain')
    def test_parser_cannot_return_late_result_after_measured_settlement(self):
        from workers import reserved_ssb_capture as module
        parser=module.parse_captured_ssb_14059
        def late(capture):result=parser(capture);self.ticks=11;return result
        with patch.object(module,'parse_captured_ssb_14059',late),self.assertRaisesRegex(ValueError,'parsing completed'):
            self.once()
    def test_mismatching_metadata_version_holds_entire_pair(self):
        raw=json.loads(self.wires['metadata']);raw['updated']='2026-04-15T06:00:00Z';self.wires['metadata']=json.dumps(raw).encode()
        with self.assertRaises(ValueError):self.pair()
    def test_pair_preflight_rejects_wrong_context_or_missing_probe_capacity_before_writes(self):
        m,d=contexts()
        for other in (replace(d,endpoint=DATA_URL+'&extra=1'),replace(d,registration_id=m.registration_id),replace(d,request_key=m.request_key),
          replace(d,work=replace(d.work,lease_id=d.work.run_id)),replace(d,max_body_bytes=MAX_RESPONSE_BYTES-1)):
            with self.assertRaises(ValueError):capture_reserved_ssb_pair(m,other,self.factory,self.fetch,utc_now=lambda:NOW,monotonic=lambda:0)
        invocation=replace(m.invocation,limits=replace(m.invocation.limits,max_response_bytes=2*MAX_RESPONSE_BYTES))
        with self.assertRaises(ValueError):capture_reserved_ssb_pair(replace(m,invocation=invocation),replace(d,invocation=invocation),self.factory,self.fetch,utc_now=lambda:NOW,monotonic=lambda:0)
        invocation=replace(m.invocation,limits=replace(m.invocation.limits,max_items=1,max_retries=0))
        with self.assertRaises(ValueError):capture_reserved_ssb_pair(replace(m,invocation=invocation),replace(d,invocation=invocation),self.factory,self.fetch,utc_now=lambda:NOW,monotonic=lambda:0)
        self.assertEqual(self.events,[])

if __name__=='__main__':unittest.main()
