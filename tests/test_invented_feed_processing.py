"""Stored processing remains separate from discovery and historical replay."""

from dataclasses import replace
from datetime import timedelta
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from uuid import uuid4

from tests.test_feed_discovery import receipt, entry, rss
from workers.invented_feed_journal import InventedFeedJournal, FeedJournalError
from workers.invented_feed_processing import inspect_feed_work, record_feed_outcome


class InventedFeedProcessingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='tf-invented-feed-processing-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.store = InventedFeedJournal(self.directory,create=True,
            source_key='fictional-feed',feed_url='https://example.org/feed.xml')
        self.addCleanup(self.store.close)
        raw = rss(entry()+entry('bad','http://127.0.0.1/private')+entry('second'))
        self.source = receipt(raw)
        self.at = self.source.retrieved_at+timedelta(seconds=1)
        self.capture_operation = str(uuid4())
        self.captured = self.store.capture(raw,self.source,expected_format='rss20',
            operation_id=self.capture_operation,expected_revision=0,stored_at=self.at)
        self.initial_cursor = self.store.cursor()
        self.items = inspect_feed_work(self.store)

    def outcome(self, **changes):
        args = dict(operation_id=str(uuid4()),item_id=self.items[0].item_id,
            expected_revision=0,state='failed',recorded_at=self.at+timedelta(seconds=1))
        args.update(changes)
        return record_feed_outcome(self.store,**args)

    def test_failed_retry_processed_and_exact_old_replay_preserve_current_state(self):
        failed = self.outcome()
        work = inspect_feed_work(self.store)
        self.assertEqual([(i.processing_state,i.outcome_revision) for i in work],
            [('failed',1),('parse_held',0),('pending',0)])
        complete = self.outcome(expected_revision=1,state='processed',recorded_at=self.at+timedelta(seconds=2))
        old = self.outcome(operation_id=failed.operation_id,recorded_at=self.at+timedelta(hours=1))
        self.assertEqual(old,replace(failed,replayed=True))
        self.assertEqual(inspect_feed_work(self.store)[0].processing_state,'processed')
        self.assertEqual(inspect_feed_work(self.store)[0].outcome_revision,2)
        self.assertEqual(self.store.connection.execute('SELECT count(*) FROM outcomes').fetchone()[0],2)
        self.assertEqual(self.store.cursor(),self.initial_cursor)
        self.assertEqual(self.store.inspect(self.capture_operation),replace(self.captured,replayed=True))
        self.store.close();self.store=InventedFeedJournal(self.directory);self.addCleanup(self.store.close)
        self.assertEqual(inspect_feed_work(self.store)[0].processing_state,'processed')

    def test_parser_holds_foreign_items_wrong_revision_or_time_cannot_be_processed(self):
        for changes in [{'item_id':self.items[1].item_id},{'item_id':str(uuid4())},
                        {'expected_revision':1},{'expected_revision':True},{'state':'eligible'},
                        {'recorded_at':self.at-timedelta(microseconds=1)},
                        {'recorded_at':self.at.replace(tzinfo=None)}]:
            with self.subTest(changes=changes),self.assertRaises(FeedJournalError):self.outcome(**changes)
        self.assertEqual(inspect_feed_work(self.store),self.items)
        self.assertEqual(self.store.connection.execute('SELECT count(*) FROM outcomes').fetchone()[0],0)

    def test_conflicting_replay_and_terminal_reopen_are_refused(self):
        complete=self.outcome(state='processed')
        for changes in [{'operation_id':complete.operation_id,'state':'failed'},
                        {'expected_revision':1,'state':'failed'},
                        {'expected_revision':1,'state':'processed'}]:
            with self.assertRaises(FeedJournalError):self.outcome(**changes)
        self.assertEqual(inspect_feed_work(self.store)[0].processing_state,'processed')
        self.assertEqual(self.store.connection.execute('SELECT count(*) FROM outcomes').fetchone()[0],1)

    def test_retry_revision_cap_preserves_all_failed_attempts(self):
        for number in range(8):self.outcome(expected_revision=number,recorded_at=self.at+timedelta(seconds=number+1))
        with self.assertRaises(FeedJournalError):self.outcome(expected_revision=8)
        self.assertEqual(inspect_feed_work(self.store)[0].outcome_revision,8)
        self.assertEqual(self.store.connection.execute('SELECT count(*) FROM outcomes').fetchone()[0],8)

    def test_commit_failure_does_not_leave_a_partial_outcome_or_change_discovery(self):
        def authorizer(action, first, second, database, origin):
            return sqlite3.SQLITE_DENY if action==sqlite3.SQLITE_TRANSACTION and first=='COMMIT' else sqlite3.SQLITE_OK
        self.store.connection.set_authorizer(authorizer)
        with self.assertRaises(FeedJournalError):self.outcome()
        self.store.connection.set_authorizer(None)
        self.assertEqual(inspect_feed_work(self.store),self.items)
        self.assertEqual(self.store.cursor(),self.initial_cursor)
        self.assertEqual(self.store.connection.execute('SELECT count(*) FROM outcomes').fetchone()[0],0)

    def test_two_connections_cannot_append_two_outcomes_for_same_item_revision(self):
        barrier=threading.Barrier(2);outcomes=[]
        def compete():
            try:
                with InventedFeedJournal(self.directory) as store:
                    barrier.wait(timeout=5)
                    result=record_feed_outcome(store,operation_id=str(uuid4()),item_id=self.items[0].item_id,
                        expected_revision=0,state='failed',recorded_at=self.at+timedelta(seconds=1))
                    outcomes.append(result.revision)
            except FeedJournalError:outcomes.append('refused')
        threads=[threading.Thread(target=compete) for _ in range(2)]
        for t in threads:t.start()
        for t in threads:t.join(timeout=8)
        self.assertTrue(all(not t.is_alive() for t in threads))
        self.assertCountEqual(outcomes,[1,'refused'])
        self.assertEqual(inspect_feed_work(self.store)[0].outcome_revision,1)
        self.assertEqual(self.store.cursor(),self.initial_cursor)

    def test_corrupted_page_or_missing_occurrence_holds_queue_and_processing(self):
        for sql in ["UPDATE pages SET raw=x'626164'", "UPDATE pages SET operation_id='invalid'", "DELETE FROM items WHERE position=3",
                    "UPDATE items SET state='pending',held_reason=NULL WHERE position=2"]:
            c=self.store.connection;c.execute('BEGIN');c.execute(sql)
            # Retain this owned fixture mutation while testing the public API,
            # then restore it explicitly using transaction rollback.
            c.execute('ROLLBACK')
            # The API owns its own transaction, so use a separate saved copy.
            import shutil
            with tempfile.TemporaryDirectory(prefix='tf-invented-feed-integrity-') as name:
                target=Path(name);shutil.copy2(self.directory/'invented-feed.sqlite3',target/'invented-feed.sqlite3')
                with InventedFeedJournal(target) as changed:
                    changed.connection.execute(sql)
                    with self.assertRaises(FeedJournalError):inspect_feed_work(changed)
                    with self.assertRaises(FeedJournalError):
                        record_feed_outcome(changed,operation_id=str(uuid4()),item_id=self.items[0].item_id,
                            expected_revision=0,state='processed',recorded_at=self.at+timedelta(seconds=1))
                    self.assertEqual(changed.connection.execute('SELECT count(*) FROM outcomes').fetchone()[0],0)

    def test_outcome_revision_gap_terminal_reopen_or_backward_clock_hold_queue(self):
        self.outcome()
        c=self.store.connection
        for sql in ["UPDATE outcomes SET revision=2", "UPDATE outcomes SET recorded_at='2026-01-01T00:00:00.000000+00:00'",
                    "UPDATE outcomes SET recorded_at='2026-10-14T00:00:02'",
                    "INSERT INTO outcomes SELECT '40000000-0000-4000-8000-000000000001',item_id,2,'failed',recorded_at FROM outcomes"]:
            import shutil
            with tempfile.TemporaryDirectory(prefix='tf-invented-outcome-integrity-') as name:
                target=Path(name);shutil.copy2(self.directory/'invented-feed.sqlite3',target/'invented-feed.sqlite3')
                with InventedFeedJournal(target) as changed:
                    if sql.startswith('INSERT'):changed.connection.execute("UPDATE outcomes SET state='processed'")
                    changed.connection.execute(sql)
                    with self.assertRaises(FeedJournalError):inspect_feed_work(changed)

    def test_closed_adapter_always_returns_curated_refusal(self):
        self.store.close()
        for action in [self.store.cursor,lambda:self.store.inspect(self.capture_operation),
                       lambda:inspect_feed_work(self.store),lambda:self.outcome()]:
            with self.assertRaises(FeedJournalError):action()

    def test_unexpected_persistent_trigger_view_or_index_refuses_reopen(self):
        for sql in ["CREATE TRIGGER unexpected AFTER INSERT ON items BEGIN SELECT 1; END",
                    "CREATE VIEW unexpected AS SELECT * FROM scope",
                    "CREATE INDEX unexpected ON items(locator)"]:
            import shutil
            with tempfile.TemporaryDirectory(prefix='tf-invented-schema-integrity-') as name:
                target=Path(name);shutil.copy2(self.directory/'invented-feed.sqlite3',target/'invented-feed.sqlite3')
                c=sqlite3.connect(target/'invented-feed.sqlite3');c.execute(sql);c.close()
                before=(target/'invented-feed.sqlite3').read_bytes()
                with self.assertRaises(FeedJournalError):InventedFeedJournal(target)
                self.assertEqual(before,(target/'invented-feed.sqlite3').read_bytes())

if __name__=='__main__':unittest.main()
