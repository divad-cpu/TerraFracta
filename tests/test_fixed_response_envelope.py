"""Supplied HTTP consistency and existing offline parser/capture composition."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import io
import unittest
from tests.test_document_passage_binding import inputs,AT
from tests.test_feed_discovery import rss,entry,receipt
from tests.test_reserved_response_capture import FakeCommittedBackend
from tests.test_source_response_receipts import NOW,context
from workers.document_passage_binding import DocumentByteSpan,bind_document_passages,DocumentPassageError
from workers.feed_discovery import discover_feed_entries
from workers.reserved_response_capture import capture_reserved_response
from workers.fixed_response_envelope import (
    ExpectedResponseBody,SuppliedResponseEnvelope,ResponseEnvelopeError,check_fixed_response_envelope,
)

URL='https://example.org/original'


def check(body=b'Original',*,profile='utf8_text',headers=None,expected=None,envelope=None):
    media={'utf8_text':'text/plain','rss20':'application/rss+xml','atom10':'application/atom+xml'}[profile]
    expected=expected or ExpectedResponseBody(URL,profile,65536)
    envelope=envelope or SuppliedResponseEnvelope(URL,URL,200,0,
        (('Content-Type',media+'; charset=utf-8'),('Content-Length',str(len(body)))) if headers is None else headers,AT)
    return check_fixed_response_envelope(body,expected,envelope,observed_at=AT+timedelta(seconds=1))


class FixedResponseEnvelopeTests(unittest.TestCase):
    def test_exact_body_hash_observation_and_metadata_identity_remain_separate(self):
        result=check();again=check()
        self.assertEqual(result,again);self.assertEqual(result.content_sha256,sha256(b'Original').hexdigest())
        self.assertEqual(result.declared_length,8)
        self.assertEqual(result.evidence_state,'supplied_http_envelope_consistency_only')
        changed=check(headers=(('content-type','TEXT/PLAIN; CHARSET="UTF-8"'),('content-length','008')))
        self.assertEqual(changed.content_sha256,result.content_sha256)
        self.assertNotEqual(changed.envelope_sha256,result.envelope_sha256)
        self.assertNotIn('Original',repr(result))

    def test_missing_length_is_explicit_not_a_complete_history_or_transport_claim(self):
        result=check(headers=(('Content-Type','text/plain'),))
        self.assertIsNone(result.declared_length)
        self.assertEqual(result.body,b'Original')

    def test_exact_endpoint_status_redirect_and_time_are_closed(self):
        base=SuppliedResponseEnvelope(URL,URL,200,0,(('content-type','text/plain'),),AT)
        for change in [dict(requested_url=URL+'?x=1'),dict(final_url=URL+'/'),dict(status=206),dict(status=304),dict(status=True),
                       dict(redirect_count=True),dict(redirect_count=1),dict(retrieved_at=AT+timedelta(days=1)),dict(retrieved_at=AT.replace(tzinfo=None))]:
            with self.subTest(change=change),self.assertRaises(ResponseEnvelopeError):check(envelope=replace(base,**change))

    def test_duplicate_length_type_or_encoding_refuses_even_equal_and_mixed_case(self):
        for headers in [(('content-type','text/plain'),('content-length','8'),('Content-Length','8')),
                        (('content-type','text/plain'),('content-type','text/plain')),
                        (('content-type','text/plain'),('content-encoding','identity'),('Content-Encoding','identity')),
                        (('content-type','text/plain'),('content-length','8, 8')),
                        (('content-type','text/plain'),('content-length','8, 9'))]:
            with self.assertRaises(ResponseEnvelopeError):check(headers=headers)

    def test_compression_transfer_framing_unknown_parameters_and_wrong_media_refuse(self):
        for headers in [(('content-type','text/plain'),('content-encoding','gzip')),
                        (('content-type','text/plain'),('transfer-encoding','chunked')),
                        (('content-type','text/plain;charset=latin-1'),),
                        (('content-type','text/plain;charset=utf-8; charset=utf-8'),),
                        (('content-type','text/plain;boundary=x'),),
                        (('content-type','text/html'),),()]:
            with self.assertRaises(ResponseEnvelopeError):check(headers=headers)

    def test_length_is_ascii_octets_bounded_not_sign_float_or_unbounded_number(self):
        for length in ['7','9','+8','-8','8.0','８','9'*21,'65537','8\r\nHeader: injected']:
            with self.assertRaises(ResponseEnvelopeError):check(headers=(('content-type','text/plain'),('content-length',length)))
        utf8='Å'.encode()
        self.assertEqual(check(utf8).declared_length,2)
        with self.assertRaises(ResponseEnvelopeError):check(utf8,headers=(('content-type','text/plain'),('content-length','1')))

    def test_safe_header_projection_never_admits_credentials_or_unbounded_metadata(self):
        for headers in [(('content-type','text/plain'),('Set-Cookie','PRIVATE_CANARY')),
                        (('content-type','text/plain'),('Authorization','PRIVATE_CANARY')),
                        (('content-type','text/plain\nPRIVATE_CANARY'),),
                        (('content-type','x'*257),),[['content-type','text/plain']]]:
            with self.assertRaises(ResponseEnvelopeError) as raised:check(headers=headers)
            self.assertNotIn('PRIVATE_CANARY',str(raised.exception))

    def test_body_expectation_and_observation_types_and_caps_refuse(self):
        for expected in [ExpectedResponseBody(URL,'html',65536),ExpectedResponseBody('http://127.0.0.1/','utf8_text',8),
                         ExpectedResponseBody(URL,'utf8_text',True),ExpectedResponseBody(URL,'utf8_text',65537)]:
            with self.assertRaises(ResponseEnvelopeError):check(expected=expected)
        for body in [b'',b'x'*65537,bytearray(b'Original')]:
            with self.assertRaises(ResponseEnvelopeError):check(body)
        self.assertEqual(len(check(b'x'*65536).body),65536)

    def test_rss_envelope_composes_with_existing_exact_discovery(self):
        raw=rss(entry());source=receipt(raw,retrieved_at=AT);validated=check(raw,profile='rss20',
            expected=ExpectedResponseBody(source.feed_url,'rss20',65536),
            envelope=SuppliedResponseEnvelope(source.feed_url,source.feed_url,200,0,(('Content-Type','application/rss+xml'),),AT))
        page=discover_feed_entries(validated.body,source,expected_format='rss20')
        self.assertEqual(len(page.entries),1);self.assertEqual(page.entries[0].review_state,'unverified_discovery')
        self.assertEqual(validated.content_sha256,source.content_sha256)

    def test_atom_selected_profile_does_not_accept_rss_type(self):
        with self.assertRaises(ResponseEnvelopeError):check(b'<feed/>',profile='atom10',headers=(('content-type','application/rss+xml'),))
        value=check(b'<feed/>',profile='atom10',headers=(('content-type','application/atom+xml; charset="UTF-8"'),))
        self.assertEqual(value.media_type,'application/atom+xml')
        # Envelope consistency alone does not qualify feed document syntax.

    def test_atom_envelope_composes_with_existing_exact_parser_and_observation(self):
        raw=b'<feed xmlns="http://www.w3.org/2005/Atom"><title>Invented</title><id>urn:fictional:feed</id><updated>2026-10-15T00:00:00Z</updated><entry><id>urn:fictional:entry</id><title>Invented</title><link href="https://example.org/doc"/></entry></feed>'
        source=receipt(raw,retrieved_at=AT)
        observed=SuppliedResponseEnvelope(source.feed_url,source.feed_url,200,0,(('content-type','application/atom+xml'),),AT)
        validated=check(raw,profile='atom10',expected=ExpectedResponseBody(source.feed_url,'atom10',65536),envelope=observed)
        page=discover_feed_entries(validated.body,source,expected_format='atom10')
        self.assertEqual(page.source.retrieved_at,validated.retrieved_at)
        self.assertEqual(page.entries[0].entry_id,'urn:fictional:entry')

    def test_plaintext_envelope_composes_with_raw_document_binding(self):
        raw='Exact Å original.'.encode();values=inputs(raw,[DocumentByteSpan('one',0,len(raw))])
        doc=values['document'];validated=check(raw,expected=ExpectedResponseBody(doc.source_url,'utf8_text',65536),
            envelope=SuppliedResponseEnvelope(doc.source_url,doc.source_url,200,0,(('content-type','text/plain'),),AT))
        result=bind_document_passages(**{**values,'raw':validated.body})
        self.assertEqual(result.snapshot.passages[0].text,'Exact Å original.')
        invalid=b'Invalid \xff';values=inputs(invalid,[DocumentByteSpan('one',0,len(invalid))])
        validated=check(invalid)
        with self.assertRaises(DocumentPassageError):bind_document_passages(**{**values,'raw':validated.body})

    def test_post_capture_header_refusal_does_not_refund_or_resend_existing_dispatch(self):
        expected=context();backend=FakeCommittedBackend();calls=[]
        def opener(endpoint,seconds):calls.append(endpoint);return io.BytesIO(b'abc')
        captured=capture_reserved_response(expected,backend,opener,utc_now=lambda:NOW,monotonic=lambda:0)
        envelope=SuppliedResponseEnvelope(expected.endpoint,expected.endpoint,200,0,(('content-type','text/html'),),NOW)
        with self.assertRaises(ResponseEnvelopeError):check_fixed_response_envelope(captured.body,
            ExpectedResponseBody(expected.endpoint,'utf8_text',expected.max_body_bytes),envelope,observed_at=NOW)
        self.assertEqual(backend.received['body_bytes'],3)
        self.assertIsNone(capture_reserved_response(expected,backend,opener,utc_now=lambda:NOW,monotonic=lambda:0))
        self.assertEqual(calls,[expected.endpoint]);self.assertEqual(backend.events.count('settle-committed'),1)


if __name__=='__main__':unittest.main()
