"""Pure untrusted inventory protocol fixtures, never evidence of actual storage."""
from copy import deepcopy
from dataclasses import asdict,replace
from datetime import datetime,timedelta,timezone
import json
import unittest
from unittest.mock import patch
from workers.feed_discovery import PARSER_IDENTITY
from workers.feed_postgres_contract import _time,MAX_CAPTURE_OUTPUT
from workers.feed_window_lineage import InventedCollectionScope
from workers.feed_collection_inventory import (
    FeedInventoryError,InventoryCut,InventoryCursor,prepare_inventory_request,parse_collection_inventory_page,
)

AT=datetime(2026,10,15,tzinfo=timezone.utc)
def uid(n):return f'70000000-0000-4000-8000-{n:012d}'
SCOPE=InventedCollectionScope(uid(1),'fictional-feed','https://example.org/feed.xml','rss20')
CUT=InventoryCut(2,uid(200),1,uid(202),AT+timedelta(seconds=5),AT+timedelta(seconds=6))


def cut_dict(cut=CUT):return {**asdict(cut),'page_stored_at':_time(cut.page_stored_at),'window_recorded_at':_time(cut.window_recorded_at)}

def event(item=uid(10),revision=1,state='failed',operation=100,second=2):
    return dict(operation_id=uid(operation),item_id=item,revision=revision,state=state,
        recorded_at=(AT+timedelta(seconds=second)).isoformat())

def row(position=1,window=1,**changes):
    current=window==2;item=uid(10+position+(1000 if current else 0))
    value=dict(window_revision=window,page_revision=1,position=position,stream_id=CUT.stream_id if current else uid(100),
        page_id=CUT.page_id if current else uid(102),capture_operation_id=uid(203 if current else 103),item_id=item,
        source_version_id=uid(204 if current else 104),source_sha256=('b' if current else 'a')*64,
        feed_url=SCOPE.initial_url,page_stored_at=_time(AT+timedelta(seconds=5 if current else 1)),
        source_retrieved_at=_time(AT+timedelta(seconds=4 if current else 0)),format='rss20',parser_identity=PARSER_IDENTITY,
        locator='feed-entry:'+str(position),entry_id='repeated' if position==1 else 'item-'+str(position),
        held_reason=None,base_state='pending',outcomes=[])
    value.update(changes);return value


def payload(request,rows=None,more=True,cut=CUT):
    if rows is None:
        one=row();one['outcomes']=[event(one['item_id'])]
        two=row(2,base_state='parse_held',held_reason='entry_link_invalid_or_ambiguous')
        rows=[one,two]
    cursor=None if not more else {"window_revision":rows[-1]['window_revision'],"page_revision":rows[-1]['page_revision'],"item_position":rows[-1]['position']}
    return dict(schema_version=1,kind='invented_collection_inventory_page',request=json.loads(request.canonical_input),
        cut=cut_dict(cut),rows=rows,has_more=more,next_cursor=cursor,observed_at=_time(AT+timedelta(seconds=10)))


def raw(value):return json.dumps(value,ensure_ascii=True,separators=(',',':')).encode()
def parse(value,request):return parse_collection_inventory_page(raw(value),request,observed_at=AT+timedelta(seconds=11))


