"""Supplied response assertions must precede accepted timezone callbacks."""
from dataclasses import replace
from datetime import datetime, timezone, timedelta, tzinfo
import unittest

from workers.fixed_response_envelope import ExpectedResponseBody,SuppliedResponseEnvelope,ResponseEnvelopeError,check_fixed_response_envelope

NOW=datetime(2026,10,17,11,tzinfo=timezone.utc)
URL='https://example.org/original'
class CallbackUtc(tzinfo):
    def __init__(self,callback): self.callback=callback
    def utcoffset(self,dt): self.callback(); return timedelta(0)
    def dst(self,dt): return timedelta(0)

class ResponseEntryCaptureTests(unittest.TestCase):
    def inputs(self):
        return ExpectedResponseBody(URL,'utf8_text',65536), SuppliedResponseEnvelope(URL,URL,200,0,(('Content-Type','text/plain'),),NOW-timedelta(seconds=1))
    def reject(self,mode):
        expected,envelope=self.inputs()
        if mode=='status': object.__setattr__(envelope,'status',503);repair=lambda:object.__setattr__(envelope,'status',200)
        elif mode=='redirect': object.__setattr__(envelope,'redirect_count',1);repair=lambda:object.__setattr__(envelope,'redirect_count',0)
        elif mode=='headers': object.__setattr__(envelope,'relevant_headers',(('Content-Type','text/html'),));repair=lambda:object.__setattr__(envelope,'relevant_headers',(('Content-Type','text/plain'),))
        elif mode=='endpoint':
            object.__setattr__(envelope,'requested_url','https://example.org/other');object.__setattr__(envelope,'final_url','https://example.org/other')
            repair=lambda:object.__setattr__(expected,'endpoint','https://example.org/other')
        elif mode=='retrieval': object.__setattr__(envelope,'retrieved_at',NOW+timedelta(days=1));repair=lambda:object.__setattr__(envelope,'retrieved_at',NOW-timedelta(seconds=1))
        at=NOW.replace(tzinfo=CallbackUtc(repair))
        with self.assertRaisesRegex(ResponseEnvelopeError,'^fixed_response_envelope_unavailable$'):
            check_fixed_response_envelope(b'Original',expected,envelope,observed_at=at)
    def test_denied_status_not_repaired(self):self.reject('status')
    def test_denied_redirect_not_repaired(self):self.reject('redirect')
    def test_denied_headers_not_repaired(self):self.reject('headers')
    def test_original_endpoint_not_rebound(self):self.reject('endpoint')
    def test_future_retrieval_not_repaired(self):self.reject('retrieval')
    def test_valid_entry_survives_mutated_policy_and_response_after_capture(self):
        expected,envelope=self.inputs()
        def mutate():
            object.__setattr__(expected,'endpoint','https://example.org/other')
            object.__setattr__(expected,'max_body_bytes',1)
            object.__setattr__(envelope,'status',503)
            object.__setattr__(envelope,'relevant_headers',(('Authorization','PRIVATE_CANARY'),))
        result=check_fixed_response_envelope(b'Original',expected,envelope,observed_at=NOW.replace(tzinfo=CallbackUtc(mutate)))
        self.assertEqual(result.endpoint,URL);self.assertEqual(result.body,b'Original');self.assertEqual(result.media_type,'text/plain')
        self.assertIs(result.retrieved_at.tzinfo,timezone.utc)
    def test_private_timezone_failure_is_curated(self):
        expected,envelope=self.inputs()
        def fail():raise RuntimeError('PRIVATE_TIMEZONE_CANARY')
        with self.assertRaisesRegex(ResponseEnvelopeError,'^fixed_response_envelope_unavailable$'):
            check_fixed_response_envelope(b'Original',expected,envelope,observed_at=NOW.replace(tzinfo=CallbackUtc(fail)))

if __name__=='__main__':unittest.main()
