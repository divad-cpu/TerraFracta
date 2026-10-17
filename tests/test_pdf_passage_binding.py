"""New typed whole-derived-page binding; no source, model, DB or storage."""
from dataclasses import replace
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.helpers.pdf_fixture import pdf_bytes
from workers.pdf_text_inspection import PdfDocumentReceipt
import workers.pdf_passage_binding as m

NOW = datetime(2026, 10, 17, 10, tzinfo=timezone.utc)
SHA = lambda value: sha256(value.encode('utf8')).hexdigest()


def inputs(raw, selections=(('section-one', 1, 'Invented native paragraph.'),)):
    doc = PdfDocumentReceipt('fictional-pdf', 'invented-report', '10000000-0000-4000-8000-000000000001',
        'https://example.org/invented.pdf', sha256(raw).hexdigest(), NOW-timedelta(minutes=1))
    binding = m.PdfPassageBinding(doc.source_key, doc.item_key, doc.source_version_id, doc.source_url,
        doc.content_sha256, 'b'*64, 'en', doc.retrieved_at)
    mapping = m.PdfPageSelectionMap(doc.source_version_id, doc.content_sha256, binding.mapping_sha256,
        binding.language_code, tuple(m.PdfPageSelection(locator, number, SHA(text)) for locator, number, text in selections))
    return doc, binding, mapping


def bind(raw, selections=(('section-one', 1, 'Invented native paragraph.'),)):
    doc, binding, mapping = inputs(raw, selections)
    return m.bind_pdf_passages(raw, doc, binding=binding, mapping=mapping, observed_at=NOW)


