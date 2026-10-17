"""Actual binary supplied PDF response composition, not a transport test."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import unittest
from unittest.mock import patch

from tests.test_pdf_passage_comparison import capture, NOW
from tests.test_response_entry_capture import CallbackUtc
from workers.fixed_response_envelope import (
    ExpectedResponseBody, SuppliedResponseEnvelope, ResponseEnvelopeError, check_fixed_response_envelope,
)
from workers.pdf_response_binding import bind_pdf_response, PdfResponseBindingError
from workers.pdf_extraction_request import compile_pdf_extraction_request


def inputs():
    current=capture(('Supplied selected native text.', 'PRIVATE_UNSELECTED_PDF'))
    doc=current.document
    expected=ExpectedResponseBody(doc.source_url,'native_pdf',65536)
    response=SuppliedResponseEnvelope(doc.source_url,doc.source_url,200,0,
        (('Content-Type','application/pdf'),('Content-Length',str(len(current.raw)))),doc.retrieved_at)
    return current,expected,response


def bind(current,expected,response,*,at=NOW):
    return bind_pdf_response(current.raw,expected,response,document=current.document,
        binding=current.binding,mapping=current.mapping,observed_at=at)


class PdfResponseBindingTests(unittest.TestCase):
    def test_actual_binary_original_reaches_selected_native_page_once_and_existing_request(self):
        import workers.pdf_text_inspection as inspector
        current,expected,response=inputs()
        with self.assertRaises(UnicodeDecodeError):current.raw.decode('utf8')
        start=inspector.subprocess.Popen;children=[]
        def launch(*args,**kwargs):
            child=start(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=launch):result=bind(current,expected,response)
        self.assertEqual(len(children),1)
        self.assertTrue(all(p.poll()is not None and all(getattr(p,n).closed for n in('stdin','stdout','stderr'))for p in children))
        self.assertEqual(result.response.body,current.raw);self.assertEqual(result.response.content_sha256,sha256(current.raw).hexdigest())
        self.assertEqual(result.response.media_type,'application/pdf');self.assertEqual(result.response.profile,'native_pdf')
        self.assertEqual(result.response.retrieved_at,result.result.document.retrieved_at)
        self.assertEqual(result.result.snapshot.passages[0].text,'Supplied selected native text.')
        self.assertNotIn('PRIVATE_UNSELECTED_PDF',repr(result))
        request=compile_pdf_extraction_request(result.capture,observed_at=NOW,maximum_output_tokens=100)
        self.assertIn(b'Supplied selected native text.',request.body);self.assertNotIn(b'PRIVATE_UNSELECTED_PDF',request.body)
        self.assertIn('not_transport_authenticated',result.evidence_state)

    def test_pdf_media_is_case_insensitive_binary_and_accepts_missing_length_as_unknown(self):
        current,expected,response=inputs()
        value=check_fixed_response_envelope(current.raw,expected,replace(response,relevant_headers=(('CONTENT-TYPE',' APPLICATION/PDF\t'),)),observed_at=NOW)
        self.assertIsNone(value.declared_length);self.assertEqual(value.media_type,'application/pdf')
        self.assertEqual(value.body,current.raw)

    def test_charset_parameters_other_media_and_coding_refuse_before_native_work(self):
        current,expected,response=inputs()
        headers=[(('content-type',media),) for media in ('application/pdf; charset=utf-8','application/pdf;charset="utf-8"',
            'application/pdf;version=1.7','application/octet-stream','text/html','text/plain','application/pdf, application/pdf')]
        headers += [(('content-type','application/pdf'),('content-type','application/pdf')),
                    (('content-type','application/pdf'),('transfer-encoding','chunked')),
                    (('content-type','application/pdf'),('content-encoding','gzip'))]
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes',side_effect=AssertionError('No child'))as inspector:
            for h in headers:
                with self.subTest(headers=h),self.assertRaises(PdfResponseBindingError):bind(current,expected,replace(response,relevant_headers=h))
            inspector.assert_not_called()

    def test_response_identity_length_status_and_private_fields_refuse_before_native_work(self):
        current,expected,response=inputs()
        variants=[replace(response,status=206),replace(response,status=True),replace(response,redirect_count=1),
            replace(response,final_url='https://example.org/redirected'),replace(response,requested_url='https://example.org/other'),
            replace(response,relevant_headers=(('content-type','application/pdf'),('content-length',str(len(current.raw)-1)))),
            replace(response,relevant_headers=(('content-type','application/pdf'),('Authorization','PRIVATE_CANARY'))),
            replace(response,retrieved_at=NOW+timedelta(seconds=1))]
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes',side_effect=AssertionError('No child'))as inspector:
            for variant in variants:
                with self.assertRaisesRegex(PdfResponseBindingError,'^pdf_response_binding_unavailable$'):bind(current,expected,variant)
            inspector.assert_not_called()

    def test_independent_receipt_url_hash_and_retrieval_must_match_not_be_derived_from_response(self):
        current,expected,response=inputs()
        variants=[replace(current,document=replace(current.document,content_sha256='f'*64)),
            replace(current,document=replace(current.document,source_url='https://example.org/other.pdf')),
            replace(current,document=replace(current.document,retrieved_at=current.document.retrieved_at-timedelta(microseconds=1))),
            replace(current,document=replace(current.document,media_type='text/plain'))]
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes',side_effect=AssertionError('No child'))as inspector:
            for variant in variants:
                with self.assertRaises(PdfResponseBindingError):bind(variant,expected,response)
            for profile in ('utf8_text','utf8_html','rss20','pdf','unknown'):
                with self.assertRaises(PdfResponseBindingError):bind(current,replace(expected,profile=profile),response)
            inspector.assert_not_called()

    def test_original_bounds_and_exact_types_remain_before_native_work(self):
        current,expected,response=inputs()
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes',side_effect=AssertionError('No child'))as inspector:
            for raw in (b'',b'x'*65537,bytearray(current.raw)):
                with self.assertRaises(PdfResponseBindingError):bind(replace(current,raw=raw),expected,response)
            for bound in (True,0,65537,len(current.raw)-1):
                with self.assertRaises(PdfResponseBindingError):bind(current,replace(expected,max_body_bytes=bound),response)
            inspector.assert_not_called()

    def test_response_admission_is_not_pdf_syntax_or_selected_page_qualification(self):
        current,expected,response=inputs();raw=b'PRIVATE_NOT_A_PDF'
        supplied=replace(current,raw=raw,document=replace(current.document,content_sha256=sha256(raw).hexdigest()),
            binding=replace(current.binding,content_sha256=sha256(raw).hexdigest()),
            mapping=replace(current.mapping,content_sha256=sha256(raw).hexdigest()))
        response=replace(response,relevant_headers=(('content-type','application/pdf'),('content-length',str(len(raw)))))
        checked=check_fixed_response_envelope(raw,expected,response,observed_at=NOW)
        self.assertEqual(checked.body,raw)
        with self.assertRaisesRegex(PdfResponseBindingError,'^pdf_response_binding_unavailable$'):bind(supplied,expected,response)

    def test_all_pdf_expectations_captured_before_response_clock_callback(self):
        current,expected,response=inputs();object.__setattr__(current.binding,'content_sha256','f'*64)
        def repair():object.__setattr__(current.binding,'content_sha256',current.document.content_sha256)
        at=NOW.replace(tzinfo=CallbackUtc(repair))
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes',side_effect=AssertionError('No child'))as inspector:
            with self.assertRaises(PdfResponseBindingError):bind(current,expected,response,at=at)
            inspector.assert_not_called()

    def test_native_callback_cannot_rebind_caller_receipt_map_or_response_after_capture(self):
        import workers.pdf_text_inspection as inspector
        current,expected,response=inputs();start=inspector.subprocess.Popen;children=[]
        def launch(*args,**kwargs):
            object.__setattr__(current.document,'source_url','https://example.org/PRIVATE_CHANGED')
            object.__setattr__(current.mapping.selections[0],'page_number',2)
            object.__setattr__(expected,'profile','utf8_text')
            object.__setattr__(response,'status',503)
            child=start(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=launch):result=bind(current,expected,response)
        self.assertEqual(result.response.endpoint,'https://example.invalid/invented.pdf')
        self.assertEqual(result.capture.document.source_url,result.response.endpoint)
        self.assertEqual(result.capture.mapping.selections[0].page_number,1)
        self.assertEqual(result.capture.binding.source_url,result.response.endpoint)
        self.assertEqual(result.result.spans[0].page_number,1);self.assertEqual(len(children),1)
        self.assertTrue(all(p.poll()is not None for p in children))

if __name__=='__main__':unittest.main()
