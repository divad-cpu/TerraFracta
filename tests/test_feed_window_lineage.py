"""Exact predecessor/current first-page protocol, no database or polling call."""
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
from tests.test_feed_postgres_contract import context, native_shape, uid
from tests.test_feed_discovery import rss, entry, receipt
from workers.feed_postgres_contract import prepare_invented_pg_capture, _time
from workers.feed_window_lineage import (
    InventedCollectionScope, FeedWindowLineageError, MAX_WINDOWS,
    invented_collection_head_statement, parse_invented_collection_head,
    prepare_invented_window_advance, invented_window_receipt_statement, parse_invented_window_started,
)


def inputs():
    before=context();scope=InventedCollectionScope(uid(100),before.source.source_key,before.source.feed_url,'rss20')
    page=native_shape(before)
    head=dict(schema_version=1,kind='invented_collection_head',collection_id=scope.collection_id,
        source_key=scope.source_key,initial_url=scope.initial_url,format=scope.format,window_revision=1,
        stream_id=before.stream_id,latest_page_id=page['page_id'],latest_stream_revision=1,
        window_recorded_at='2026-10-14T00:00:02.000000Z',page=page)
    source=replace(before.source,source_version_id=uid(102),retrieved_at=before.source.retrieved_at+timedelta(seconds=3))
    first=prepare_invented_pg_capture(before.raw,source,format='rss20',stream_id=uid(101),operation_id=uid(103),expected_revision=0)
    return scope,before,head,first,before.source.retrieved_at+timedelta(seconds=10)


def prepare(values=None):
    scope,before,head,first,at=inputs() if values is None else values
    return prepare_invented_window_advance(scope,before,json.dumps(head).encode(),first,observed_at=at)


def started(request):
    p=json.loads(request.canonical_input);page=native_shape(request.first_capture)
    page.update(page_id=uid(104),batch_id=uid(105),stored_at=_time(request.first_capture.source.retrieved_at+timedelta(seconds=1)))
    return dict(schema_version=1,kind='invented_collection_window_started',collection_id=request.scope.collection_id,
        operation_id=request.first_capture.operation_id,window_revision=2,previous_stream_id=p['previous_stream_id'],
        previous_page_id=p['previous_page_id'],stream_id=request.first_capture.stream_id,page_id=page['page_id'],
        recorded_at=_time(request.first_capture.source.retrieved_at+timedelta(seconds=2)),
        input={k:v for k,v in p.items() if k!='capture'},page=page)


