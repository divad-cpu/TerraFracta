"""Pure protocol checks; real PostgreSQL behavior has a separate native trial."""

from dataclasses import replace
from datetime import timedelta
import json
import unittest
from unittest.mock import patch

from tests.test_feed_discovery import entry,receipt,rss
from workers.feed_postgres_contract import (
    FeedPostgresContractError,prepare_invented_pg_capture,committed_pg_json,
    parse_invented_pg_readback,COMMIT_MARKER,
)


def uid(number):return f'50000000-0000-4000-8000-{number:012d}'


def context():
    raw=rss(entry()+entry('bad','http://127.0.0.1/private')+entry('two'))
    return prepare_invented_pg_capture(raw,receipt(raw),format='rss20',stream_id=uid(1),
        operation_id=uid(2),expected_revision=0)


def native_shape(expected):
    """Port fixture only, not a claim of storage; native trial produces real rows."""
    p=json.loads(expected.canonical_input)
    return {'schema_version':1,'kind':'invented_feed_pg_page','operation_id':expected.operation_id,
        'stream_id':expected.stream_id,'page_id':uid(3),'batch_id':uid(4),'source':p['source'],
        'format':p['format'],'parser_identity':p['parser_identity'],'stored_raw_matches_input':True,
        'stored_raw_sha256':expected.source.content_sha256,'stored_raw_bytes':len(expected.raw),
        'stored_at':'2026-10-14T00:00:01.000000Z','allowed_next_url':None,
        'cursor':{'revision':1,'next_url':None,'state':'window_boundary'},
        'items':[{'item_id':uid(i+5),**row} for i,row in enumerate(p['items'])]}


