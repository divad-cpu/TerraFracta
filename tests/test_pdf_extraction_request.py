"""Typed complete-original PDF request composition, never provider or cost work."""
from dataclasses import replace
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.helpers.pdf_fixture import pdf_bytes
from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import PdfPassageBinding, PdfPageSelection, PdfPageSelectionMap
from workers.pdf_passage_comparison import PdfPassageCapture
from workers.pdf_extraction_request import (
    PdfExtractionRequestError, OfflinePdfExtractionRequest, compile_pdf_extraction_request,
    bind_pdf_full_request_token_limit, parse_pdf_extraction_proposal, TEMPLATE_ID,
)
from workers.passage_extraction_request import INSTRUCTIONS, FullRequestTokenLimit, _canonical
from workers.model_proposal import ModelProposalError

NOW=datetime(2026,10,17,11,tzinfo=timezone.utc)


def capture(text='Invented new selected text.',version=2,seconds=1,*,unselected='PRIVATE_UNSELECTED',two_selected=False):
    texts=(text,'Shared unchanged text.',unselected)
    raw=pdf_bytes(texts);doc=PdfDocumentReceipt('fictional-pdf','item-one',f'10000000-0000-4000-8000-{version:012d}',
        'https://example.org/invented.pdf',sha256(raw).hexdigest(),NOW-timedelta(minutes=1)+timedelta(seconds=seconds))
    binding=PdfPassageBinding(doc.source_key,doc.item_key,doc.source_version_id,doc.source_url,doc.content_sha256,'b'*64,'en',doc.retrieved_at)
    selected=[PdfPageSelection('section-one',1,sha256(text.encode()).hexdigest())]
    if two_selected:selected.append(PdfPageSelection('section-two',2,sha256(texts[1].encode()).hexdigest()))
    mapping=PdfPageSelectionMap(doc.source_version_id,doc.content_sha256,binding.mapping_sha256,binding.language_code,tuple(selected))
    return PdfPassageCapture(raw,doc,binding,mapping)


def request(current,previous=None,*,at=NOW,tokens=100):
    return compile_pdf_extraction_request(current,previous,observed_at=at,maximum_output_tokens=tokens)


def proof(compiled,current,previous=None,*,at=NOW,tokens=100,maximum_input=200):
    return bind_pdf_full_request_token_limit(compiled,current=current,previous=previous,observed_at=at,maximum_output_tokens=tokens,
        proof=FullRequestTokenLimit('item-one',compiled.request_sha256,maximum_input))


def output(current,**changes):
    return json.dumps(dict(schema_version=1,source_version_id=current.document.source_version_id,
        source_sha256=current.document.content_sha256,language_code='en',locator='section-one',proposed_claim_type='condition',
        proposed_assertion='An invented condition is described by the selected page text.',source_date_text=None)|changes).encode()


def parse(raw,compiled,current,previous=None):
    return parse_pdf_extraction_proposal(raw,compiled,current=current,previous=previous,observed_at=NOW,maximum_output_tokens=100)


