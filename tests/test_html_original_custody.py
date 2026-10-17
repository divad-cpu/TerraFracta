"""Pure HTML byte-custody ports; native transaction proof is separate."""
from dataclasses import replace
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import base64,json,unittest
from unittest.mock import patch
from workers.html_passage_binding import HtmlDocumentReceipt,HtmlPassageBinding,HtmlSelectionMap,HtmlElementSelection,bind_html_passages
from workers.html_original_custody import (HtmlOriginalCustodyError,HtmlOriginalIntent,prepare_html_original,parse_stored_html_original,
    prepare_html_original_reopen,reopen_html_original,MAX_HTML_METADATA_BYTES)

AT=datetime(2026,10,16,tzinfo=timezone.utc)
OP='10000000-0000-4000-8000-000000000001'
ART='10000000-0000-4000-8000-000000000002'
VERSION='10000000-0000-4000-8000-000000000003'
RECIPE='c'*64


def request(raw=b'<article id="chosen">Invented &amp; exact.</article>',operation=OP,selections=None,version=VERSION):
    digest=sha256(raw).hexdigest();url='https://example.org/invented-html.html'
    d=HtmlDocumentReceipt('fictional-html','item-one',version,url,digest,AT)
    b=HtmlPassageBinding(d.source_key,d.item_key,version,url,digest,RECIPE,'en',AT)
    m=HtmlSelectionMap(version,digest,RECIPE,'en',selections or (HtmlElementSelection('section:one','chosen'),))
    return prepare_html_original(raw,d,binding=b,mapping=m,operation_id=operation,prepared_at=AT+timedelta(seconds=1),observed_at=AT+timedelta(seconds=2))


def wire(expected):
    raw=expected.raw;metadata=expected.intent.canonical_metadata
    return dict(schema_version=1,kind='invented_html_original_stored',operation_id=expected.intent.operation_id,artifact_id=ART,
        stored_at='2026-10-16T00:00:03.000004Z',raw_base64=base64.b64encode(raw).decode(),metadata_base64=base64.b64encode(metadata).decode(),
        raw_sha256=sha256(raw).hexdigest(),metadata_sha256=sha256(metadata).hexdigest(),raw_bytes=len(raw),metadata_bytes=len(metadata))


def raw_wire(expected):return json.dumps(wire(expected)).encode()

def cold(expected):
    return prepare_html_original_reopen(intent=expected.intent,document=expected.document,binding=expected.binding,mapping=expected.mapping,
        artifact_id=ART,stored_at=AT+timedelta(seconds=3,microseconds=4),observed_at=AT+timedelta(seconds=4))


