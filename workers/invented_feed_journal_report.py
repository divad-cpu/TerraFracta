"""Closed report of one isolated journal snapshot, never source health."""

from collections import Counter
import sqlite3

from workers.invented_feed_journal import FeedJournalError, InventedFeedJournal
from workers.invented_feed_processing import _work


def invented_feed_journal_report(store: InventedFeedJournal):
    """Traverse no URLs. A window boundary is never complete source history."""
    try:
        store._ready()
        store._files()
        c = store.connection
        c.execute('BEGIN')
        cursor = store._integrity()
        work = _work(store)
        operations = c.execute('SELECT operation_id FROM pages ORDER BY revision LIMIT 65').fetchall()
        if len(operations) > 64:
            raise FeedJournalError('journal_report_capacity_invalid')
        for operation in operations:
            store._read_commit(operation[0], replayed=True)
        counts = Counter(i.processing_state for i in work)
        if any(key not in ('pending','failed','processed','parse_held') for key in counts):
            raise FeedJournalError('journal_report_state_invalid')
        outcomes = c.execute('SELECT count(*) FROM outcomes').fetchone()[0]
        result = {
            'schema_version': 1, 'kind': 'isolated_invented_feed_journal_report',
            'evidence_state': 'local_sqlite_rehearsal_only',
            'pages_stored': len(operations), 'item_occurrences': len(work),
            'processing': {key: counts[key] for key in ('pending','failed','processed','parse_held')},
            'processing_outcomes_stored': outcomes,
            'traversal': {'revision': cursor.revision, 'state': cursor.state,
                          'next_url_assertion': cursor.next_url},
            'source_history_complete': False, 'source_requests': 0, 'model_calls': 0,
            'source_permission_issued': False, 'publication_enabled': False,
            'operational_backend_selected': False,
        }
        store._files()
        c.execute('COMMIT')
        return result
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError):
        if store.connection is not None and store.connection.in_transaction:
            store.connection.execute('ROLLBACK')
        raise FeedJournalError('journal_report_unavailable') from None