class FeedWindowLineageTests(unittest.TestCase):
    def test_canonical_input_requires_exact_bytes_before_advance_or_read(self):
        request=prepare()
        calls=[]
        class OtherDecode(bytes):
            def decode(self,*args,**kwargs):
                calls.append(True)
                return '{"schema_version":2}'
        class PlainBytes(bytes):pass
        for raw in [bytearray(request.canonical_input),memoryview(request.canonical_input),PlainBytes(request.canonical_input),OtherDecode(request.canonical_input)]:
            bad=replace(request,canonical_input=raw)
            with self.assertRaises(FeedWindowLineageError):bad.statement()
            with self.assertRaises(FeedWindowLineageError):invented_window_receipt_statement(bad)
            with self.assertRaises(FeedWindowLineageError):parse_invented_window_started(json.dumps(started(request)).encode(),bad,observed_at=request.observed_at)
        self.assertEqual(calls,[])

    def test_exact_head_reparses_predecessor_and_preserves_pending_held_occurrences(self):
        scope,before,head,first,at=inputs()
        parsed=parse_invented_collection_head(json.dumps(head).encode(),scope,before,observed_at=at)
        self.assertEqual(parsed.window_revision,1)
        self.assertEqual([row.processing_state for row in parsed.page.items],['pending','parse_held','pending'])
        self.assertEqual(parsed.evidence_state,'invented_collection_current_head_only')
        self.assertIn('repeatable read read only',invented_collection_head_statement(scope,before))

    def test_atomic_successor_contains_exact_first_capture_and_explicit_predecessor(self):
        request=prepare();p=json.loads(request.canonical_input)
        self.assertEqual(p['capture'],json.loads(request.first_capture.canonical_input))
        self.assertEqual(p['expected_window_revision'],1)
        self.assertEqual(p['previous_stream_id'],request.previous_capture.stream_id)
        self.assertIn('select tf_feed_windows.advance(',request.statement())
        self.assertIn('commit;',request.statement())
        self.assertNotIn('fictional original',repr(request))

    def test_exact_native_successor_receipt_is_historical_start_not_current_head_or_rights(self):
        request=prepare();record=started(request)
        result=parse_invented_window_started(json.dumps(record).encode(),request,observed_at=request.observed_at)
        self.assertEqual(result.window_revision,2);self.assertEqual(result.page.cursor.revision,1)
        self.assertEqual(result.evidence_state,'invented_historical_window_start_only')
        self.assertEqual(result.previous_stream_id,request.previous_capture.stream_id)
        self.assertIn('repeatable read read only',invented_window_receipt_statement(request))

    def test_head_identity_and_actual_page_revision_cannot_be_forged(self):
        scope,before,head,first,at=inputs()
        for field,value in [('schema_version',True),('collection_id',uid(120)),('source_key','fictional-other'),
                            ('initial_url','https://example.org/feed.xml?foreign=1'),('format','atom10'),
                            ('window_revision',True),('window_revision',0),('window_revision',33),
                            ('stream_id',uid(120)),('latest_page_id',uid(120)),('latest_stream_revision',True),
                            ('latest_stream_revision',2),('extra',True)]:
            changed={**head,field:value}
            with self.assertRaises(FeedWindowLineageError):parse_invented_collection_head(json.dumps(changed).encode(),scope,before,observed_at=at)

    def test_changed_original_predecessor_and_forged_first_capture_refuse(self):
        scope,before,head,first,at=inputs()
        variants=[(scope,replace(before,raw=before.raw+b'changed'),head,first,at),
                  (scope,before,head,replace(first,canonical_input=b'{}'),at),
                  (scope,before,head,{},at),(scope,before,{},first,at),
                  (replace(scope,source_key='fictional-foreign'),before,head,first,at)]
        for values in variants:
            with self.assertRaises(FeedWindowLineageError):prepare(values)

    def test_first_page_requires_independent_new_stream_version_root_profile_and_time(self):
        scope,before,head,first,at=inputs()
        sources=[replace(first.source,source_key='fictional-other'),replace(first.source,feed_url=scope.initial_url+'?new=1'),
                 replace(first.source,source_version_id=before.source.source_version_id),
                 replace(first.source,retrieved_at=before.source.retrieved_at-timedelta(seconds=1)),
                 replace(first.source,retrieved_at=at+timedelta(seconds=1))]
        variants=[replace(first,stream_id=before.stream_id)]
        for source in sources:
            variants.append(prepare_invented_pg_capture(first.raw,source,format='rss20',stream_id=first.stream_id,
                operation_id=first.operation_id,expected_revision=0))
        for bad in variants:
            with self.assertRaises(FeedWindowLineageError):prepare((scope,before,head,bad,at))

    def test_same_source_bytes_new_occurrence_is_not_automatically_skipped_or_processed(self):
        scope,before,head,first,at=inputs();self.assertEqual(first.raw,before.raw)
        request=prepare();result=parse_invented_window_started(json.dumps(started(request)).encode(),request,observed_at=at)
        self.assertEqual(result.page.page.source.content_sha256,before.source.content_sha256)
        self.assertNotEqual(result.page.page.source.source_version_id,before.source.source_version_id)
        self.assertEqual(result.page.items[0].processing_state,'pending')

    def test_closed_window_limit_refuses_before_sql_and_bool_does_not_borrow_integer(self):
        scope,before,head,first,at=inputs()
        with self.assertRaises(FeedWindowLineageError):prepare((scope,before,{**head,'window_revision':MAX_WINDOWS},first,at))
        request=prepare()
        for bad in [replace(request,canonical_input=b'{}'),replace(request,observed_at=at.replace(tzinfo=None))]:
            with self.assertRaises(FeedWindowLineageError):bad.statement()
        with patch('workers.feed_window_lineage.MAX_CAPTURE_STATEMENT',10):
            with self.assertRaises(FeedWindowLineageError):request.statement()
        with patch('workers.feed_window_lineage.MAX_CAPTURE_INPUT',10):
            with self.assertRaises(FeedWindowLineageError):prepare()

    def test_incomplete_or_permission_held_head_cannot_start_a_new_window(self):
        scope,before,head,first,at=inputs();url='https://example.org/feed.xml?page=2'
        raw=rss(entry(),extra='<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="'+url+'"/>')
        for allowed,state in [(url,'next_ready'),(None,'next_permission_unresolved')]:
            prior=prepare_invented_pg_capture(raw,receipt(raw),format='rss20',stream_id=before.stream_id,
                operation_id=before.operation_id,expected_revision=0,allowed_next_url=allowed)
            page=native_shape(prior);page['allowed_next_url']=allowed
            page['cursor']={'revision':1,'next_url':allowed,'state':state}
            changed={**head,'page':page}
            parsed=parse_invented_collection_head(json.dumps(changed).encode(),scope,prior,observed_at=at)
            self.assertEqual(parsed.page.cursor.state,state)
            with self.assertRaises(FeedWindowLineageError):prepare((scope,prior,changed,first,at))

    def test_genuine_boundary_on_page64_can_start_next_window_without_reopening_old_stream(self):
        scope,before,head,first,at=inputs()
        source=replace(before.source,feed_url=scope.initial_url+'?page=64')
        prior=prepare_invented_pg_capture(before.raw,source,format='rss20',stream_id=before.stream_id,
            operation_id=before.operation_id,expected_revision=63)
        page=native_shape(prior);page['cursor']['revision']=64
        changed={**head,'latest_stream_revision':64,'page':page}
        request=prepare((scope,prior,changed,first,at))
        self.assertEqual(json.loads(request.canonical_input)['expected_window_revision'],1)
        self.assertEqual(json.loads(request.canonical_input)['capture']['expected_revision'],0)

    def test_source_scope_and_raw_channels_are_closed_with_curated_errors(self):
        scope,before,head,first,at=inputs()
        for bad in [None,replace(scope,collection_id='PRIVATE_CANARY /home/private'),replace(scope,source_key='bad'),
                    replace(scope,initial_url='http://localhost/private'),replace(scope,format='html')]:
            with self.assertRaises(FeedWindowLineageError) as raised:invented_collection_head_statement(bad,before)
            self.assertNotIn('PRIVATE_CANARY',str(raised.exception));self.assertNotIn('/home/',str(raised.exception))
        for raw in [b'',b'{}',b'{"x":1,"x":2}',b'\xff',b'x'*(128*1024+1)]:
            with self.assertRaises(FeedWindowLineageError):parse_invented_collection_head(raw,scope,before,observed_at=at)

    def test_successor_native_identity_schema_predecessor_and_input_types_must_match(self):
        request=prepare();record=started(request)
        for field,value in [('schema_version',True),('collection_id',uid(120)),('operation_id',uid(120)),
                            ('window_revision',True),('window_revision',3),('previous_stream_id',uid(120)),
                            ('previous_page_id',uid(120)),('stream_id',uid(120)),('page_id',uid(120)),('extra',True),
                            ('recorded_at','2026-10-13T00:00:00.000000Z')]:
            with self.assertRaises(FeedWindowLineageError):parse_invented_window_started(json.dumps({**record,field:value}).encode(),request,observed_at=request.observed_at)
        record['input']['expected_window_revision']=True
        with self.assertRaises(FeedWindowLineageError):parse_invented_window_started(json.dumps(record).encode(),request,observed_at=request.observed_at)

    def test_individually_valid_pages_cannot_move_stored_chronology_backwards(self):
        scope,before,head,first,at=inputs()
        head['page']['stored_at']=_time(before.source.retrieved_at+timedelta(seconds=8))
        request=prepare((scope,before,head,first,at));record=started(request)
        # Old page at8, new page at4 and transition at5 individually satisfy
        # each original source/readback time bound, but not cross-window order.
        with self.assertRaises(FeedWindowLineageError):
            parse_invented_window_started(json.dumps(record).encode(),request,observed_at=at)

    def test_previous_window_transition_is_a_separate_stored_time_bound(self):
        scope,before,head,first,at=inputs()
        head['window_recorded_at']=_time(before.source.retrieved_at+timedelta(seconds=8))
        request=prepare((scope,before,head,first,at))
        with self.assertRaises(FeedWindowLineageError):
            parse_invented_window_started(json.dumps(started(request)).encode(),request,observed_at=at)
        head['window_recorded_at']=_time(at+timedelta(seconds=1))
        with self.assertRaises(FeedWindowLineageError):prepare((scope,before,head,first,at))

    def test_successor_actual_raw_hash_and_native_item_refs_reparse_instead_of_trusting_json(self):
        request=prepare();record=started(request)
        for field,value in [('stored_raw_matches_input',False),('stored_raw_sha256','f'*64)]:
            changed={**record,'page':{**record['page'],field:value}}
            with self.assertRaises(FeedWindowLineageError):parse_invented_window_started(json.dumps(changed).encode(),request,observed_at=request.observed_at)
        record['page']['items'][0]['entry_id']='foreign'
        with self.assertRaises(FeedWindowLineageError):parse_invented_window_started(json.dumps(record).encode(),request,observed_at=request.observed_at)


if __name__=='__main__':unittest.main()