class PdfExtractionRequestTests(unittest.TestCase):
    def test_actual_complete_request_is_deterministic_canonical_and_distinct_from_plain_or_html(self):
        old=capture('PRIVATE_PRIOR_SELECTED',1,0);now=capture();compiled=request(now,old);body=json.loads(compiled.body)
        self.assertEqual(compiled,request(now,old));self.assertEqual(compiled.body,_canonical(body))
        self.assertEqual(compiled.request_sha256,sha256(compiled.body).hexdigest());self.assertEqual(body['template_id'],TEMPLATE_ID)
        self.assertEqual(body['kind'],'private_offline_pdf_extraction_request');self.assertEqual(body['instructions'],INSTRUCTIONS)
        p=body['pdf_provenance'];self.assertEqual(p['parser_identity'],'pypdf/6.21.0:strict:plain')
        self.assertEqual(p['adapter_identity'],'terrafracta-selected-pdf-native-pages/v1')
        for name in('current_derivation_sha256','previous_derivation_sha256','current_inspection_sha256','previous_inspection_sha256'):
            self.assertRegex(p[name],r'^[a-f0-9]{64}$')
        self.assertEqual(p['page_index_kind'],'physical_1_based');self.assertEqual(p['offset_space'],'derived_page_utf8')
        self.assertTrue(p['whole_page_selection'])
        for name in('rendered_visibility_verified','visual_qualification_established','ocr_qualification_established','table_qualification_established'):self.assertIs(p[name],False)
        self.assertEqual(body['selected_payload']['content_sha256'],sha256(now.raw).hexdigest())
        self.assertEqual(body['output_schema']['properties']['source_sha256']['const'],sha256(now.raw).hexdigest())
        self.assertNotIn('Invented new selected text.',repr(compiled))

    def test_only_current_changed_selected_text_is_in_model_body(self):
        old=capture('PRIVATE_PRIOR_SELECTED',1,0,two_selected=True);now=capture(two_selected=True)
        compiled=request(now,old);body=json.loads(compiled.body)
        self.assertEqual(body['output_schema']['properties']['locator']['enum'],['section-one'])
        self.assertEqual(body['selected_payload']['passages'][0]['text'],'Invented new selected text.')
        for hidden in(b'PRIVATE_PRIOR_SELECTED',b'PRIVATE_UNSELECTED',b'Shared unchanged text.',b'PRIVATE_PDF_METADATA_CANARY',now.raw[:8]):self.assertNotIn(hidden,compiled.body)

    def test_first_observation_is_explicit_and_invalid_prior_cannot_become_absence(self):
        now=capture();body=json.loads(request(now).body)
        self.assertIsNone(body['pdf_provenance']['previous_derivation_sha256']);self.assertIsNone(body['pdf_provenance']['previous_inspection_sha256'])
        for before in({},replace(capture(version=1,seconds=0),raw=b'PRIVATE_INVALID'),replace(capture(version=1,seconds=0),mapping=None)):
            with self.assertRaises(PdfExtractionRequestError):request(now,before)

    def test_unchanged_selected_text_and_empty_or_relocated_selection_cannot_compile(self):
        old=capture('Same text.',1,0)
        for now in(old,capture('Same text.',2,1,unselected='changed unselected content')):
            with self.assertRaises(PdfExtractionRequestError):request(now,old)
        now=capture();empty=replace(now,mapping=replace(now.mapping,selections=()))
        with self.assertRaises(PdfExtractionRequestError):request(empty)
        relocated=replace(now,mapping=replace(now.mapping,selections=(replace(now.mapping.selections[0],locator='new-location'),)))
        with self.assertRaises(PdfExtractionRequestError):request(relocated,old)

    def test_complete_full_request_token_binding_retains_shared_payload_bound(self):
        now=capture();compiled=request(now);token=proof(compiled,now)
        self.assertEqual(token.item_key,'item-one');self.assertEqual(token.payload_sha256,compiled.selected_payload_sha256)
        self.assertEqual(token.maximum_input_tokens,200)
        with patch('workers.pdf_extraction_request.compare_pdf_passages',side_effect=AssertionError('No original work'))as compared:
            for value in(True,0,-1,1_000_001,'200'):
                with self.assertRaises(PdfExtractionRequestError):proof(compiled,now,maximum_input=value)
            with self.assertRaises(PdfExtractionRequestError):proof(compiled,now,tokens=101)
            with self.assertRaises(PdfExtractionRequestError):
                bind_pdf_full_request_token_limit(compiled,current=now,previous=None,observed_at=NOW,maximum_output_tokens=100,
                    proof=FullRequestTokenLimit('item-one',compiled.selected_payload_sha256,200))
            compared.assert_not_called()

    def test_changed_retrieval_or_inspection_observation_invalidates_old_request(self):
        now=capture();compiled=request(now);later=capture(seconds=2)
        self.assertEqual(compiled.selected_payload_sha256,request(later).selected_payload_sha256)
        self.assertNotEqual(compiled.request_sha256,request(later).request_sha256)
        with self.assertRaises(PdfExtractionRequestError):proof(compiled,later)
        with self.assertRaises(PdfExtractionRequestError):proof(compiled,now,at=NOW+timedelta(microseconds=1))

    def test_recipe_language_expected_page_hash_and_source_bytes_are_rebound_on_reuse(self):
        now=capture();compiled=request(now)
        variants=[replace(now,raw=now.raw+b'x'),replace(now,mapping=replace(now.mapping,selections=(replace(now.mapping.selections[0],page_text_sha256='f'*64),))),
            replace(now,binding=replace(now.binding,language_code='fr')),replace(now,mapping=replace(now.mapping,mapping_sha256='c'*64))]
        for changed in variants:
            with self.assertRaises(PdfExtractionRequestError):proof(compiled,changed)
        for tokens in(True,0,-1,1_000_001,'100'):
            with self.assertRaises(PdfExtractionRequestError):request(now,tokens=tokens)

    def test_resigned_pdf_provenance_and_request_body_cannot_replace_regeneration(self):
        now=capture();compiled=request(now)
        for key,value in [('current_derivation_sha256','f'*64),('current_inspection_sha256','f'*64),('whole_page_selection',False),('table_qualification_established',True)]:
            body=json.loads(compiled.body);body['pdf_provenance'][key]=value;raw=_canonical(body)
            forged=replace(compiled,body=raw,request_sha256=sha256(raw).hexdigest())
            with self.assertRaises(PdfExtractionRequestError):proof(forged,now)
        for forged in({},replace(compiled,body=bytearray(compiled.body)),replace(compiled,evidence_state='approved'),replace(compiled,item_key='foreign')):
            with self.assertRaises(PdfExtractionRequestError):
                bind_pdf_full_request_token_limit(forged,current=now,previous=None,observed_at=NOW,maximum_output_tokens=100,
                    proof=FullRequestTokenLimit('item-one',compiled.request_sha256,200))

    def test_structural_proposal_is_unverified_and_only_exact_changed_locator_is_allowed(self):
        old=capture('Old text.',1,0,two_selected=True);now=capture(two_selected=True);compiled=request(now,old)
        proposal=parse(output(now),compiled,now,old);self.assertEqual(proposal.review_state,'unverified')
        self.assertEqual(proposal.source_sha256,sha256(now.raw).hexdigest());self.assertEqual(proposal.locator,'section-one')
        for changes in[dict(locator='section-two'),dict(locator='unselected'),dict(source_sha256=sha256(b'Invented new selected text.').hexdigest()),dict(language_code='fr')]:
            with self.assertRaises(ModelProposalError):parse(output(now,**changes),compiled,now,old)
        for raw in[b'{"refusal":true}',output(now)[:-1]+b',"schema_version":1}']:
            with self.assertRaises(ModelProposalError):parse(raw,compiled,now,old)

    def test_request_and_token_proof_are_captured_before_actual_regeneration_callback(self):
        import workers.pdf_text_inspection as inspector_module
        now=capture();compiled=request(now);expected_payload=compiled.selected_payload_sha256
        token_proof=FullRequestTokenLimit('item-one',compiled.request_sha256,200);original=inspector_module.subprocess.Popen
        def launch(*args,**kwargs):
            object.__setattr__(compiled,'body',b'PRIVATE_CHANGED_REQUEST');object.__setattr__(compiled,'selected_payload_sha256','f'*64)
            object.__setattr__(token_proof,'maximum_input_tokens',999);object.__setattr__(token_proof,'request_sha256','f'*64)
            return original(*args,**kwargs)
        with patch.object(inspector_module.subprocess,'Popen',side_effect=launch):
            token=bind_pdf_full_request_token_limit(compiled,current=now,previous=None,observed_at=NOW,maximum_output_tokens=100,proof=token_proof)
        self.assertEqual(token.maximum_input_tokens,200);self.assertEqual(token.payload_sha256,expected_payload)

    def test_private_source_errors_are_fixed_and_no_prebuilt_pdf_report_cast_is_admitted(self):
        now=capture()
        for candidate in[{},replace(now,raw=b'PRIVATE_ORIGINAL /home/private/file')]:
            with self.assertRaises(PdfExtractionRequestError)as caught:request(candidate)
            self.assertEqual(str(caught.exception),'pdf_extraction_request_unavailable')