class FeedPostgresContractTests(unittest.TestCase):
    def setUp(self):
        self.expected=context();self.at=self.expected.source.retrieved_at+timedelta(seconds=2)

    def test_canonical_input_requires_exact_bytes_before_statement_and_readback(self):
        calls=[]
        class OtherDecode(bytes):
            def decode(self,*args,**kwargs):
                calls.append(True)
                return '{"schema_version":2}'
        class PlainBytes(bytes):pass
        for raw in [bytearray(self.expected.canonical_input),memoryview(self.expected.canonical_input),PlainBytes(self.expected.canonical_input),OtherDecode(self.expected.canonical_input)]:
            bad=replace(self.expected,canonical_input=raw)
            with self.assertRaises(FeedPostgresContractError):bad.statement()
            with self.assertRaises(FeedPostgresContractError):parse_invented_pg_readback(json.dumps(native_shape(self.expected)).encode(),bad,observed_at=self.at)
        self.assertEqual(calls,[])

    def test_parser_snapshot_retains_all_ordered_pending_and_held_occurrences(self):
        p=json.loads(self.expected.canonical_input)
        self.assertEqual([i['position'] for i in p['items']],[1,2,3])
        self.assertEqual([i['state'] for i in p['items']],['pending','parse_held','pending'])
        self.assertIsNone(p['items'][1]['metadata'])
        self.assertNotIn('127.0.0.1',json.dumps(p['items']))
        self.assertIn('raw_base64',p)

    def test_native_statement_size_bound_is_checked_after_literal_encoding(self):
        with patch('workers.feed_postgres_contract.MAX_CAPTURE_STATEMENT',len(self.expected.statement().encode())-1):
            with self.assertRaises(FeedPostgresContractError):self.expected.statement()

    def test_exact_framing_requires_commit_marker_eof_clean_exit_and_no_stderr(self):
        row=json.dumps(native_shape(self.expected)).encode();output=row+b'\n'+COMMIT_MARKER+b'\n'
        self.assertEqual(committed_pg_json(output,b'',0),row)
        for stdout,stderr,code in [(row+b'\n',b'',0),(output,b'notice',0),(output,b'',1),
                                   (output+b'extra\n',b'',0),(b'\xff\n'+COMMIT_MARKER+b'\n',b'',0),
                                   (output,b'',False),(b'{}\n{}\n'+COMMIT_MARKER+b'\n',b'',0),
                                   (b'[]\n'+COMMIT_MARKER+b'\n',b'',0)]:
            with self.subTest(code=code),self.assertRaises(FeedPostgresContractError):committed_pg_json(stdout,stderr,code)

    def test_strict_json_refuses_duplicate_keys_and_constants(self):
        for row in [b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":Infinity}']:
            with self.assertRaises(FeedPostgresContractError):committed_pg_json(row+b'\n'+COMMIT_MARKER+b'\n',b'',0)

    def test_readback_reparses_and_matches_each_native_stored_reference(self):
        r=parse_invented_pg_readback(json.dumps(native_shape(self.expected)).encode(),self.expected,observed_at=self.at)
        self.assertEqual(r.evidence_state,'invented_postgres_commit_readback_only')
        self.assertEqual(r.page.source,self.expected.source)
        self.assertEqual([i.processing_state for i in r.items],['pending','parse_held','pending'])
        self.assertEqual(r.cursor.state,'window_boundary')

    def test_foreign_page_scope_source_bytes_parser_clock_or_cursor_refuse(self):
        for change in [lambda r:r.update(operation_id=uid(90)),lambda r:r.update(stream_id=uid(90)),
                       lambda r:r.update(stored_raw_matches_input=False),lambda r:r.update(parser_identity='latest'),
                       lambda r:r.update(stored_at='2026-10-14T00:00:01'),
                       lambda r:r.update(stored_at='2026-10-14T01:00:00.000000Z'),
                       lambda r:r['source'].update(retrieved_at='2026-10-13T00:00:00.000000Z'),
                       lambda r:r['cursor'].update(revision=True),lambda r:r['cursor'].update(state='complete'),
                       lambda r:r.update(private='not_allowed')]:
            row=native_shape(self.expected);change(row)
            with self.subTest(row_keys=list(row)),self.assertRaises(FeedPostgresContractError):
                parse_invented_pg_readback(json.dumps(row).encode(),self.expected,observed_at=self.at)

    def test_missing_extra_duplicate_mutated_or_reordered_item_refuses(self):
        for change in [lambda r:r['items'].pop(),lambda r:r['items'].append(r['items'][0]),
                       lambda r:r['items'].reverse(),lambda r:r['items'][1].update(state='pending'),
                       lambda r:r['items'][0]['metadata'].update(title='foreign'),
                       lambda r:r['items'][1].update(item_id=r['items'][0]['item_id']),
                       lambda r:r['items'][0].update(position=True)]:
            row=native_shape(self.expected);change(row)
            with self.assertRaises(FeedPostgresContractError):
                parse_invented_pg_readback(json.dumps(row).encode(),self.expected,observed_at=self.at)

    def test_forged_context_cannot_bypass_reparsing_or_choose_sql(self):
        for changed in [replace(self.expected,canonical_input=b'{}'),replace(self.expected,raw=b'bad'),
                        replace(self.expected,format='sql'),replace(self.expected,operation_id='bad')]:
            with self.assertRaises(FeedPostgresContractError):changed.statement()
            with self.assertRaises(FeedPostgresContractError):
                parse_invented_pg_readback(json.dumps(native_shape(self.expected)).encode(),changed,observed_at=self.at)

    def test_source_scope_ids_revision_and_next_permission_remain_closed(self):
        base=self.expected
        for changes in [{'stream_id':'bad'},{'operation_id':'bad'},{'expected_revision':True},
                        {'expected_revision':64},{'allowed_next_url':'https://example.org/feed.xml?page=2'}]:
            args=dict(format=base.format,stream_id=base.stream_id,operation_id=base.operation_id,expected_revision=0)
            args.update(changes)
            with self.assertRaises(FeedPostgresContractError):prepare_invented_pg_capture(base.raw,base.source,**args)

    def test_sql_literal_keeps_source_quotes_as_data_and_uses_fixed_private_operation(self):
        raw=rss(entry(title="Invented ';select pg_sleep(9);--"))
        c=prepare_invented_pg_capture(raw,receipt(raw),format='rss20',stream_id=uid(1),operation_id=uid(2),expected_revision=0)
        statement=c.statement()
        self.assertIn('tf_feed_rehearsal.capture(',statement)
        self.assertIn("Invented '';select pg_sleep(9);--",statement)
        self.assertTrue(statement.endswith('commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'))
        self.assertNotIn('terra_private',statement)


if __name__=='__main__':unittest.main()
