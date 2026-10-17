"""Passive invented HTML projection; no source, browser, database or provider."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
import json
import unittest
from unittest.mock import patch

from workers.html_passage_binding import HtmlDocumentReceipt,HtmlPassageBinding,HtmlSelectionMap,HtmlElementSelection
from workers.html_passage_comparison import HtmlPassageCapture
from workers.html_extraction_request import compile_html_extraction_request
from workers.html_inspection_report import HtmlInspectionReportError, html_inspection_report, MAX_HTML_INSPECTION_BYTES

AT=datetime(2026,10,16,tzinfo=timezone.utc)
OBSERVED=AT+timedelta(hours=2,microseconds=7)
RECIPE='c'*64
URL='https://example.org/invented-html-document'
SELECTIONS=(HtmlElementSelection('context:one','context'),HtmlElementSelection('article:one','selected'))


def capture(raw,version='10000000-0000-4000-8000-000000000002',at=AT+timedelta(hours=1),selections=SELECTIONS):
    digest=sha256(raw).hexdigest()
    return HtmlPassageCapture(raw,HtmlDocumentReceipt('fictional-html','invented-article',version,URL,digest,at),
        HtmlPassageBinding('fictional-html','invented-article',version,URL,digest,RECIPE,'en',at),
        HtmlSelectionMap(version,digest,RECIPE,'en',selections))


def examples():
    old=b'<article><p id="context">Entirely invented example.</p><p id="selected">Earlier invented wording.</p></article>'
    new=b'<nav>Changed unselected navigation.</nav><article><p id="context">Entirely invented example.</p><p id="selected">Revised invented wording with &lt;em&gt;quoted markup&lt;/em&gt;.</p><script>OMITTED_SCRIPT_CANARY</script></article>'
    previous=capture(old,'10000000-0000-4000-8000-000000000001',AT)
    current=capture(new)
    request=compile_html_extraction_request(current,previous,observed_at=OBSERVED,maximum_output_tokens=128)
    return current,previous,request


def fixture_bytes():
    current,previous,request=examples()
    return html_inspection_report(current,previous,observed_at=OBSERVED,request=request,maximum_output_tokens=128)


class HtmlInspectionReportTests(unittest.TestCase):
    def test_full_projection_has_separate_provenance_and_no_raw_html_or_request_body(self):
        current,previous,request=examples()
        raw=fixture_bytes();r=json.loads(raw)
        self.assertEqual(raw,json.dumps(r,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode())
        self.assertEqual(set(r),{'schema_version','kind','scope','review_state','observed_at','current','previous','source_bytes_changed','selection','request','limits'})
        self.assertEqual((r['kind'],r['scope'],r['review_state']),('private_html_inspection_report','offline_supplied_html_comparison_only','unverified'))
        self.assertEqual(r['observed_at'],'2026-10-16T02:00:00.000007Z')
        self.assertTrue(r['source_bytes_changed']);self.assertEqual(r['selection']['state'],'ready')
        self.assertEqual(r['selection']['unchanged_locators'],['context:one'])
        self.assertEqual(r['request'],dict(request_sha256=request.request_sha256,selected_payload_sha256=request.selected_payload_sha256,maximum_output_tokens=128,body_bytes=len(request.body)))
        for key,source in [('current',current),('previous',previous)]:
            s=r[key];manifest=json.loads(s['derivation_manifest_json'])
            self.assertEqual(s['original_bytes'],len(source.raw));self.assertEqual(s['content_sha256'],sha256(source.raw).hexdigest())
            self.assertEqual(s['derivation_manifest_sha256'],sha256(s['derivation_manifest_json'].encode()).hexdigest())
            self.assertEqual(len(s['passages']),len(manifest['spans']))
            for passage,span in zip(s['passages'],manifest['spans']):
                self.assertEqual({k:v for k,v in passage.items() if k not in ('text','text_sha256')},{k:v for k,v in span.items() if k!='derived_text_sha256'})
                self.assertEqual(passage['text_sha256'],span['derived_text_sha256'])
                self.assertEqual(passage['text_sha256'],sha256(passage['text'].encode()).hexdigest())
                self.assertEqual(passage['raw_sha256'],sha256(source.raw[passage['start']:passage['end']]).hexdigest())
        self.assertNotIn('OMITTED_SCRIPT_CANARY',raw.decode())
        self.assertNotIn('<article>',raw.decode());self.assertNotIn('instructions',r['request'])
        self.assertIn('<em>quoted markup</em>',r['current']['passages'][1]['text'])
        self.assertFalse(r['limits']['rendered_visibility_verified']);self.assertEqual(r['limits']['storage'],'not_observed')
        self.assertEqual(r['limits']['publication'],'not_authorized')

    def test_fixture_is_generated_from_complete_invented_inputs(self):
        path=Path(__file__).resolve().parents[1]/'fixtures/fictional-html-inspection.json'
        self.assertEqual(path.read_bytes(),fixture_bytes()+b'\n')

    def test_explicit_no_prior_is_not_an_inferred_baseline(self):
        current,_,_=examples()
        r=json.loads(html_inspection_report(current,observed_at=OBSERVED))
        self.assertIsNone(r['previous']);self.assertIsNone(r['source_bytes_changed']);self.assertIsNone(r['request'])
        self.assertEqual(r['selection']['state'],'ready')

    def test_changed_outer_source_with_same_selected_text_has_no_request(self):
        _,previous,_=examples();current=capture(b'<header>New wrapping</header>'+previous.raw)
        r=json.loads(html_inspection_report(current,previous,observed_at=OBSERVED))
        self.assertTrue(r['source_bytes_changed']);self.assertEqual(r['selection']['reason_code'],'source_changed_passages_unchanged')
        self.assertEqual(r['selection']['unchanged_locators'],['context:one','article:one'])
        self.assertIsNone(r['selection']['payload_json']);self.assertIsNone(r['selection']['payload_sha256']);self.assertIsNone(r['request'])
        with self.assertRaises(HtmlInspectionReportError):html_inspection_report(current,previous,observed_at=OBSERVED,request=examples()[2],maximum_output_tokens=128)

    def test_mutated_current_and_bad_prior_are_all_or_nothing(self):
        current,previous,_=examples()
        for now,before in ((replace(current,raw=current.raw+b'changed'),previous),(current,replace(previous,raw=b'PRIVATE_BAD_PRIOR'))):
            with self.subTest(),self.assertRaisesRegex(HtmlInspectionReportError,'^html_inspection_report_unavailable$'):
                html_inspection_report(now,before,observed_at=OBSERVED)
        for selections in ((HtmlElementSelection('context:one','context'),HtmlElementSelection('article:one','missing')),
                           (HtmlElementSelection('context:one','context'),HtmlElementSelection('article:one','context'))):
            with self.assertRaises(HtmlInspectionReportError):html_inspection_report(replace(current,mapping=replace(current.mapping,selections=selections)),previous,observed_at=OBSERVED)

    def test_independent_recipe_or_source_mutation_does_not_follow_returned_metadata(self):
        current,previous,_=examples()
        for name,value in [('mapping_sha256','d'*64),('source_key','foreign'),('source_version_id','foreign'),('language_code','no')]:
            with self.subTest(name=name),self.assertRaises(HtmlInspectionReportError):html_inspection_report(replace(current,binding=replace(current.binding,**{name:value})),previous,observed_at=OBSERVED)

    def test_request_body_hash_metadata_and_scalar_types_are_recompiled(self):
        current,previous,request=examples()
        class Text(str):pass
        for changed in (replace(request,body=request.body+b' '),replace(request,request_sha256='0'*64),
                        replace(request,selected_payload_sha256='a'*64),replace(request,item_key='foreign'),
                        replace(request,evidence_state='stored'),replace(request,maximum_output_tokens=True),
                        replace(request,request_sha256=Text(request.request_sha256))):
            with self.subTest(changed=changed.request_sha256),self.assertRaises(HtmlInspectionReportError):
                html_inspection_report(current,previous,observed_at=OBSERVED,request=changed,maximum_output_tokens=128)
        for limit in (None,True,129):
            with self.subTest(limit=limit),self.assertRaises(HtmlInspectionReportError):html_inspection_report(current,previous,observed_at=OBSERVED,request=request,maximum_output_tokens=limit)
        with self.assertRaises(HtmlInspectionReportError):html_inspection_report(current,previous,observed_at=OBSERVED,maximum_output_tokens=128)

    def test_report_is_general_supplied_source_not_a_fictional_source_approval(self):
        current,_,_=examples();document=replace(current.document,source_key='源'*120,item_key='件'*120)
        binding=replace(current.binding,source_key=document.source_key,item_key=document.item_key)
        r=json.loads(html_inspection_report(replace(current,document=document,binding=binding),observed_at=OBSERVED))
        self.assertEqual(r['current']['source_key'],'源'*120)
        self.assertEqual(r['limits']['source_qualification'],'not_established')
        self.assertEqual(r['limits']['language_qualification'],'not_established')
        self.assertEqual(r['limits']['rights'],'not_established')

    def test_microsecond_retrieval_is_preserved_and_observation_never_refreshed(self):
        current,_,_=examples();at=AT+timedelta(hours=1,microseconds=123456)
        current=replace(current,document=replace(current.document,retrieved_at=at),binding=replace(current.binding,retrieved_at=at))
        r=json.loads(html_inspection_report(current,observed_at=OBSERVED))
        self.assertEqual(r['current']['retrieved_at'],'2026-10-16T01:00:00.123456Z')
        self.assertEqual(r['observed_at'],'2026-10-16T02:00:00.000007Z')
        self.assertEqual(json.loads(r['current']['derivation_manifest_json'])['retrieved_at'],'2026-10-16T01:00:00.123456+00:00')
        with self.assertRaises(HtmlInspectionReportError):html_inspection_report(current,observed_at=AT)

    def test_valid_large_evidence_is_refused_at_report_byte_bound_without_truncation(self):
        ids=[f'p{i}'+('x'*110) for i in range(128)]
        selections=tuple(HtmlElementSelection(f'locator:{i}'+('x'*180),identity) for i,identity in enumerate(ids))
        raw=''.join(f'<p id="{identity}">'+('Å'*150)+'</p>' for identity in ids).encode()
        current=capture(raw,selections=selections)
        from workers.html_passage_binding import bind_html_passages
        bound=bind_html_passages(raw,current.document,binding=current.binding,mapping=current.mapping,observed_at=OBSERVED)
        self.assertEqual(len(bound.spans),128)
        with self.assertRaises(HtmlInspectionReportError):html_inspection_report(current,current,observed_at=OBSERVED)
        self.assertEqual(MAX_HTML_INSPECTION_BYTES,262144)

    def test_no_file_network_provider_or_live_clock_is_used_and_failures_are_curated(self):
        current,previous,request=examples()
        with patch('builtins.open',side_effect=AssertionError('No file')),patch('urllib.request.urlopen',side_effect=AssertionError('No network')):
            self.assertEqual(html_inspection_report(current,previous,observed_at=OBSERVED,request=request,maximum_output_tokens=128),fixture_bytes())
        with self.assertRaises(HtmlInspectionReportError) as error:html_inspection_report(None,previous,observed_at=OBSERVED)
        self.assertEqual(str(error.exception),'html_inspection_report_unavailable');self.assertIsNone(error.exception.__cause__)


if __name__=='__main__':unittest.main()