class FeedCollectionInventoryTests(unittest.TestCase):
    def test_native_page_reports_old_failed_parseheld_and_stable_refs_without_processing_grant(self):
        request=prepare_inventory_request(SCOPE,item_limit=2);result=parse(payload(request),request)
        self.assertEqual([r.processing_state for r in result.rows],['failed','parse_held'])
        self.assertEqual(result.rows[0].outcome_revision,1)
        self.assertEqual(result.rows[0].source_version_id,uid(104))
        self.assertEqual(result.next_cursor,InventoryCursor(1,1,2))
        self.assertEqual(result.evidence_state,'invented_captured_prefix_current_states_per_page_only')
        self.assertIn('repeatable read read only',request.statement())

    def test_continuation_binds_same_structural_prefix_and_new_occurrences_remain_pending(self):
        request=prepare_inventory_request(SCOPE,item_limit=2,cut=CUT,after=InventoryCursor(1,1,2))
        old=row(3);old['outcomes']=[event(old['item_id'],state='processed',operation=101,second=3)]
        result=parse(payload(request,[old,row(1,window=2)],more=False),request)
        self.assertEqual([r.processing_state for r in result.rows],['processed','pending'])
        self.assertIsNone(result.next_cursor);self.assertEqual(result.cut,CUT)
        self.assertEqual(result.rows[1].entry_id,'repeated')

    def test_each_response_is_a_fresh_state_observation_not_an_immutable_multi_page_snapshot(self):
        request=prepare_inventory_request(SCOPE,item_limit=1,cut=CUT)
        one=row();one['outcomes']=[event(one['item_id'])]
        initial=parse(payload(request,[one],more=False),request)
        one['outcomes'].append(event(one['item_id'],2,'processed',101,3))
        later=parse(payload(request,[one],more=False),request)
        self.assertEqual(initial.rows[0].processing_state,'failed');self.assertEqual(later.rows[0].processing_state,'processed')
        self.assertEqual(initial.cut,later.cut)

    def test_empty_cut_and_empty_tail_are_valid_but_never_global_history_complete(self):
        for request in [prepare_inventory_request(SCOPE),prepare_inventory_request(SCOPE,cut=CUT,after=InventoryCursor(2,1,1))]:
            result=parse(payload(request,[],more=False),request)
            self.assertEqual(result.rows,());self.assertIsNone(result.next_cursor)
            self.assertFalse(hasattr(result,'history_complete'))

    def test_scope_limit_cut_cursor_and_immutable_request_bytes_are_closed(self):
        for kwargs in [dict(item_limit=True),dict(item_limit=0),dict(item_limit=21),dict(after=InventoryCursor(1,1,1)),
                       dict(cut=replace(CUT,window_revision=True)),dict(cut=replace(CUT,stream_revision=65)),
                       dict(cut=replace(CUT,stream_id='bad')),dict(cut=replace(CUT,page_stored_at=AT.replace(tzinfo=None))),
                       dict(cut=CUT,after=InventoryCursor(3,1,1)),dict(cut=CUT,after=InventoryCursor(2,2,1)),
                       dict(cut=CUT,after=InventoryCursor(1,1,True))]:
            with self.assertRaises(FeedInventoryError):prepare_inventory_request(SCOPE,**kwargs)
        for scope in [None,replace(SCOPE,collection_id='PRIVATE_CANARY /home/private'),replace(SCOPE,format='html')]:
            with self.assertRaises(FeedInventoryError) as raised:prepare_inventory_request(scope)
            self.assertNotIn('PRIVATE_CANARY',str(raised.exception));self.assertNotIn('/home/',str(raised.exception))
        request=prepare_inventory_request(SCOPE)
        for body in [b'{}',bytearray(request.canonical_input)]:
            with self.assertRaises(FeedInventoryError):replace(request,canonical_input=body).statement()

    def test_complete_request_and_continuation_cut_must_match(self):
        request=prepare_inventory_request(SCOPE,item_limit=2,cut=CUT);value=payload(request)
        value['request']['item_limit']=1
        with self.assertRaises(FeedInventoryError):parse(value,request)
        for field,changed in [('stream_id',uid(999)),('window_revision',1),('page_id',uid(999)),
                              ('page_stored_at',_time(AT+timedelta(seconds=4)))]:
            value=payload(request);value['cut'][field]=changed
            with self.assertRaises(FeedInventoryError):parse(value,request)

    def test_cut_and_native_observation_time_are_exact_strict_and_not_future(self):
        request=prepare_inventory_request(SCOPE,item_limit=2)
        for field,changed in [('window_revision',True),('stream_revision',0),('stream_id','bad'),
                              ('page_stored_at',_time(AT+timedelta(seconds=12))),('extra',True)]:
            value=payload(request);value['cut'][field]=changed
            with self.assertRaises(FeedInventoryError):parse(value,request)
        for when in [AT+timedelta(seconds=12),AT+timedelta(seconds=4)]:
            value=payload(request);value['observed_at']=_time(when)
            with self.assertRaises(FeedInventoryError):parse(value,request)

    def test_cursor_order_duplicate_refs_and_wrong_page_identity_refuse(self):
        request=prepare_inventory_request(SCOPE,item_limit=2,cut=CUT,after=InventoryCursor(1,1,1))
        for rows in [[row(1),row(2)],[row(3),row(2)],[row(2),row(2)],
                     [row(2),row(3,page_id=uid(909))],
                     [row(2,stream_id=CUT.stream_id),row(1,window=2)],
                     [row(2,page_id=CUT.page_id),row(1,window=2)]]:
            with self.assertRaises(FeedInventoryError):parse(payload(request,rows),request)

    def test_more_flag_cursor_count_and_terminal_shape_cannot_silently_skip_work(self):
        request=prepare_inventory_request(SCOPE,item_limit=2)
        for mutate in [lambda v:v.update(has_more=1),lambda v:v.update(next_cursor=None),
                       lambda v:v['next_cursor'].update(item_position=1),lambda v:v['rows'].pop(),
                       lambda v:v.update(has_more=False),lambda v:v['rows'].append(row(3))]:
            value=payload(request);mutate(value)
            with self.assertRaises(FeedInventoryError):parse(value,request)

    def test_event_gaps_duplicate_operations_terminal_reopening_and_parseheld_events_refuse(self):
        request=prepare_inventory_request(SCOPE,item_limit=1)
        for events in [[event(uid(11),2)], [event(uid(11)),event(uid(11),2,'failed',100,3)],
                       [event(uid(11),1,'processed'),event(uid(11),2,'failed',101,3)],
                       [event(uid(11)),event(uid(11),2,'failed',101,1)],
                       [event(uid(11),revision=True)], [event(uid(99))]]:
            with self.assertRaises(FeedInventoryError):parse(payload(request,[row(outcomes=events)],more=False),request)
        with self.assertRaises(FeedInventoryError):parse(payload(request,[row(base_state='parse_held',held_reason='entry_title_invalid',outcomes=[event(uid(11))])],more=False),request)

    def test_row_types_profile_source_times_locator_and_unrepresentable_identity_refuse(self):
        request=prepare_inventory_request(SCOPE,item_limit=1)
        variants=[('position',True),('source_sha256','f'*63),('feed_url','https://example.org/feed.xml?foreign=1'),
                  ('parser_identity','unqualified'),('format','atom10'),('source_version_id','bad'),
                  ('source_retrieved_at',_time(AT+timedelta(seconds=2))),('page_stored_at',_time(AT+timedelta(seconds=12))),
                  ('locator','foreign'),('entry_id','\ud800'),('held_reason','unknown'),('base_state','processed'),('extra',True)]
        for field,value in variants:
            with self.assertRaises(FeedInventoryError):parse(payload(request,[row(**{field:value})],more=False),request)
        with self.assertRaises(FeedInventoryError):parse(payload(request,[row(1,window=2,page_stored_at=_time(AT+timedelta(seconds=4)))],more=False),request)

    def test_supported_source_identity_whitespace_is_preserved_without_original_support_grant(self):
        request=prepare_inventory_request(SCOPE,item_limit=1)
        result=parse(payload(request,[row(entry_id='  preserved identifier  ')],more=False),request)
        self.assertEqual(result.rows[0].entry_id,'  preserved identifier  ')
        self.assertEqual(result.rows[0].processing_state,'pending')

    def test_twenty_items_with_eight_events_each_fit_the_existing_bounded_channel(self):
        request=prepare_inventory_request(SCOPE,item_limit=20);rows=[]
        for position in range(1,21):
            value=row(position,entry_id='Å'*300)
            value['outcomes']=[event(value['item_id'],revision=j,operation=1000+position*8+j,second=j+1) for j in range(1,9)]
            rows.append(value)
        value=payload(request,rows,more=False);self.assertLess(len(raw(value)),MAX_CAPTURE_OUTPUT)
        parsed=parse(value,request);self.assertEqual(len(parsed.rows),20)
        self.assertTrue(all(row.outcome_revision==8 and row.processing_state=='failed' for row in parsed.rows))

    def test_output_size_duplicate_json_and_limits_refuse_without_echoing_data(self):
        request=prepare_inventory_request(SCOPE)
        for body in [b'',b'\xff',b'{"x":1,"x":2}',b'x'*(MAX_CAPTURE_OUTPUT+1)]:
            with self.assertRaises(FeedInventoryError):parse_collection_inventory_page(body,request,observed_at=AT+timedelta(seconds=11))
        with patch('workers.feed_collection_inventory.MAX_INVENTORY_INPUT',10):
            with self.assertRaises(FeedInventoryError):prepare_inventory_request(SCOPE)
        with patch('workers.feed_collection_inventory.MAX_INVENTORY_STATEMENT',10):
            with self.assertRaises(FeedInventoryError):request.statement()


if __name__=='__main__':unittest.main()
