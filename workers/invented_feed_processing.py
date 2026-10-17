"""Append-only invented processing outcomes, separate from feed traversal.

This records a rehearsal caller's outcome. It performs no extraction, model
call, factual validation, source approval or public write. Old retry receipts
are historical and can never reopen newer work or alter the traversal cursor.
"""

from dataclasses import dataclass
from datetime import datetime
import sqlite3

from workers.invented_feed_journal import FeedJournalError, InventedFeedJournal, _instant, _uuid


MAX_OUTCOMES_PER_ITEM = 8


@dataclass(frozen=True)
class InventedFeedWork:
    item_id: str
    source_version_id: str
    locator: str
    held_reason: str | None
    processing_state: str
    outcome_revision: int


@dataclass(frozen=True)
class InventedFeedOutcome:
    operation_id: str
    item_id: str
    revision: int
    state: str
    recorded_at: datetime
    replayed: bool
    evidence_state: str = 'isolated_invented_processing_record'


def _work(store):
    rows = store.connection.execute("""SELECT i.item_id,p.version_id,i.locator,i.held_reason,
        coalesce(e.state,i.state) AS state,coalesce(e.revision,0) AS revision
        FROM items i JOIN pages p ON p.page_id=i.page_id
        LEFT JOIN outcomes e ON e.item_id=i.item_id AND e.revision=(
            SELECT max(revision) FROM outcomes WHERE item_id=i.item_id)
        ORDER BY p.revision,i.position LIMIT 3201""").fetchall()
    if len(rows) > 3200:
        raise FeedJournalError('journal_queue_capacity_invalid')
    return tuple(InventedFeedWork(*r) for r in rows)


def inspect_feed_work(store: InventedFeedJournal):
    """One finite stored queue snapshot; no disappearance or completion claim."""
    try:
        store._ready()
        store._files()
        store.connection.execute('BEGIN')
        store._integrity()
        rows = _work(store)
        store._files()
        store.connection.execute('COMMIT')
        return rows
    except (OSError, sqlite3.Error, ValueError, TypeError):
        if store.connection is not None and store.connection.in_transaction:
            store.connection.execute('ROLLBACK')
        raise FeedJournalError('journal_queue_unavailable') from None


def record_feed_outcome(store: InventedFeedJournal, *, operation_id: str, item_id: str,
                        expected_revision: int, state: str, recorded_at: datetime):
    """CAS one work item's outcome; parsing holds and completed work stay closed.

    A failed outcome may be retried explicitly under the next item revision;
    exact replay returns its old result before checking the current revision.
    All events remain stored. There is no automatic retry or fetch action.
    """
    try:
        store._ready()
        at = _instant(recorded_at)
        if (not _uuid(operation_id) or not _uuid(item_id) or type(expected_revision) is not int
                or not 0 <= expected_revision < MAX_OUTCOMES_PER_ITEM or state not in ('failed','processed')):
            raise FeedJournalError('journal_outcome_input_invalid')
        store._files()
        c = store.connection
        c.execute('BEGIN IMMEDIATE')
        store._integrity()
        old = c.execute('SELECT * FROM outcomes WHERE operation_id=?', (operation_id,)).fetchone()
        if old is not None:
            if (old['item_id'],old['revision'],old['state']) != (item_id,expected_revision+1,state):
                raise FeedJournalError('journal_outcome_operation_conflict')
            result = InventedFeedOutcome(operation_id,item_id,old['revision'],state,
                datetime.fromisoformat(old['recorded_at']),True)
        else:
            item = c.execute('SELECT i.*,p.stored_at FROM items i JOIN pages p ON p.page_id=i.page_id WHERE i.item_id=?', (item_id,)).fetchone()
            last = c.execute('SELECT * FROM outcomes WHERE item_id=? ORDER BY revision DESC LIMIT 1', (item_id,)).fetchone()
            revision = 0 if last is None else last['revision']
            earliest = None if item is None else datetime.fromisoformat(item['stored_at'] if last is None else last['recorded_at'])
            if (item is None or item['state'] == 'parse_held' or revision != expected_revision
                    or (last is not None and last['state'] == 'processed') or recorded_at < earliest):
                raise FeedJournalError('journal_outcome_predecessor_conflict')
            c.execute('INSERT INTO outcomes VALUES(?,?,?,?,?)', (operation_id,item_id,revision+1,state,at))
            result = InventedFeedOutcome(operation_id,item_id,revision+1,state,recorded_at,False)
        store._integrity()
        store._files()
        c.execute('COMMIT')
        return result
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError):
        if store.connection is not None and store.connection.in_transaction:
            store.connection.execute('ROLLBACK')
        raise FeedJournalError('journal_outcome_unavailable_inspect_before_retry') from None
