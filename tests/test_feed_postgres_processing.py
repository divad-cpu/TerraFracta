"""Pure invented processing protocol; native concurrency is checked separately."""
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_feed_postgres_contract import context,native_shape,uid
from workers.feed_postgres_processing import (
    FeedPostgresProcessingError,prepare_invented_pg_outcome,parse_invented_pg_outcome,
    invented_pg_item_history_statement,parse_invented_pg_item_history,
)


class FeedPostgresProcessingTests(unittest.TestCase):
    def setUp(self):
        self.context=context();self.page=native_shape(self.context);self.raw=json.dumps(self.page).encode()
        self.at=self.context.source.retrieved_at+timedelta(seconds=5);self.item=uid(5)
        self.request=self.prepare()

    def prepare(self,**changes):
        args=dict(observed_at=self.at,item_id=self.item,operation_id=uid(20),expected_revision=0,state='failed');args.update(changes)
        return prepare_invented_pg_outcome(self.context,self.raw,**args)

    def event(self,revision=1,state='failed',operation=20,second=2):
        return dict(operation_id=uid(operation),item_id=self.item,revision=revision,state=state,
                    recorded_at=f'2026-10-14T00:00:{second:02d}.123456+00:00')

    def history(self,events=None,item=None):
        return json.dumps(dict(item_id=item or self.item,page=self.page,outcomes=events or [])).encode()

    def test_fixed_outcome_statement_is_bounded_and_utc(self):
        sql=self.request.statement()
        self.assertIn('set time zone \'UTC\';begin;',sql)
        self.assertIn('tf_feed_rehearsal.record_outcome(',sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertLess(len(sql),2048)

    def test_outcome_requires_pending_exact_capture_item_and_closed_fields(self):
        for changes in [dict(item_id=uid(6)),dict(item_id=uid(90)),dict(operation_id='bad'),dict(expected_revision=True),
                        dict(expected_revision=8),dict(expected_revision=-1),dict(state='published')]:
            with self.subTest(changes=changes),self.assertRaises(FeedPostgresProcessingError):self.prepare(**changes)
        with self.assertRaises(FeedPostgresProcessingError):replace(self.request,capture_receipt=b'{}').statement()

    def test_outcome_receipt_exact_operation_and_historical_revision(self):
        event=parse_invented_pg_outcome(json.dumps(self.event()).encode(),self.request,observed_at=self.at)
        self.assertEqual((event.operation_id,event.revision,event.state),(uid(20),1,'failed'))
        self.assertEqual(event.recorded_at.microsecond,123456)

    def test_outcome_refuses_extra_wrong_clock_scope_or_revision(self):
        for change in [lambda r:r.update(extra=True),lambda r:r.update(item_id=uid(90)),lambda r:r.update(revision=True),
                       lambda r:r.update(revision=2),lambda r:r.update(operation_id=uid(90)),lambda r:r.update(state='processed'),
                       lambda r:r.update(recorded_at='2026-10-14T00:00:00+00:00'),
                       lambda r:r.update(recorded_at='2026-10-14T00:00:09+00:00'),
                       lambda r:r.update(recorded_at='2026-10-14T00:00:02+01:00')]:
            row=self.event();change(row)
            with self.assertRaises(FeedPostgresProcessingError):parse_invented_pg_outcome(json.dumps(row).encode(),self.request,observed_at=self.at)

    def test_empty_pending_and_parse_held_histories_remain_separate(self):
        pending=parse_invented_pg_item_history(self.history(),self.context,item_id=self.item,observed_at=self.at)
        held=parse_invented_pg_item_history(self.history(item=uid(6)),self.context,item_id=uid(6),observed_at=self.at)
        self.assertEqual((pending.state,pending.revision),('pending',0))
        self.assertEqual((held.state,held.revision,held.held_reason),('parse_held',0,'entry_link_invalid_or_ambiguous'))

    def test_failure_then_processed_history_preserves_both_events(self):
        result=parse_invented_pg_item_history(self.history([self.event(),self.event(2,'processed',21,3)]),self.context,item_id=self.item,observed_at=self.at)
        self.assertEqual((result.state,result.revision,len(result.outcomes)),('processed',2,2))
        self.assertEqual(result.outcomes[0].state,'failed')
        self.assertEqual(result.evidence_state,'invented_postgres_item_history_only')

    def test_gap_duplicate_terminal_successor_reorder_and_clock_regression_refuse(self):
        for rows in [[self.event(2)],[self.event(),self.event(1,'failed',21,3)],
                     [self.event(),self.event(2,'failed',20,3)],
                     [self.event(state='processed'),self.event(2,'failed',21,3)],
                     [self.event(second=3),self.event(2,'failed',21,2)],
                     [self.event(),self.event(2,'processed',21,3),self.event(3,'failed',22,4)]]:
            with self.assertRaises(FeedPostgresProcessingError):
                parse_invented_pg_item_history(self.history(rows),self.context,item_id=self.item,observed_at=self.at)

    def test_history_rechecks_original_page_raw_source_and_all_items(self):
        for change in [lambda p:p.update(stored_raw_matches_input=False),lambda p:p['source'].update(content_sha256='0'*64),
                       lambda p:p['items'].pop(),lambda p:p['items'][0]['metadata'].update(title='foreign')]:
            self.page=native_shape(self.context);change(self.page)
            with self.assertRaises(FeedPostgresProcessingError):parse_invented_pg_item_history(self.history(),self.context,item_id=self.item,observed_at=self.at)

    def test_parse_held_item_cannot_have_processing_events(self):
        event=self.event();event['item_id']=uid(6)
        with self.assertRaises(FeedPostgresProcessingError):parse_invented_pg_item_history(self.history([event],uid(6)),self.context,item_id=uid(6),observed_at=self.at)

    def test_history_strict_json_shape_and_event_cap(self):
        for raw in [b'[]',b'{"item_id":1,"item_id":2}',b'{"item_id":NaN}',self.history([self.event()]*9)]:
            with self.assertRaises(FeedPostgresProcessingError):parse_invented_pg_item_history(raw,self.context,item_id=self.item,observed_at=self.at)

    def test_history_query_uses_one_read_only_repeatable_snapshot_and_exact_raw(self):
        statement=invented_pg_item_history_statement(self.context,self.item)
        self.assertIn('begin isolation level repeatable read read only;',statement)
        self.assertIn(self.context.operation_id,statement)
        self.assertIn('order by o.revision',statement)
        self.assertNotIn('insert ',statement)
        with self.assertRaises(FeedPostgresProcessingError):invented_pg_item_history_statement(self.context,'bad')


if __name__=='__main__':unittest.main()
