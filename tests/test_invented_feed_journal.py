"""Real isolated SQLite transactions, without a service or primary database."""

from dataclasses import replace
from datetime import timedelta
import os
from pathlib import Path
import sqlite3
import tempfile
import subprocess
import sys
import threading
import unittest
from uuid import uuid4

from tests.test_feed_discovery import entry, receipt, rss
from workers.feed_discovery import FeedReceipt
from workers.invented_feed_journal import (
    FeedJournalError, InventedFeedJournal, NAME, MAX_PAGES,
)


NEXT = 'https://example.org/feed.xml?page=2'
LINK = f'<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="{NEXT}"/>'


class InventedFeedJournalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='tf-invented-feed-journal-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.store = InventedFeedJournal(self.directory, create=True,
            source_key='fictional-feed', feed_url='https://example.org/feed.xml')
        self.addCleanup(self.store.close)
        self.raw = rss(entry() + entry('bad', 'http://127.0.0.1/private') + entry('other'), LINK)
        self.source = receipt(self.raw)
        self.operation = str(uuid4())
        self.at = self.source.retrieved_at + timedelta(seconds=1)

    def capture(self, **changes):
        args = dict(expected_format='rss20', operation_id=self.operation,
            expected_revision=0, stored_at=self.at, allowed_next_url=NEXT)
        args.update(changes)
        return self.store.capture(self.raw, self.source, **args)

    def counts(self):
        return tuple(self.store.connection.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
            for table in ('pages', 'items'))

    def test_atomic_page_all_occurrences_and_cursor_survive_close_and_reopen(self):
        result = self.capture()
        self.assertFalse(result.replayed)
        self.assertEqual(result.evidence_state, 'isolated_invented_sqlite_commit')
        self.assertEqual(result.cursor.revision, 1)
        self.assertEqual((result.cursor.next_url, result.cursor.state), (NEXT, 'next_ready'))
        self.assertEqual([i.locator for i in result.item_receipts], ['feed-entry:1','feed-entry:2','feed-entry:3'])
        self.assertEqual([i.processing_state for i in result.item_receipts], ['pending','parse_held','pending'])
        self.assertEqual(result.item_receipts[1].held_reason, 'entry_link_invalid_or_ambiguous')
        self.store.close()
        self.store = InventedFeedJournal(self.directory)
        self.addCleanup(self.store.close)
        reopened = self.store.inspect(self.operation)
        self.assertEqual(replace(result, replayed=True), reopened)
        self.assertEqual(self.store.cursor(), result.cursor)
        self.assertEqual(self.counts(), (1,3))
        stored = self.store.connection.execute('SELECT raw FROM pages').fetchone()[0]
        self.assertEqual(stored, self.raw)
        self.assertEqual(os.stat(self.directory/NAME).st_mode & 0o777, 0o600)

    def test_exact_retry_returns_original_receipt_without_advancing_or_retimestamping(self):
        first = self.capture()
        again = self.capture(stored_at=self.at+timedelta(hours=1))
        self.assertEqual(replace(first, replayed=True), again)
        self.assertEqual(self.counts(), (1,3))
        self.assertEqual(self.store.cursor().revision, 1)

    def test_conflicting_key_version_scope_or_predecessor_cannot_replace_evidence(self):
        first = self.capture()
        for kwargs in [{'allowed_next_url': None}, {'expected_revision': 1},
                       {'operation_id': str(uuid4())}, {'operation_id':str(uuid4()), 'expected_revision':True}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(FeedJournalError):
                self.capture(**kwargs)
        self.assertEqual(self.store.inspect(self.operation), replace(first, replayed=True))
        self.assertEqual(self.counts(), (1,3))

    def test_rolloff_and_processing_pending_remain_separate_from_traversal(self):
        first = self.capture()
        raw = rss(entry('new'))
        source = receipt(raw, source_version_id=str(uuid4()), feed_url=NEXT,
            retrieved_at=self.source.retrieved_at+timedelta(seconds=2))
        second = self.store.capture(raw, source, expected_format='rss20', operation_id=str(uuid4()),
            expected_revision=1, stored_at=self.at+timedelta(seconds=2))
        self.assertEqual(second.cursor.state, 'window_boundary')
        self.assertIsNone(second.cursor.next_url)
        self.assertEqual(self.counts(), (2,4))
        self.assertEqual(self.store.inspect(self.operation), replace(first, replayed=True))
        self.assertEqual(self.store.connection.execute("SELECT count(*) FROM items WHERE state='pending'").fetchone()[0], 3)

    def test_missing_permission_commits_work_but_has_no_traversal_address(self):
        result = self.capture(allowed_next_url=None)
        self.assertEqual(result.cursor.state, 'next_permission_unresolved')
        self.assertIsNone(result.cursor.next_url)
        self.assertEqual(self.counts(), (1,3))
        with self.assertRaises(FeedJournalError):
            self.capture(operation_id=str(uuid4()), expected_revision=1)

    def test_conflicting_permission_refuses_before_writes(self):
        for url in ['https://example.org/foreign', 'http://127.0.0.1/private']:
            with self.assertRaises(FeedJournalError):
                self.capture(allowed_next_url=url)
        self.assertEqual(self.counts(), (0,0))
        self.assertEqual(self.store.cursor().revision, 0)

    def test_invalid_input_and_clock_never_mint_empty_success(self):
        for changes in [{'expected_revision':-1}, {'expected_revision':False}, {'operation_id':'bad'},
                        {'stored_at':self.source.retrieved_at-timedelta(seconds=1)},
                        {'stored_at':self.at.replace(tzinfo=None)}, {'expected_format':'unknown'}]:
            with self.subTest(changes=changes), self.assertRaises(FeedJournalError):
                self.capture(**changes)
        for source in [replace(self.source, source_key='actual-source'),
                       replace(self.source, feed_url='https://foreign.example/feed.xml'),
                       replace(self.source, content_sha256='a'*64)]:
            with self.assertRaises(FeedJournalError):
                self.store.capture(self.raw, source, expected_format='rss20', operation_id=self.operation,
                    expected_revision=0, stored_at=self.at, allowed_next_url=NEXT)
        self.assertEqual(self.counts(), (0,0))

    def test_real_constraint_faults_after_partial_inserts_roll_back_whole_capture(self):
        for trigger in [
            "CREATE TEMP TRIGGER fault BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT,'fault'); END",
            "CREATE TEMP TRIGGER fault BEFORE INSERT ON items WHEN NEW.position=2 BEGIN SELECT RAISE(ABORT,'fault'); END",
            "CREATE TEMP TRIGGER fault BEFORE UPDATE ON scope BEGIN SELECT RAISE(ABORT,'fault'); END",
        ]:
            with self.subTest(trigger=trigger):
                self.store.connection.execute(trigger)
                with self.assertRaisesRegex(FeedJournalError, '^journal_capture_unavailable_inspect_before_retry$'):
                    self.capture()
                self.assertEqual(self.counts(), (0,0))
                self.assertEqual(self.store.cursor().revision, 0)
                self.store.connection.execute('DROP TRIGGER fault')
        self.assertEqual(self.capture().cursor.revision, 1)

    def test_two_independent_connections_with_same_predecessor_commit_precisely_once(self):
        barrier = threading.Barrier(2)
        outcomes = []
        def compete(number):
            try:
                with InventedFeedJournal(self.directory) as store:
                    barrier.wait(timeout=5)
                    result = store.capture(self.raw, replace(self.source, source_version_id=str(uuid4())),
                        expected_format='rss20', operation_id=str(uuid4()), expected_revision=0,
                        stored_at=self.at, allowed_next_url=NEXT)
                    outcomes.append(result.cursor.revision)
            except FeedJournalError:
                outcomes.append('refused')
        threads = [threading.Thread(target=compete, args=(n,)) for n in range(2)]
        for t in threads:t.start()
        for t in threads:t.join(timeout=8)
        self.assertTrue(all(not t.is_alive() for t in threads))
        self.assertCountEqual(outcomes, [1,'refused'])
        self.assertEqual(self.counts(), (1,3))

    def test_empty_window_records_an_observation_without_history_completeness(self):
        raw = rss()
        result = self.store.capture(raw, receipt(raw), expected_format='rss20', operation_id=self.operation,
            expected_revision=0, stored_at=self.at)
        self.assertEqual(result.item_receipts, ())
        self.assertEqual(result.cursor.state, 'window_boundary')
        self.assertNotIn('complete', result.cursor.state)
        self.assertEqual(self.counts(), (1,0))

    def test_symlink_permissions_foreign_schema_and_exclusive_creation_refuse(self):
        with self.assertRaises(FeedJournalError):
            InventedFeedJournal(self.directory, create=True, source_key='fictional-feed', feed_url='https://example.org/feed.xml')
        self.store.close()
        path = self.directory/NAME
        path.chmod(0o644)
        with self.assertRaises(FeedJournalError):InventedFeedJournal(self.directory)
        path.chmod(0o600)
        moved = self.directory/'original'
        path.rename(moved);path.symlink_to(moved)
        with self.assertRaises(FeedJournalError):InventedFeedJournal(self.directory)
        path.unlink();moved.rename(path)
        connection = sqlite3.connect(path)
        connection.execute('PRAGMA user_version=2');connection.close()
        before = path.read_bytes()
        with self.assertRaises(FeedJournalError):InventedFeedJournal(self.directory)
        self.assertEqual(before, path.read_bytes())

    def test_atom_window_uses_the_same_actual_store_and_reopens(self):
        raw = b'<feed xmlns="http://www.w3.org/2005/Atom"><title>Invented</title><id>urn:invented:feed</id><updated>2026-10-14T00:00:00Z</updated><entry><id>urn:invented:one</id><title>Invented notice</title><link href="https://example.org/one"/><updated>2026-10-14T00:00:00Z</updated></entry></feed>'
        result = self.store.capture(raw, receipt(raw), expected_format='atom10', operation_id=self.operation,
            expected_revision=0, stored_at=self.at)
        self.assertEqual(result.item_receipts[0].entry_id, 'urn:invented:one')
        self.assertEqual(result.cursor.state, 'window_boundary')
        self.assertEqual(self.store.inspect(self.operation), replace(result, replayed=True))

    def test_commit_denial_rolls_back_page_items_and_cursor(self):
        def deny_commit(action, first, second, database, origin):
            return sqlite3.SQLITE_DENY if action == sqlite3.SQLITE_TRANSACTION and first == 'COMMIT' else sqlite3.SQLITE_OK
        self.store.connection.set_authorizer(deny_commit)
        with self.assertRaises(FeedJournalError):self.capture()
        self.store.connection.set_authorizer(None)
        self.assertEqual(self.counts(), (0,0))
        self.assertEqual(self.store.cursor().revision, 0)

    def test_committed_output_lost_with_child_exit_is_found_by_explicit_inspection(self):
        self.store.close()
        program = """
import os,sys
from pathlib import Path
from tests.test_feed_discovery import receipt,rss,entry
from datetime import timedelta
from workers.invented_feed_journal import InventedFeedJournal
raw=rss(entry());source=receipt(raw)
with InventedFeedJournal(Path(sys.argv[1])) as store:
    store.capture(raw,source,expected_format='rss20',operation_id=sys.argv[2],expected_revision=0,stored_at=source.retrieved_at+timedelta(seconds=1))
    os._exit(23)
"""
        child = subprocess.run([sys.executable, '-B', '-c', program, str(self.directory), self.operation],
            capture_output=True, timeout=10)
        self.assertEqual((child.returncode,child.stdout,child.stderr),(23,b'',b''))
        self.store = InventedFeedJournal(self.directory)
        self.addCleanup(self.store.close)
        found = self.store.inspect(self.operation)
        self.assertTrue(found.replayed)
        self.assertEqual(found.cursor.revision,1)
        self.assertEqual(self.counts(),(1,1))
        again = self.store.capture(rss(entry()),receipt(rss(entry())),expected_format='rss20',
            operation_id=self.operation,expected_revision=0,stored_at=self.at+timedelta(hours=1))
        self.assertEqual(found,again)
        self.assertEqual(self.counts(),(1,1))

    def test_capacity_refuses_next_window_without_losing_previous_pages(self):
        url = 'https://example.org/feed.xml'
        raw = rss(entry(), '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="'+url+'"/>')
        for number in range(MAX_PAGES):
            source = receipt(raw, source_version_id=str(uuid4()),
                retrieved_at=self.source.retrieved_at+timedelta(seconds=number))
            self.store.capture(raw,source,expected_format='rss20',operation_id=str(uuid4()),
                expected_revision=number,stored_at=self.at+timedelta(seconds=number),allowed_next_url=url)
        source = receipt(raw,source_version_id=str(uuid4()),retrieved_at=self.source.retrieved_at+timedelta(seconds=MAX_PAGES))
        with self.assertRaises(FeedJournalError):
            self.store.capture(raw,source,expected_format='rss20',operation_id=str(uuid4()),
                expected_revision=MAX_PAGES,stored_at=self.at+timedelta(seconds=MAX_PAGES),allowed_next_url=url)
        self.assertEqual(self.counts(),(64,64))
        self.assertEqual(self.store.cursor().revision,64)

    def test_corrupted_locator_state_cursor_or_stored_bytes_cannot_emit_valid_receipts(self):
        self.capture()
        c = self.store.connection
        for statement in ["UPDATE pages SET next_url='https://example.org/foreign'",
                          "UPDATE pages SET version_id='10000000-0000-4000-8000-000000000099'",
                          "UPDATE items SET position=position+10",
                          "UPDATE pages SET raw=x'626164'",
                          "DELETE FROM items WHERE position=2"]:
            c.execute('BEGIN');c.execute(statement);c.execute('COMMIT')
            with self.assertRaises(FeedJournalError):self.store.inspect(self.operation)
            # Restore only the owned test database from the known initial test input.
            self.store.close()
            for f in self.directory.iterdir():f.unlink()
            self.store = InventedFeedJournal(self.directory,create=True,
                source_key='fictional-feed',feed_url='https://example.org/feed.xml')
            self.addCleanup(self.store.close);self.capture();c=self.store.connection
        c.execute("UPDATE scope SET next_url='https://example.org/foreign'")
        with self.assertRaises(FeedJournalError):self.store.cursor()


if __name__ == '__main__':
    unittest.main()