class PdfPassageBindingTests(unittest.TestCase):
    def test_actual_original_full_page_and_canonical_provenance_are_distinct(self):
        raw=pdf_bytes();original=m.inspect_pdf_bytes
        with patch.object(m,'inspect_pdf_bytes',wraps=original)as inspector:result=bind(raw)
        self.assertEqual(inspector.call_count,1)
        self.assertEqual(result.snapshot.content_sha256,sha256(raw).hexdigest())
        self.assertEqual(result.snapshot.passages[0].text,'Invented native paragraph.')
        self.assertEqual(result.spans[0].derived_start_utf8,0)
        self.assertEqual(result.spans[0].derived_end_utf8,len('Invented native paragraph.'.encode()))
        self.assertEqual(result.spans[0].page_text_sha256,SHA('Invented native paragraph.'))
        self.assertNotEqual(result.spans[0].page_text_sha256,result.snapshot.content_sha256)
        self.assertIs(type(result.inspection_report_raw),bytes);self.assertIs(type(result.derivation_manifest_raw),bytes)
        self.assertEqual(sha256(result.inspection_report_raw).hexdigest(),result.inspection_report_sha256)
        manifest=json.loads(result.derivation_manifest_raw)
        self.assertEqual(result.derivation_manifest_raw,json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode())
        self.assertEqual(sha256(result.derivation_manifest_raw).hexdigest(),result.derivation_manifest_sha256)
        self.assertEqual(manifest['inspection_report_sha256'],result.inspection_report_sha256)
        self.assertEqual(manifest['offset_space'],'derived_page_utf8');self.assertEqual(manifest['page_index_kind'],'physical_1_based')
        self.assertFalse(manifest['rendered_visibility_verified'])
        self.assertNotIn('PRIVATE_PDF_METADATA_CANARY',result.inspection_report_raw.decode())

    def test_actual_multiple_equal_text_pages_keep_all_occurrences_and_physical_labels_separate(self):
        result=bind(pdf_bytes(('Same text.','Same text.'),page_labels=True),
                    (('first',1,'Same text.'),('second',2,'Same text.')))
        self.assertEqual([p.locator for p in result.snapshot.passages],['first','second'])
        self.assertEqual([s.page_number for s in result.spans],[1,2])
        self.assertNotIn('Untrusted label',result.inspection_report_raw.decode()+result.derivation_manifest_raw.decode())

    def test_actual_unicode_uses_derived_utf8_bytes_not_characters_or_pdf_offsets(self):
        result=bind(pdf_bytes(('unused',),unicode_text=True),(('unicode',1,'\U00010400'),))
        self.assertEqual(result.snapshot.passages[0].text,'\U00010400')
        self.assertEqual(result.spans[0].derived_end_utf8,4);self.assertEqual(result.spans[0].page_text_sha256,SHA('\U00010400'))

    def test_unselected_actual_held_and_textless_pages_remain_in_full_inspection(self):
        raw=pdf_bytes(('x'*8193,'Independent text.',None),compressed=True)
        result=bind(raw,(('independent',2,'Independent text.'),))
        report=json.loads(result.inspection_report_raw)
        self.assertEqual([p['state']for p in report['pages']],['held','text_extracted','no_native_text'])
        self.assertEqual([s.page_number for s in result.spans],[2]);self.assertEqual(len(result.snapshot.passages),1)

    def test_selected_actual_held_or_textless_or_missing_page_refuses_all(self):
        raw=pdf_bytes(('x'*8193,None,'Independent text.'),compressed=True)
        for selections in[(('selected',1,'x'*8193),),(('selected',2,'any'),),(('selected',4,'any'),),
                           (('first',1,'x'*8193),('third',3,'Independent text.'))]:
            with self.subTest(page=selections[0][1]),self.assertRaisesRegex(m.PdfPassageError,'^pdf_passage_binding_unavailable$'):
                bind(raw,selections)

    def test_whole_actual_hold_has_no_bound_snapshot_even_with_empty_selection(self):
        for raw in[b'%PDF-1.7\nPRIVATE_BROKEN',pdf_bytes(encrypted=True)]:
            with self.assertRaises(m.PdfPassageError)as caught:bind(raw,())
            self.assertEqual(str(caught.exception),'pdf_passage_binding_unavailable')
            self.assertIsNone(caught.exception.__cause__)

    def test_empty_actual_selection_is_no_coverage_and_never_implicit_all_pages(self):
        result=bind(pdf_bytes(),())
        self.assertEqual(result.snapshot.passages,());self.assertEqual(result.spans,())
        self.assertEqual(json.loads(result.derivation_manifest_raw)['spans'],[])
        self.assertEqual(len(json.loads(result.inspection_report_raw)['pages']),2)

    def test_independent_expected_derived_hash_mismatch_fails_after_one_real_inspection(self):
        raw=pdf_bytes();doc,binding,mapping=inputs(raw)
        mapping=replace(mapping,selections=(replace(mapping.selections[0],page_text_sha256='f'*64),))
        with patch.object(m,'inspect_pdf_bytes',wraps=m.inspect_pdf_bytes)as inspector:
            with self.assertRaises(m.PdfPassageError):m.bind_pdf_passages(raw,doc,binding=binding,mapping=mapping,observed_at=NOW)
        self.assertEqual(inspector.call_count,1)

    def test_identity_receipt_recipe_language_and_original_mismatches_stop_before_inspector(self):
        raw=pdf_bytes();doc,binding,mapping=inputs(raw)
        cases=[(raw,replace(doc,media_type='text/plain'),binding,mapping,NOW),
               (raw,replace(doc,content_sha256='f'*64),binding,mapping,NOW),
               (raw,doc,replace(binding,item_key='foreign'),mapping,NOW),
               (raw,doc,replace(binding,retrieved_at=NOW),mapping,NOW),
               (raw,doc,binding,replace(mapping,source_version_id='10000000-0000-4000-8000-000000000002'),NOW),
               (raw,doc,binding,replace(mapping,mapping_sha256='c'*64),NOW),
               (raw,doc,binding,replace(mapping,language_code='fr'),NOW),
               (raw,doc,replace(binding,language_code='bad language'),mapping,NOW),
               (raw,doc,binding,mapping,NOW.replace(tzinfo=None)),
               (raw,replace(doc,retrieved_at=NOW+timedelta(microseconds=1)),binding,mapping,NOW),
               (raw+b'x',doc,binding,mapping,NOW)]
        with patch.object(m,'inspect_pdf_bytes',side_effect=AssertionError('No inspector'))as inspector:
            for data,d,b,mp,at in cases:
                with self.assertRaises(m.PdfPassageError):m.bind_pdf_passages(data,d,binding=b,mapping=mp,observed_at=at)
            inspector.assert_not_called()

    def test_exact_types_digest_order_duplicates_and_cap_are_refused_before_child(self):
        raw=pdf_bytes();doc,binding,mapping=inputs(raw);s=mapping.selections[0]
        class Text(str):pass
        class Data(bytes):pass
        invalid=[replace(mapping,selections=[s]),replace(mapping,selections=(s,s)),
                 replace(mapping,selections=(s,replace(s,page_number=2))),
                 replace(mapping,selections=(replace(s,page_number=2),replace(s,locator='other',page_number=1))),
                 replace(mapping,selections=(replace(s,page_number=True),)),replace(mapping,selections=(replace(s,page_number=0),)),
                 replace(mapping,selections=(replace(s,page_number=9),)),replace(mapping,selections=(replace(s,page_text_sha256='A'*64),)),
                 replace(mapping,selections=(replace(s,locator=Text('section')),)),
                 replace(mapping,selections=(replace(s,locator='bad\0locator'),)),
                 replace(mapping,selections=tuple(replace(s,locator=str(i),page_number=i+1)for i in range(9)))]
        with patch.object(m,'inspect_pdf_bytes',side_effect=AssertionError('No inspector'))as inspector:
            for mp in invalid:
                with self.assertRaises(m.PdfPassageError):m.bind_pdf_passages(raw,doc,binding=binding,mapping=mp,observed_at=NOW)
            for data in[bytearray(raw),Data(raw),{},b'',b'x'*65537]:
                with self.assertRaises(m.PdfPassageError):m.bind_pdf_passages(data,doc,binding=binding,mapping=mapping,observed_at=NOW)
            inspector.assert_not_called()

    def test_caller_metadata_and_selection_cannot_change_at_the_actual_process_boundary(self):
        import workers.pdf_text_inspection as inspector_module
        raw=pdf_bytes();doc,binding,mapping=inputs(raw);selection=mapping.selections[0]
        original=inspector_module.subprocess.Popen;children=[]
        def launch(*args,**kwargs):
            object.__setattr__(doc,'item_key','PRIVATE_LATER_ITEM');object.__setattr__(binding,'language_code','fr')
            object.__setattr__(selection,'locator','PRIVATE_LATER_LOCATOR');object.__setattr__(mapping,'mapping_sha256','f'*64)
            process=original(*args,**kwargs);children.append(process);return process
        with patch.object(inspector_module.subprocess,'Popen',side_effect=launch):
            result=m.bind_pdf_passages(raw,doc,binding=binding,mapping=mapping,observed_at=NOW)
        self.assertEqual(result.document.item_key,'invented-report');self.assertEqual(result.snapshot.language_code,'en')
        self.assertEqual(result.snapshot.mapping_sha256,'b'*64);self.assertEqual(result.spans[0].locator,'section-one')
        self.assertNotIn('PRIVATE_LATER',result.inspection_report_raw.decode()+result.derivation_manifest_raw.decode())
        self.assertEqual(len(children),1);self.assertIsNotNone(children[0].poll())
        self.assertTrue(all(getattr(children[0],name).closed for name in('stdin','stdout','stderr')))

    def test_inspector_faults_and_extended_or_corrupt_records_are_curated(self):
        raw=pdf_bytes();doc,binding,mapping=inputs(raw)
        with patch.object(m,'inspect_pdf_bytes',side_effect=RuntimeError('PRIVATE_PARSER_DETAILS')):
            with self.assertRaises(m.PdfPassageError)as caught:m.bind_pdf_passages(raw,doc,binding=binding,mapping=mapping,observed_at=NOW)
        self.assertEqual(str(caught.exception),'pdf_passage_binding_unavailable')
        actual=bind(raw);report=json.loads(actual.inspection_report_raw)
        for mutate in[lambda r:r.update(private='PRIVATE'),lambda r:r['pages'][0].update(text='PRIVATE'),
                      lambda r:r['document'].update(item_key='foreign'),lambda r:r['limits'].update(max_pages=9)]:
            value=json.loads(json.dumps(report));mutate(value)
            with patch.object(m,'inspect_pdf_bytes',return_value=value):
                with self.assertRaises(m.PdfPassageError):m.bind_pdf_passages(raw,doc,binding=binding,mapping=mapping,observed_at=NOW)

    def test_pure_capture_copies_all_nested_inputs_without_inspection(self):
        raw=pdf_bytes();doc,binding,mapping=inputs(raw);selection=mapping.selections[0]
        with patch.object(m,'inspect_pdf_bytes',side_effect=AssertionError('No native work'))as inspector:
            result=m.capture_pdf_passage_inputs(raw,doc,binding=binding,mapping=mapping,observed_at=NOW)
            inspector.assert_not_called()
        self.assertIs(result.raw,raw);self.assertIsNot(result.document,doc);self.assertIsNot(result.binding,binding)
        self.assertIsNot(result.mapping,mapping);self.assertIsNot(result.mapping.selections[0],selection)
        object.__setattr__(doc,'item_key','PRIVATE_LATER');object.__setattr__(binding,'language_code','fr')
        object.__setattr__(selection,'locator','PRIVATE_LATER');object.__setattr__(mapping,'mapping_sha256','f'*64)
        self.assertEqual(result.document.item_key,'invented-report');self.assertEqual(result.binding.language_code,'en')
        self.assertEqual(result.mapping.mapping_sha256,'b'*64);self.assertEqual(result.mapping.selections[0].locator,'section-one')
        self.assertIs(result.observed_at.tzinfo,timezone.utc)
        with self.assertRaises(AttributeError):setattr(result.mapping,'language_code','fr')

    def test_pure_capture_refuses_invalid_independent_pair_before_any_native_work(self):
        raw=pdf_bytes();doc,binding,mapping=inputs(raw)
        with patch.object(m,'inspect_pdf_bytes',side_effect=AssertionError('No native work'))as inspector:
            for data,b in [(raw,replace(binding,source_url='https://foreign.example/document.pdf')),
                           ({'report':'PRIVATE'},binding),(raw,replace(binding,mapping_sha256='bad'))]:
                with self.assertRaisesRegex(m.PdfPassageError,'^pdf_passage_binding_unavailable$'):
                    m.capture_pdf_passage_inputs(data,doc,binding=b,mapping=mapping,observed_at=NOW)
            inspector.assert_not_called()