class HtmlOriginalCustodyTests(unittest.TestCase):
    def test_canonical_intent_keeps_original_derived_and_exact_metadata_separate(self):
        expected=request();meta=json.loads(expected.intent.canonical_metadata)
        self.assertEqual(expected.intent.canonical_metadata,json.dumps(meta,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
        self.assertEqual(meta['document']['media_type'],'text/html')
        self.assertEqual(meta['snapshot']['content_sha256'],sha256(expected.raw).hexdigest())
        self.assertEqual(meta['snapshot']['passages'][0]['text'],'Invented & exact.')
        self.assertEqual(meta['derivation_manifest_sha256'],sha256(meta['derivation_manifest_json'].encode()).hexdigest())
        self.assertNotIn('processed',meta);self.assertNotIn('feed_item_id',meta)
        statement=expected.statement()
        self.assertIn('begin isolation level read committed read write;',statement)
        self.assertIn('tf_html_rehearsal.store_original(decode(',statement)
        self.assertTrue(statement.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))

    def test_actual_whole_receipt_rebinds_html_and_raw_not_plaintext(self):
        expected=request();stored=parse_stored_html_original(raw_wire(expected),expected,observed_at=AT+timedelta(seconds=4))
        self.assertEqual(stored.raw,expected.raw);self.assertEqual(stored.canonical_metadata,expected.intent.canonical_metadata)
        self.assertEqual(stored.result.snapshot.passages[0].text,'Invented & exact.')
        self.assertEqual(stored.result.document.media_type,'text/html')
        self.assertEqual(stored.stored_at,AT+timedelta(seconds=3,microseconds=4))
        self.assertEqual(stored.evidence_state,'invented_html_original_bytes_stored_still_unqualified')

    def test_cold_reopen_needs_independent_intent_and_scope_but_no_prior_raw(self):
        expected=request();independent=cold(expected)
        self.assertFalse(hasattr(independent,'raw'))
        self.assertIn('begin isolation level repeatable read read only;',independent.statement())
        self.assertIn('tf_html_rehearsal.original_receipt(',independent.statement())
        result=reopen_html_original(raw_wire(expected),independent,observed_at=AT+timedelta(seconds=5))
        self.assertEqual(result.raw,expected.raw);self.assertEqual(result.canonical_metadata,expected.intent.canonical_metadata)

    def test_forged_prepared_bytes_metadata_types_or_source_cannot_choose_statement(self):
        expected=request()
        for changed in (replace(expected,raw=expected.raw+b'foreign'),replace(expected,intent=replace(expected.intent,canonical_metadata=b'{}')),
            replace(expected,intent=replace(expected.intent,canonical_metadata=bytearray(expected.intent.canonical_metadata))),
            replace(expected,intent=replace(expected.intent,operation_id=ART)),replace(expected,mapping=replace(expected.mapping,mapping_sha256='d'*64))):
            with self.subTest(),self.assertRaises(HtmlOriginalCustodyError):changed.statement()
            with self.assertRaises(HtmlOriginalCustodyError):parse_stored_html_original(raw_wire(expected),changed,observed_at=AT+timedelta(seconds=4))

    def test_noncanonical_original_intent_and_source_scope_reject_before_getter(self):
        expected=request()
        for change in (dict(intent=replace(expected.intent,canonical_metadata=json.dumps(json.loads(expected.intent.canonical_metadata)).encode())),
            dict(binding=replace(expected.binding,source_key='foreign')),dict(mapping=replace(expected.mapping,language_code='no')),
            dict(document=replace(expected.document,source_url='https://foreign.example/one')),dict(artifact_id='invalid')):
            args=dict(intent=expected.intent,document=expected.document,binding=expected.binding,mapping=expected.mapping,artifact_id=ART,
                stored_at=AT+timedelta(seconds=3,microseconds=4),observed_at=AT+timedelta(seconds=4));args.update(change)
            with self.subTest(),self.assertRaises(HtmlOriginalCustodyError):prepare_html_original_reopen(**args)

    def test_closed_receipt_unknown_duplicate_boolean_base64_hash_and_raw_mutations_withhold(self):
        expected=request()
        for key,value in [('extra',True),('schema_version',True),('operation_id',ART),('artifact_id','bad'),('raw_bytes',True),('metadata_bytes',False),
            ('raw_sha256','0'*64),('metadata_sha256','0'*64),('raw_base64',base64.b64encode(b'changed').decode()),
            ('metadata_base64',base64.b64encode(b'{}').decode()),('stored_at','2026-10-16T00:00:03Z')]:
            value_dict=wire(expected);value_dict[key]=value
            with self.subTest(key=key),self.assertRaises(HtmlOriginalCustodyError):parse_stored_html_original(json.dumps(value_dict).encode(),expected,observed_at=AT+timedelta(seconds=4))
        duplicate=raw_wire(expected).replace(b'"schema_version": 1',b'"schema_version":1,"schema_version":1')
        with self.assertRaises(HtmlOriginalCustodyError):reopen_html_original(duplicate,cold(expected),observed_at=AT+timedelta(seconds=5))
        value=wire(expected);value['raw_base64']+='\n'
        with self.assertRaises(HtmlOriginalCustodyError):parse_stored_html_original(json.dumps(value).encode(),expected,observed_at=AT+timedelta(seconds=4))

    def test_semantically_forged_metadata_even_with_matching_hashes_is_rederived(self):
        expected=request();meta=json.loads(expected.intent.canonical_metadata);meta['snapshot']['passages'][0]['text']='Invented forged text.'
        changed_meta=json.dumps(meta,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
        value=wire(expected);value.update(metadata_base64=base64.b64encode(changed_meta).decode(),metadata_sha256=sha256(changed_meta).hexdigest(),metadata_bytes=len(changed_meta))
        forged=replace(expected,intent=replace(expected.intent,canonical_metadata=changed_meta))
        with self.assertRaises(HtmlOriginalCustodyError):parse_stored_html_original(json.dumps(value).encode(),forged,observed_at=AT+timedelta(seconds=4))
        independent=cold(forged)
        with self.assertRaises(HtmlOriginalCustodyError):reopen_html_original(json.dumps(value).encode(),independent,observed_at=AT+timedelta(seconds=5))

    def test_original_prepared_stored_and_independent_observation_never_renew(self):
        expected=request()
        for value in ('2026-10-16T00:00:00.000000Z','2026-10-16T00:00:05.000000Z'):
            r=wire(expected);r['stored_at']=value
            with self.assertRaises(HtmlOriginalCustodyError):parse_stored_html_original(json.dumps(r).encode(),expected,observed_at=AT+timedelta(seconds=4))
        r=wire(expected);r['stored_at']='2026-10-16T00:00:03.000005Z'
        with self.assertRaises(HtmlOriginalCustodyError):reopen_html_original(json.dumps(r).encode(),cold(expected),observed_at=AT+timedelta(seconds=5))
        with self.assertRaises(HtmlOriginalCustodyError):parse_stored_html_original(raw_wire(expected),expected,observed_at=AT)
        with self.assertRaises(HtmlOriginalCustodyError):reopen_html_original(raw_wire(expected),cold(expected),observed_at=AT+timedelta(seconds=3))

    def test_native_port_is_fictional_example_only_and_does_not_issue_source_trust(self):
        expected=request()
        for document in (replace(expected.document,source_key='real-source'),replace(expected.document,source_url='https://example.net/one'),
                         replace(expected.document,source_url='https://example.org/one?token=x'),replace(expected.document,source_version_id='html-new')):
            with self.subTest(),self.assertRaises(HtmlOriginalCustodyError):prepare_html_original(expected.raw,document,binding=expected.binding,mapping=expected.mapping,
                operation_id=OP,prepared_at=expected.intent.prepared_at,observed_at=expected.observed_at)

    def test_new_native_url_dialect_refuses_root_and_at_path_before_prepare_statement(self):
        e=request()
        for url in ('https://example.org/','https://example.org/a@b'):
            with self.subTest(url=url),self.assertRaises(HtmlOriginalCustodyError):
                prepare_html_original(e.raw,replace(e.document,source_url=url),binding=replace(e.binding,source_url=url),mapping=e.mapping,
                    operation_id=OP,prepared_at=e.intent.prepared_at,observed_at=e.observed_at)
        for url in ('https://example.org/invented-html.html','https://example.org/a/b'):
            admitted=prepare_html_original(e.raw,replace(e.document,source_url=url),binding=replace(e.binding,source_url=url),mapping=e.mapping,
                operation_id=OP,prepared_at=e.intent.prepared_at,observed_at=e.observed_at)
            self.assertIn('tf_html_rehearsal.store_original(',admitted.statement())

    def test_new_native_url_dialect_refuses_root_and_at_path_before_cold_getter(self):
        e=request()
        for url in ('https://example.org/','https://example.org/a@b'):
            meta=json.loads(e.intent.canonical_metadata);meta['document']['source_url']=url
            manifest=json.loads(meta['derivation_manifest_json']);manifest['source_url']=url
            meta['derivation_manifest_json']=json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=False)
            meta['derivation_manifest_sha256']=sha256(meta['derivation_manifest_json'].encode()).hexdigest()
            intent=replace(e.intent,canonical_metadata=json.dumps(meta,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
            with self.subTest(url=url),self.assertRaises(HtmlOriginalCustodyError):
                prepare_html_original_reopen(intent=intent,document=replace(e.document,source_url=url),binding=replace(e.binding,source_url=url),mapping=e.mapping,
                    artifact_id=ART,stored_at=AT+timedelta(seconds=3,microseconds=4),observed_at=AT+timedelta(seconds=4))
        self.assertIn('tf_html_rehearsal.original_receipt(',cold(e).statement())

    def test_valid_base_large_selection_is_held_before_any_storage_statement(self):
        ids=[f'p{i}'+('x'*100) for i in range(80)]
        selections=tuple(HtmlElementSelection(f'locator:{i}'+('x'*170),identity) for i,identity in enumerate(ids))
        raw=''.join(f'<p id="{identity}">Invented</p>' for identity in ids).encode()
        e=request();d=replace(e.document,content_sha256=sha256(raw).hexdigest());b=replace(e.binding,content_sha256=d.content_sha256);m=replace(e.mapping,content_sha256=d.content_sha256,selections=selections)
        self.assertEqual(len(bind_html_passages(raw,d,binding=b,mapping=m,observed_at=e.observed_at).spans),80)
        with self.assertRaises(HtmlOriginalCustodyError):prepare_html_original(raw,d,binding=b,mapping=m,operation_id=OP,prepared_at=e.intent.prepared_at,observed_at=e.observed_at)
        self.assertEqual(MAX_HTML_METADATA_BYTES,32768)

    def test_max_original_and_whole_bounded_statement_are_preserved(self):
        raw=b'<p id="chosen">Invented.</p>';raw+=b' '*(65536-len(raw));e=request(raw)
        self.assertEqual(len(e.raw),65536);self.assertLess(len(e.statement().encode()),294912)
        self.assertLess(len(raw_wire(e))+4096,131072)
        with self.assertRaises(HtmlOriginalCustodyError):request(raw+b' ')

    def test_curated_failure_and_fixed_ports_do_not_open_file_network_or_backend(self):
        with patch('builtins.open',side_effect=AssertionError('No file')),patch('urllib.request.urlopen',side_effect=AssertionError('No fetch')):
            expected=request();expected.statement();cold(expected).statement();reopen_html_original(raw_wire(expected),cold(expected),observed_at=AT+timedelta(seconds=5))
        with self.assertRaises(HtmlOriginalCustodyError) as error:prepare_html_original(b'PRIVATE',None,binding=None,mapping=None,operation_id=OP,prepared_at=AT,observed_at=AT)
        self.assertEqual(str(error.exception),'html_original_input_unavailable');self.assertIsNone(error.exception.__cause__)


if __name__=='__main__':unittest.main()
