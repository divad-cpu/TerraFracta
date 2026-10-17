"""Closed pure result protocol; actual atomicity has a separate native trial."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_feed_postgres_contract import context,native_shape,uid
from tests.test_document_passage_binding import inputs,AT
from workers.document_passage_binding import DocumentByteSpan,DocumentPassageBinding
from workers.document_result_contract import (
    FeedDocumentAssociation,DocumentResultContractError,prepare_invented_document_result,
    parse_stored_invented_document_result,invented_document_result_read_statement,
)


def request(raw=None,spans=None,version=None,**changes):
    feed=context();page=native_shape(feed)
    if raw is None:raw=b'Invented original passage.\nNot selected.'
    values=inputs(raw,[DocumentByteSpan('section:one',0,26)] if spans is None else spans,uid(30) if version is None else version)
    document=replace(values['document'],source_key='fictional-document',source_url='https://example.org/one')
    binding=replace(values['binding'],source_key='fictional-document',source_url=document.source_url)
    args=dict(document_raw=raw,document=document,binding=binding,mapping=values['mapping'],
        association=FeedDocumentAssociation(feed.operation_id,uid(5),document.source_key,document.item_key,
            document.source_version_id,document.content_sha256,document.source_url),operation_id=uid(40),expected_revision=0,
        observed_at=AT+timedelta(seconds=10));args.update(changes)
    return prepare_invented_document_result(feed,json.dumps(page).encode(),**args)


def stored_shape(expected):
    payload=json.loads(expected.canonical_input)
    return {'schema_version':1,'kind':'invented_document_result_stored','operation_id':expected.operation_id,
        'artifact_id':uid(41),'stored_at':'2026-10-15T00:00:12.000000Z','stored_raw_matches_input':True,
        'stored_raw_sha256':sha256(expected.document_raw).hexdigest(),'stored_raw_bytes':len(expected.document_raw),
        'input':{k:v for k,v in payload.items() if k!='raw_base64'},'page':json.loads(expected.capture_receipt),
        'outcome':dict(operation_id=expected.operation_id,item_id=expected.association.feed_item_id,
            revision=1,state='processed',recorded_at='2026-10-15T00:00:11.000000+00:00')}


class DocumentResultContractTests(unittest.TestCase):
    def setUp(self):self.expected=request();self.at=AT+timedelta(seconds=13)

    def test_canonical_input_requires_exact_bytes_before_write_read_or_parse(self):
        calls=[]
        class OtherDecode(bytes):
            def decode(self,*args,**kwargs):
                calls.append(True)
                return '{"schema_version":2}'
        class PlainBytes(bytes):pass
        for raw in [bytearray(self.expected.canonical_input),memoryview(self.expected.canonical_input),PlainBytes(self.expected.canonical_input),OtherDecode(self.expected.canonical_input)]:
            bad=replace(self.expected,canonical_input=raw)
            with self.assertRaises(DocumentResultContractError):bad.statement()
            with self.assertRaises(DocumentResultContractError):invented_document_result_read_statement(bad)
            with self.assertRaises(DocumentResultContractError):parse_stored_invented_document_result(json.dumps(stored_shape(self.expected)).encode(),bad,observed_at=self.at)
        self.assertEqual(calls,[])

    def test_fixed_result_statement_binds_original_feed_and_document_not_free_sql(self):
        sql=self.expected.statement()
        self.assertIn('tf_feed_rehearsal.complete_document_result(',sql)
        self.assertIn("set time zone 'UTC';begin;",sql)
        self.assertIn('"raw_base64":',sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertNotIn('security definer',sql)

    def test_exact_native_result_reparses_original_bytes_and_separate_document_version(self):
        result=parse_stored_invented_document_result(json.dumps(stored_shape(self.expected)).encode(),self.expected,observed_at=self.at)
        self.assertEqual(result.result.snapshot.passages[0].text,'Invented original passage.')
        self.assertNotEqual(result.result.document.source_version_id,self.expected.feed_capture.source.source_version_id)
        self.assertEqual((result.operation_id,result.outcome_revision),(self.expected.operation_id,1))
        self.assertEqual(result.evidence_state,'invented_document_result_and_outcome_commit_only')

    def test_invalid_operation_revision_foreign_association_and_parse_held_refuse(self):
        a=self.expected.association
        for change in [dict(operation_id='bad'),dict(expected_revision=True),dict(expected_revision=8),
                       dict(association=replace(a,feed_item_id=uid(6))),dict(association=replace(a,feed_operation_id=uid(99))),
                       dict(association=replace(a,document_content_sha256='f'*64)),
                       dict(association=replace(a,document_source_key='fictional-other'))]:
            with self.subTest(change=change),self.assertRaises(DocumentResultContractError):request(**change)

    def test_forged_context_cannot_choose_arbitrary_payload_or_substitute_document(self):
        for changed in [replace(self.expected,canonical_input=b'{}'),replace(self.expected,document_raw=b'foreign'),
                        replace(self.expected,capture_receipt=b'{}'),replace(self.expected,operation_id='bad')]:
            with self.assertRaises(DocumentResultContractError):changed.statement()
            with self.assertRaises(DocumentResultContractError):invented_document_result_read_statement(changed)

    def test_readback_refuses_wrong_native_bytes_artifact_input_page_and_outcome(self):
        changes=[lambda r:r.update(stored_raw_matches_input=False),lambda r:r.update(stored_raw_bytes=True),
                 lambda r:r.update(artifact_id='bad'),lambda r:r.update(extra=True),
                 lambda r:r['input']['document'].update(source_key='fictional-foreign'),
                 lambda r:r['input']['snapshot']['passages'][0].update(text='foreign'),
                 lambda r:r['input']['mapping']['spans'][0].update(start=True),
                 lambda r:r['input'].update(schema_version=True),lambda r:r['outcome'].update(state='failed'),
                 lambda r:r['outcome'].update(revision=2),lambda r:r['outcome'].update(item_id=uid(99)),
                 lambda r:r['page'].update(stored_raw_matches_input=False)]
        for change in changes:
            value=stored_shape(self.expected);change(value)
            with self.assertRaises(DocumentResultContractError):
                parse_stored_invented_document_result(json.dumps(value).encode(),self.expected,observed_at=self.at)

    def test_processing_event_cannot_predate_the_original_document_observation(self):
        value=stored_shape(self.expected)
        value['outcome']['recorded_at']='2026-10-14T00:00:02.000000+00:00'
        with self.assertRaises(DocumentResultContractError):
            parse_stored_invented_document_result(json.dumps(value).encode(),self.expected,observed_at=self.at)

    def test_stored_clock_cannot_precede_event_or_follow_observation(self):
        for at in ['2026-10-15T00:00:10.000000Z','2026-10-15T00:00:14.000000Z','2026-10-15T00:00:12+01:00']:
            value=stored_shape(self.expected);value['stored_at']=at
            with self.assertRaises(DocumentResultContractError):parse_stored_invented_document_result(json.dumps(value).encode(),self.expected,observed_at=self.at)

    def test_strict_duplicate_keys_constants_output_and_statement_bounds(self):
        for raw in [b'{"x":1,"x":2}',b'{"x":NaN}',b'[]',b'x'*131073]:
            with self.assertRaises(DocumentResultContractError):parse_stored_invented_document_result(raw,self.expected,observed_at=self.at)
        with patch('workers.document_result_contract.MAX_CAPTURE_OUTPUT',100):
            with self.assertRaises(DocumentResultContractError):request()
        with patch('workers.document_result_contract.MAX_CAPTURE_STATEMENT',100):
            with self.assertRaises(DocumentResultContractError):self.expected.statement()

    def test_result_inspection_is_one_read_only_repeatable_snapshot(self):
        statement=invented_document_result_read_statement(self.expected)
        self.assertIn('begin isolation level repeatable read read only;',statement)
        self.assertIn('tf_feed_rehearsal.document_result_receipt(',statement)
        self.assertNotIn('insert ',statement)

    def test_native_text_representation_refuses_actual_zero_but_preserves_literal_escape(self):
        literal=b'Literal \\u0000 text'
        accepted=request(raw=literal,spans=[DocumentByteSpan('one',0,len(literal))])
        self.assertIn(b'Literal',accepted.canonical_input)
        for raw,spans in [(b'Original\x00text',[DocumentByteSpan('one',0,13)]),
                          (b'Original selected\n\x00unselected',[DocumentByteSpan('one',0,17)])]:
            with self.assertRaises(DocumentResultContractError):request(raw=raw,spans=spans)

    def test_document_version_is_independent_even_if_all_supplied_fields_copy_feed_version(self):
        with self.assertRaises(DocumentResultContractError):request(version=self.expected.feed_capture.source.source_version_id)

    def test_existing_raw_hash_source_mapping_language_and_original_time_gates_remain(self):
        for field,value in [('content_sha256','f'*64),('source_url','https://example.org/foreign'),
                            ('source_version_id',self.expected.feed_capture.source.source_version_id),
                            ('retrieved_at',AT-timedelta(days=2))]:
            document=replace(self.expected.document,**{field:value})
            with self.assertRaises(DocumentResultContractError):request(document=document)


if __name__=='__main__':unittest.main()
