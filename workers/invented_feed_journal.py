"""Opt-in, invented-input SQLite transaction rehearsal, never a live backend.

Only an explicitly supplied private directory is opened. This adapter selects
no operational store, source, rights, schedule or publication permission. It
reuses the feed parser and receipt guard; SQLite tests transaction/restart/CAS
behavior locally, not PostgreSQL/RLS or hostile same-user authentication.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
from re import fullmatch
import sqlite3
import stat
from urllib.parse import quote, urlsplit
from uuid import uuid4

from workers.feed_discovery import FeedReceipt, discover_feed_entries
from workers.public_source_url import public_https_source_url
from workers.feed_storage_progress import (
    FeedPageStoredReceipt, FeedItemStoredReceipt, plan_stored_feed_window,
)

MAX_PAGES = 64
MAX_DATABASE_BYTES = 8 * 1024 * 1024
APPLICATION_ID = 0x5446464A
NAME = 'invented-feed.sqlite3'
SCHEMA = (
    "CREATE TABLE scope (id INTEGER PRIMARY KEY CHECK(id=1), source_key TEXT NOT NULL, "
    "initial_url TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), "
    "next_url TEXT, state TEXT NOT NULL, retrieved_at TEXT)",
    "CREATE TABLE pages (operation_id TEXT PRIMARY KEY, version_id TEXT NOT NULL UNIQUE, "
    "page_id TEXT NOT NULL UNIQUE, batch_id TEXT NOT NULL, fingerprint TEXT NOT NULL, "
    "raw BLOB NOT NULL, source_json TEXT NOT NULL, format TEXT NOT NULL, stored_at TEXT NOT NULL, "
    "allowed_next_url TEXT, revision INTEGER NOT NULL UNIQUE, next_url TEXT, state TEXT NOT NULL)",
    "CREATE TABLE items (item_id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(page_id), "
    "position INTEGER NOT NULL CHECK(position>0), locator TEXT NOT NULL, entry_id TEXT, "
    "held_reason TEXT, state TEXT NOT NULL CHECK(state IN ('pending','parse_held')), "
    "UNIQUE(page_id,locator), UNIQUE(page_id,position))",
    "CREATE TABLE outcomes (operation_id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(item_id), "
    "revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 8), state TEXT NOT NULL CHECK(state IN ('failed','processed')), "
    "recorded_at TEXT NOT NULL, UNIQUE(item_id,revision))",
)


class FeedJournalError(ValueError):
    """Curated refusal; no path, source bytes or database error is returned."""


@dataclass(frozen=True)
class FeedJournalCursor:
    revision: int
    next_url: str | None
    state: str


@dataclass(frozen=True)
class FeedJournalCommit:
    page_receipt: FeedPageStoredReceipt
    item_receipts: tuple[FeedItemStoredReceipt, ...]
    cursor: FeedJournalCursor
    replayed: bool
    evidence_state: str = 'isolated_invented_sqlite_commit'


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def _instant(value):
    if (type(value) is not datetime or value.tzinfo is None
            or value.utcoffset() != timezone.utc.utcoffset(value)):
        raise FeedJournalError('journal_time_invalid')
    return value.isoformat(timespec='microseconds')


def _uuid(value):
    return type(value) is str and fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', value)


def _invented_url(value):
    return public_https_source_url(value) and urlsplit(value).hostname == 'example.org'


def _directory(directory):
    if not isinstance(directory, Path):
        raise FeedJournalError('journal_directory_invalid')
    if not directory.is_absolute() or '..' in directory.parts:
        raise FeedJournalError('journal_directory_invalid')
    for p in (directory, *directory.parents):
        if p.is_symlink():
            raise FeedJournalError('journal_directory_invalid')
    s = directory.stat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700:
        raise FeedJournalError('journal_directory_invalid')
    return s.st_dev, s.st_ino


class InventedFeedJournal:
    """One fixed invented stream. Creation is exclusive, reopening explicit.

    Every capture writes the observation, all item occurrences and cursor CAS
    together. Discovery is separate from processing: pending work and parser
    holds survive traversal. Advertised URLs alone never grant progression.
    A closed window does not assert complete source history. No raw deletion,
    takeover, automatic retry, source fetching or operational wiring exists.
    """

    def __init__(self, directory: Path, *, create=False, source_key=None, feed_url=None):
        self.directory = directory
        self.connection = None
        try:
            self.identity = _directory(directory)
            path = directory / NAME
            if type(create) is not bool:
                raise FeedJournalError('journal_configuration_invalid')
            if create:
                if (type(source_key) is not str or not source_key.startswith('fictional-')
                        or not fullmatch(r'[a-z0-9][a-z0-9:-]{0,119}', source_key)
                        or not _invented_url(feed_url) or set(directory.iterdir())):
                    raise FeedJournalError('journal_creation_refused')
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                os.close(fd)
            self._files()
            info = path.lstat()
            self.file_identity = (info.st_dev, info.st_ino)
            self.connection = sqlite3.connect('file:' + quote(str(path), safe='/') + '?mode=rw',
                uri=True, timeout=1.0, isolation_level=None)
            self.connection.row_factory = sqlite3.Row
            self.connection.execute('PRAGMA trusted_schema=OFF')
            if not create:
                self._schema()
            self.connection.execute('PRAGMA foreign_keys=ON')
            self.connection.execute('PRAGMA synchronous=FULL')
            self.connection.execute('PRAGMA journal_mode=DELETE')
            self.connection.execute('PRAGMA max_page_count=2048')
            self.connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 256 * 1024)
            if create:
                self.connection.execute('BEGIN IMMEDIATE')
                for statement in SCHEMA:
                    self.connection.execute(statement)
                self.connection.execute('INSERT INTO scope VALUES(1,?,?,0,?,\'ready\',NULL)',
                    (source_key, feed_url, feed_url))
                self.connection.execute(f'PRAGMA application_id={APPLICATION_ID}')
                self.connection.execute('PRAGMA user_version=1')
                self.connection.execute('COMMIT')
            self._schema()
            self._files()
        except (OSError, sqlite3.Error, ValueError, TypeError):
            self.close()
            raise FeedJournalError('journal_open_refused') from None

    def _files(self):
        if _directory(self.directory) != self.identity:
            raise FeedJournalError('journal_directory_changed')
        for path in self.directory.iterdir():
            s = path.lstat()
            if (path.name not in {NAME, NAME+'-journal'} or not stat.S_ISREG(s.st_mode)
                    or s.st_uid != os.getuid() or s.st_nlink != 1
                    or stat.S_IMODE(s.st_mode) != 0o600 or s.st_size > MAX_DATABASE_BYTES):
                raise FeedJournalError('journal_file_invalid')
        database = self.directory/NAME
        if hasattr(self, 'file_identity') and (database.stat().st_dev, database.stat().st_ino) != self.file_identity:
            raise FeedJournalError('journal_file_changed')
        if not database.is_file():
            raise FeedJournalError('journal_file_missing')

    def _schema(self):
        c = self.connection
        if (c.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID
                or c.execute('PRAGMA user_version').fetchone()[0] != 1
                or c.execute('PRAGMA page_size').fetchone()[0] != 4096
                or c.execute('PRAGMA quick_check').fetchall()[0][0] != 'ok'):
            raise FeedJournalError('journal_schema_invalid')
        actual = tuple(r[0] for r in c.execute("SELECT sql FROM sqlite_schema WHERE type='table' ORDER BY rowid"))
        if (c.execute("SELECT count(*) FROM sqlite_schema WHERE type NOT IN ('table','index') OR (type='index' AND sql IS NOT NULL)").fetchone()[0]
                or c.execute('PRAGMA foreign_key_check').fetchone() is not None):
            raise FeedJournalError('journal_schema_invalid')
        if (actual != SCHEMA or c.execute('SELECT count(*) FROM scope').fetchone()[0] != 1
                or c.execute('SELECT count(*) FROM pages').fetchone()[0] > MAX_PAGES):
            raise FeedJournalError('journal_schema_invalid')

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _ready(self):
        if self.connection is None:
            raise FeedJournalError('journal_closed')

    def _integrity(self):
        """Validate the complete finite capture and outcome chain in one transaction."""
        self._ready()
        self._schema()
        c = self.connection
        scope = c.execute('SELECT * FROM scope WHERE id=1').fetchone()
        if (type(scope['source_key']) is not str or not scope['source_key'].startswith('fictional-')
                or not _invented_url(scope['initial_url'])):
            raise FeedJournalError('journal_scope_invalid')
        pages = c.execute('SELECT operation_id,revision,source_json,stored_at FROM pages ORDER BY revision LIMIT 65').fetchall()
        if len(pages) > MAX_PAGES or scope['revision'] != len(pages):
            raise FeedJournalError('journal_cursor_invalid')
        cursor = FeedJournalCursor(0,scope['initial_url'],'ready')
        retrieved = None
        for index, page in enumerate(pages, 1):
            commit = self._read_commit(page['operation_id'], replayed=True)
            source = commit.page_receipt.source
            if (page['revision'] != index or cursor.state not in ('ready','next_ready')
                    or source.feed_url != cursor.next_url
                    or (retrieved is not None and source.retrieved_at < retrieved)):
                raise FeedJournalError('journal_page_chain_invalid')
            cursor, retrieved = commit.cursor, source.retrieved_at
        if (cursor != FeedJournalCursor(scope['revision'],scope['next_url'],scope['state'])
                or scope['retrieved_at'] != (None if retrieved is None else _instant(retrieved))):
            raise FeedJournalError('journal_cursor_invalid')
        items = {r['item_id']: r for r in c.execute('SELECT i.*,p.stored_at FROM items i JOIN pages p ON p.page_id=i.page_id LIMIT 3201')}
        if len(items) > 3200:
            raise FeedJournalError('journal_queue_capacity_invalid')
        last = {}
        events = c.execute('SELECT * FROM outcomes ORDER BY item_id,revision LIMIT 25601').fetchall()
        if len(events) > 25600:
            raise FeedJournalError('journal_outcome_capacity_invalid')
        for event in events:
            item = items.get(event['item_id'])
            previous = last.get(event['item_id'])
            revision = 0 if previous is None else previous['revision']
            at = datetime.fromisoformat(event['recorded_at'])
            if (item is None or item['state'] != 'pending' or not _uuid(event['operation_id'])
                    or type(event['revision']) is not int or event['revision'] != revision+1
                    or not 1 <= event['revision'] <= 8 or event['state'] not in ('failed','processed')
                    or (previous is not None and previous['state'] == 'processed')
                    or _instant(at) != event['recorded_at']
                    or at < datetime.fromisoformat(item['stored_at'] if previous is None else previous['recorded_at'])):
                raise FeedJournalError('journal_outcome_chain_invalid')
            last[event['item_id']] = event
        return cursor

    def cursor(self):
        try:
            self._ready()
            self._files()
            self.connection.execute('BEGIN')
            value = self._integrity()
            self._files()
            self.connection.execute('COMMIT')
            return value
        except (OSError, sqlite3.Error, ValueError, TypeError, KeyError):
            if self.connection is not None and self.connection.in_transaction:
                self.connection.execute('ROLLBACK')
            raise FeedJournalError('journal_read_unavailable') from None

    def _read_commit(self, operation_id, *, replayed):
        row = self.connection.execute('SELECT * FROM pages WHERE operation_id=?', (operation_id,)).fetchone()
        if row is None:
            raise FeedJournalError('journal_operation_missing')
        if not _uuid(row['operation_id']):
            raise FeedJournalError('journal_operation_invalid')
        source = json.loads(row['source_json'])
        source['retrieved_at'] = datetime.fromisoformat(source['retrieved_at'])
        source = FeedReceipt(**source)
        at = datetime.fromisoformat(row['stored_at'])
        page = discover_feed_entries(row['raw'], source, expected_format=row['format'])
        stored = FeedPageStoredReceipt(source, page.parser_identity, row['batch_id'], row['page_id'], at)
        items = tuple(FeedItemStoredReceipt(source.source_key, source.source_version_id, source.content_sha256,
            row['batch_id'], row['page_id'], i['item_id'], i['locator'], i['entry_id'], i['held_reason'], i['state'], at)
            for i in self.connection.execute('SELECT * FROM items WHERE page_id=? ORDER BY position LIMIT 51', (row['page_id'],)))
        proposal = plan_stored_feed_window(row['raw'], source, expected_format=row['format'], observed_at=at,
            page_receipt=stored, item_receipts=items, allowed_next_url=row['allowed_next_url'])
        source_json = _json({**asdict(source), 'retrieved_at': _instant(source.retrieved_at)})
        fingerprint = sha256(_json([source_json, row['format'], row['revision']-1, row['allowed_next_url']]).encode()).hexdigest()
        next_url = proposal.proposed_next_url
        state = 'window_boundary' if page.next_url is None else 'next_ready' if next_url else 'next_permission_unresolved'
        scope = self.connection.execute('SELECT * FROM scope WHERE id=1').fetchone()
        positions = [i['position'] for i in self.connection.execute('SELECT position FROM items WHERE page_id=? ORDER BY position LIMIT 51', (row['page_id'],))]
        if (proposal.state == 'held' or source.source_version_id != row['version_id']
                or not 1 <= row['revision'] <= MAX_PAGES or source.source_key != scope['source_key']
                or fingerprint != row['fingerprint'] or source_json != row['source_json']
                or (row['next_url'], row['state']) != (next_url, state)
                or positions != list(range(1, len(items)+1))
                or [int(i.locator.split(':')[1]) for i in items] != positions):
            raise FeedJournalError('journal_stored_binding_invalid')
        return FeedJournalCommit(stored, items,
            FeedJournalCursor(row['revision'], row['next_url'], row['state']), replayed)

    def inspect(self, operation_id):
        """Historical committed receipt only, never current rights or health."""
        try:
            self._ready()
            if not _uuid(operation_id):
                raise FeedJournalError('journal_operation_invalid')
            self._files()
            self.connection.execute('BEGIN')
            self._integrity()
            value = self._read_commit(operation_id, replayed=True)
            self._files()
            self.connection.execute('COMMIT')
            return value
        except (OSError, sqlite3.Error, ValueError, TypeError, KeyError):
            if self.connection is not None and self.connection.in_transaction:
                self.connection.execute('ROLLBACK')
            raise FeedJournalError('journal_inspection_unavailable') from None

    def capture(self, raw: bytes, source: FeedReceipt, *, expected_format: str,
                operation_id: str, expected_revision: int, stored_at: datetime,
                allowed_next_url: str | None = None):
        """Exact retry returns its original receipt before the current CAS gate.

        stored_at is a caller-supplied invented clock, not an authenticated
        origin/commit timestamp. Lost output requires explicit inspection;
        a storage exception cannot be interpreted as proof of rollback.
        """
        try:
            self._ready()
            page = discover_feed_entries(raw, source, expected_format=expected_format)
            if (not _uuid(operation_id) or type(expected_revision) is not int or expected_revision < 0
                    or not source.source_key.startswith('fictional-') or not _invented_url(source.feed_url)
                    or (page.next_url is not None and not _invented_url(page.next_url))
                    or (allowed_next_url is not None and allowed_next_url != page.next_url)):
                raise FeedJournalError('journal_input_invalid')
            at = _instant(stored_at)
            if stored_at < source.retrieved_at:
                raise FeedJournalError('journal_time_invalid')
            source_json = _json({**asdict(source), 'retrieved_at': _instant(source.retrieved_at)})
            fingerprint = sha256(_json([source_json, expected_format, expected_revision, allowed_next_url]).encode()).hexdigest()
            self._files()
            c = self.connection
            c.execute('BEGIN IMMEDIATE')
            self._integrity()
            old = c.execute('SELECT fingerprint FROM pages WHERE operation_id=?', (operation_id,)).fetchone()
            if old is not None:
                if old[0] != fingerprint:
                    raise FeedJournalError('journal_operation_conflict')
                result = self._read_commit(operation_id, replayed=True)
                self._files()
                c.execute('COMMIT')
                return result
            scope = c.execute('SELECT * FROM scope WHERE id=1').fetchone()
            if (scope['source_key'] != source.source_key or scope['revision'] != expected_revision
                    or scope['state'] not in ('ready', 'next_ready') or scope['next_url'] != source.feed_url
                    or (scope['retrieved_at'] is not None and datetime.fromisoformat(scope['retrieved_at']) > source.retrieved_at)):
                raise FeedJournalError('journal_predecessor_conflict')
            if c.execute('SELECT count(*) FROM pages').fetchone()[0] >= MAX_PAGES:
                raise FeedJournalError('journal_capacity_reached')
            page_id, batch_id = str(uuid4()), str(uuid4())
            next_url = page.next_url if allowed_next_url is not None else None
            state = 'window_boundary' if page.next_url is None else 'next_ready' if next_url else 'next_permission_unresolved'
            c.execute('INSERT INTO pages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (operation_id, source.source_version_id, page_id, batch_id, fingerprint, raw, source_json,
                 expected_format, at, allowed_next_url, expected_revision+1, next_url, state))
            candidates = [(int(i.locator.split(':')[1]), i.locator, i.entry_id, None, 'pending') for i in page.entries]
            candidates += [(h.entry_number, f'feed-entry:{h.entry_number}', h.entry_id, h.reason_code, 'parse_held') for h in page.held]
            for position, locator, entry_id, reason, status in sorted(candidates):
                c.execute('INSERT INTO items VALUES(?,?,?,?,?,?,?)',
                    (str(uuid4()), page_id, position, locator, entry_id, reason, status))
            changed = c.execute('UPDATE scope SET revision=revision+1,next_url=?,state=?,retrieved_at=? WHERE id=1 AND revision=?',
                (next_url, state, _instant(source.retrieved_at), expected_revision)).rowcount
            if changed != 1:
                raise FeedJournalError('journal_predecessor_conflict')
            # Validate real inserted rows before committing the complete group.
            result = self._read_commit(operation_id, replayed=False)
            self._integrity()
            self._files()
            c.execute('COMMIT')
            return result
        except (OSError, sqlite3.Error, ValueError, TypeError, KeyError):
            if self.connection is not None and self.connection.in_transaction:
                self.connection.execute('ROLLBACK')
            raise FeedJournalError('journal_capture_unavailable_inspect_before_retry') from None
