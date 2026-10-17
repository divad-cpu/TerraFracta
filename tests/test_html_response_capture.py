"""Explicit supplied HTML response profile; no fetch, transport or custody proof."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest

from tests.test_html_passage_binding import inputs, AT
from tests.test_html_passage_comparison import capture, OBSERVED
from workers.fixed_response_envelope import (
    ExpectedResponseBody, SuppliedResponseEnvelope, ResponseEnvelopeError, check_fixed_response_envelope,
)
from workers.html_passage_comparison import compare_html_passages
from workers.html_extraction_request import compile_html_extraction_request, parse_html_extraction_proposal
from workers.html_response_capture import HtmlResponseError, bind_supplied_html_response


def values(raw=b'<article id="chosen">Invented current wording.</article>'):
    bound = inputs(raw)
    expected = ExpectedResponseBody(bound['document'].source_url, 'utf8_html', 65536)
    envelope = SuppliedResponseEnvelope(expected.endpoint, expected.endpoint, 200, 0,
        (('content-type', 'text/html; charset=UTF-8'), ('content-length', str(len(raw)))), AT)
    return dict(body=raw, expected=expected, envelope=envelope, binding=bound['binding'],
                mapping=bound['mapping'], observed_at=OBSERVED)


class HtmlResponseCaptureTests(unittest.TestCase):
    def test_explicit_html_profile_preserves_raw_response_and_separate_derivation(self):
        data = values(); result = bind_supplied_html_response(**data)
        self.assertEqual(result.response.body, data['body'])
        self.assertEqual(result.response.profile, 'utf8_html')
        self.assertEqual(result.response.media_type, 'text/html')
        self.assertEqual(result.response.content_sha256, sha256(data['body']).hexdigest())
        self.assertEqual(result.capture.raw, data['body'])
        self.assertEqual(result.bound.document.content_sha256, result.response.content_sha256)
        self.assertEqual(result.capture.document, result.bound.document)
        self.assertEqual(result.bound.snapshot.passages[0].text, 'Invented current wording.')
        self.assertNotEqual(result.bound.spans[0].derived_text_sha256, result.response.content_sha256)
        self.assertEqual(result.evidence_state, 'supplied_html_response_and_derivation_only')
        self.assertNotIn('Invented current wording', repr(result))

    def test_response_metadata_identity_changes_without_relabelling_equal_original_bytes(self):
        first = values(); second = dict(first, envelope=replace(first['envelope'],
            relevant_headers=(('Content-Type', 'TEXT/HTML;charset="UTF-8"'), ('Content-Length', '000'+str(len(first['body']))))))
        a = bind_supplied_html_response(**first); b = bind_supplied_html_response(**second)
        self.assertEqual(a.response.content_sha256, b.response.content_sha256)
        self.assertNotEqual(a.response.envelope_sha256, b.response.envelope_sha256)
        self.assertEqual(a.bound.derivation_manifest_sha256, b.bound.derivation_manifest_sha256)

    def test_old_plaintext_and_feed_profiles_do_not_silently_admit_html(self):
        data = values()
        for profile in ['utf8_text', 'rss20', 'atom10', 'html']:
            with self.assertRaises(ResponseEnvelopeError):
                check_fixed_response_envelope(data['body'], replace(data['expected'], profile=profile), data['envelope'], observed_at=OBSERVED)
        plain = dict(data, expected=replace(data['expected'], profile='utf8_text'),
                     envelope=replace(data['envelope'], relevant_headers=(('content-type', 'text/plain'),)))
        with self.assertRaises(HtmlResponseError): bind_supplied_html_response(**plain)

    def test_html_profile_still_refuses_non_html_media_framing_redirects_and_partial_responses(self):
        data = values()
        changes = [dict(relevant_headers=(('content-type', 'text/plain'),)),
            dict(relevant_headers=(('content-type', 'text/html;charset=latin-1'),)),
            dict(relevant_headers=(('content-type', 'text/html'), ('transfer-encoding', 'chunked'))),
            dict(relevant_headers=(('content-type', 'text/html'), ('content-encoding', 'gzip'))),
            dict(relevant_headers=(('content-type', 'text/html'), ('Content-Type', 'text/html'))),
            dict(relevant_headers=(('content-type', 'text/html'), ('content-length', str(len(data['body'])-1)))),
            dict(status=206), dict(status=304), dict(redirect_count=1), dict(final_url=data['expected'].endpoint+'/other')]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(HtmlResponseError):
                bind_supplied_html_response(**dict(data, envelope=replace(data['envelope'], **change)))

    def test_independent_source_binding_cannot_borrow_equal_body_or_retieval(self):
        data = values()
        for change in [dict(content_sha256='f'*64), dict(source_url='https://example.org/other.html'),
                       dict(retrieved_at=AT+timedelta(seconds=1))]:
            with self.subTest(change=change), self.assertRaises(HtmlResponseError):
                bind_supplied_html_response(**dict(data, binding=replace(data['binding'], **change)))
        with self.assertRaises(HtmlResponseError):
            bind_supplied_html_response(**dict(data, mapping=replace(data['mapping'], source_version_id='foreign-version')))

    def test_envelope_consistency_cannot_establish_valid_utf8_html_or_selected_elements(self):
        for raw in [b'\xff', b'<article id="missing">PRIVATE</article>', b'<article id="chosen"><p>Unclosed</article>']:
            data = values(raw)
            response = check_fixed_response_envelope(raw, data['expected'], data['envelope'], observed_at=OBSERVED)
            self.assertEqual(response.content_sha256, sha256(raw).hexdigest())
            with self.assertRaises(HtmlResponseError): bind_supplied_html_response(**data)

    def test_actual_response_comparison_request_and_proposal_compose_without_original_cast(self):
        data = values(); selected = bind_supplied_html_response(**data)
        previous = capture('Invented earlier wording.', 'html-old', 0)
        compared = compare_html_passages(selected.capture, previous, observed_at=OBSERVED)
        self.assertEqual(compared.selection.state, 'ready')
        request = compile_html_extraction_request(selected.capture, previous, observed_at=OBSERVED, maximum_output_tokens=100)
        raw = json.dumps(dict(schema_version=1, source_version_id=selected.capture.document.source_version_id,
            source_sha256=selected.response.content_sha256, language_code='en', locator='article:one',
            proposed_claim_type='condition', proposed_assertion='Invented current wording remains an unverified source statement.',
            source_date_text=None)).encode()
        proposal = parse_html_extraction_proposal(raw, request, current=selected.capture, previous=previous,
            observed_at=OBSERVED, maximum_output_tokens=100)
        self.assertEqual(proposal.review_state, 'unverified')
        self.assertEqual(proposal.source_sha256, sha256(data['body']).hexdigest())

    def test_input_bounds_and_curated_failures_do_not_echo_source_or_headers(self):
        data = values()
        for change in [dict(body=bytearray(data['body'])), dict(expected=replace(data['expected'], max_body_bytes=True)),
                       dict(body=b'PRIVATE_CANARY /home/private/file'),
                       dict(envelope=replace(data['envelope'], relevant_headers=(('authorization', 'PRIVATE_CANARY'),)))]:
            with self.assertRaises(HtmlResponseError) as error: bind_supplied_html_response(**dict(data, **change))
            self.assertEqual(str(error.exception), 'supplied_html_response_unavailable')


if __name__ == '__main__': unittest.main()
