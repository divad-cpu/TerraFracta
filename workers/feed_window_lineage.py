"""Closed invented next-window transaction contract, never a poll permission.

Owner-seeded collection and exact native predecessor are independently supplied.
Only a first-page capture committed with the head CAS counts as collection.
Original pending/failed occurrences remain independent across every window.
"""
from dataclasses import dataclass, field
from datetime import datetime
import base64
import json
from re import fullmatch

from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import (
    InventedPgCapture, InventedPgReadback, HEAD, COMMIT_MARKER, MAX_CAPTURE_INPUT,
    MAX_CAPTURE_OUTPUT, MAX_CAPTURE_STATEMENT, URL_PATTERN, _uuid, _utc, _parse_time,
    parse_invented_pg_readback,
)
from workers.pair_native_sql import _literal

MAX_WINDOWS = 32


class FeedWindowLineageError(ValueError): pass


@dataclass(frozen=True)
class InventedCollectionScope:
    collection_id: str
    source_key: str
    initial_url: str
    format: str


@dataclass(frozen=True)
class InventedCollectionHead:
    scope: InventedCollectionScope
    window_revision: int
    stream_id: str
    page: InventedPgReadback
    window_recorded_at: datetime
    evidence_state: str = 'invented_collection_current_head_only'


@dataclass(frozen=True)
class InventedWindowAdvance:
    scope: InventedCollectionScope
    previous_capture: InventedPgCapture = field(repr=False)
    previous_head: bytes = field(repr=False)
    first_capture: InventedPgCapture = field(repr=False)
    observed_at: datetime
    canonical_input: bytes = field(repr=False)

    def statement(self):
        if type(self.canonical_input) is not bytes:raise FeedWindowLineageError('invented_window_context_invalid')
        checked = prepare_invented_window_advance(self.scope,self.previous_capture,self.previous_head,
            self.first_capture,observed_at=self.observed_at)
        if checked != self: raise FeedWindowLineageError('invented_window_context_invalid')
        statement = HEAD+"set time zone 'UTC';begin;select tf_feed_windows.advance("+_literal(self.canonical_input.decode())+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(statement.encode()) > MAX_CAPTURE_STATEMENT:
            raise FeedWindowLineageError('invented_window_statement_limit')
        return statement


@dataclass(frozen=True)
class InventedWindowStarted:
    scope: InventedCollectionScope
    operation_id: str
    window_revision: int
    previous_stream_id: str
    previous_page_id: str
    stream_id: str
    page: InventedPgReadback
    recorded_at: datetime
    evidence_state: str = 'invented_historical_window_start_only'


def _scope(scope):
    if (type(scope) is not InventedCollectionScope or not _uuid(scope.collection_id)
            or type(scope.source_key) is not str or fullmatch(r'fictional-[a-z0-9:-]{1,109}',scope.source_key) is None
            or type(scope.initial_url) is not str or fullmatch(URL_PATTERN,scope.initial_url) is None
            or type(scope.format) is not str or scope.format not in ('rss20','atom10')):
        raise ValueError


def _canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


def invented_collection_head_statement(scope, previous_capture):
    try:
        _scope(scope)
        if type(previous_capture) is not InventedPgCapture: raise ValueError
        previous_capture.statement()
        if previous_capture.source.source_key != scope.source_key or previous_capture.format != scope.format: raise ValueError
        raw = base64.b64encode(previous_capture.raw).decode('ascii')
        return HEAD+"begin isolation level repeatable read read only;select tf_feed_windows.head("+_literal(scope.collection_id)+"::uuid,decode("+_literal(raw)+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
    except (ValueError,TypeError,AttributeError,UnicodeError):
        raise FeedWindowLineageError('invented_collection_read_scope_invalid') from None


def parse_invented_collection_head(raw,scope,previous_capture,*,observed_at):
    try:
        invented_collection_head_statement(scope,previous_capture)
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at): raise ValueError
        value = strict_json(raw)
        if (type(value) is not dict or set(value)!={'schema_version','kind','collection_id','source_key','initial_url','format',
                'window_revision','stream_id','latest_page_id','latest_stream_revision','window_recorded_at','page'}
                or type(value['schema_version']) is not int or value['schema_version']!=1
                or value['kind']!='invented_collection_head' or value['collection_id']!=scope.collection_id
                or value['source_key']!=scope.source_key or value['initial_url']!=scope.initial_url or value['format']!=scope.format
                or type(value['window_revision']) is not int or not 1<=value['window_revision']<=MAX_WINDOWS
                or value['stream_id']!=previous_capture.stream_id or not _uuid(value['latest_page_id'])
                or type(value['latest_stream_revision']) is not int): raise ValueError
        page = parse_invented_pg_readback(_canonical(value['page']),previous_capture,observed_at=observed_at)
        if value['latest_page_id']!=page.page.page_record_id or value['latest_stream_revision']!=page.cursor.revision: raise ValueError
        recorded_at=_parse_time(value['window_recorded_at'])
        if recorded_at>observed_at:raise ValueError
        return InventedCollectionHead(scope,value['window_revision'],value['stream_id'],page,recorded_at)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise FeedWindowLineageError('invented_collection_head_unavailable') from None


def prepare_invented_window_advance(scope,previous_capture,previous_head,first_capture,*,observed_at):
    try:
        head = parse_invented_collection_head(previous_head,scope,previous_capture,observed_at=observed_at)
        if head.window_revision>=MAX_WINDOWS or head.page.cursor.state!='window_boundary' or head.page.cursor.next_url is not None:
            raise ValueError
        if type(first_capture) is not InventedPgCapture: raise ValueError
        first_capture.statement()
        if (first_capture.expected_revision!=0 or first_capture.stream_id==head.stream_id
                or first_capture.source.source_key!=scope.source_key or first_capture.source.feed_url!=scope.initial_url
                or first_capture.format!=scope.format or first_capture.source.retrieved_at<previous_capture.source.retrieved_at
                or first_capture.source.retrieved_at>observed_at
                or first_capture.source.source_version_id==previous_capture.source.source_version_id): raise ValueError
        payload={'collection_id':scope.collection_id,'expected_window_revision':head.window_revision,
            'previous_stream_id':head.stream_id,'previous_page_id':head.page.page.page_record_id,
            'capture':strict_json(first_capture.canonical_input)}
        encoded = _canonical(payload)
        if len(encoded)>MAX_CAPTURE_INPUT: raise ValueError
        return InventedWindowAdvance(scope,previous_capture,previous_head,first_capture,observed_at,encoded)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise FeedWindowLineageError('invented_window_advance_unavailable') from None


def invented_window_receipt_statement(expected):
    if type(expected) is not InventedWindowAdvance: raise FeedWindowLineageError('invented_window_context_invalid')
    expected.statement()
    raw = base64.b64encode(expected.first_capture.raw).decode('ascii')
    return HEAD+"begin isolation level repeatable read read only;select tf_feed_windows.receipt("+_literal(expected.first_capture.operation_id)+"::uuid,decode("+_literal(raw)+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def parse_invented_window_started(raw,expected,*,observed_at):
    try:
        invented_window_receipt_statement(expected)
        if not _utc(observed_at) or observed_at<expected.observed_at or type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT: raise ValueError
        p = strict_json(expected.canonical_input);value = strict_json(raw)
        if (type(value) is not dict or set(value)!={'schema_version','kind','collection_id','operation_id','window_revision',
                'previous_stream_id','previous_page_id','stream_id','page_id','recorded_at','input','page'}
                or type(value['schema_version']) is not int or value['schema_version']!=1
                or value['kind']!='invented_collection_window_started'
                or value['collection_id']!=expected.scope.collection_id or value['operation_id']!=expected.first_capture.operation_id
                or type(value['window_revision']) is not int or value['window_revision']!=p['expected_window_revision']+1
                or value['previous_stream_id']!=p['previous_stream_id'] or value['previous_page_id']!=p['previous_page_id']
                or value['stream_id']!=expected.first_capture.stream_id
                or _canonical(value['input'])!=_canonical({k:v for k,v in p.items() if k!='capture'})): raise ValueError
        page = parse_invented_pg_readback(_canonical(value['page']),expected.first_capture,observed_at=observed_at)
        at = _parse_time(value['recorded_at'])
        previous=parse_invented_collection_head(expected.previous_head,expected.scope,expected.previous_capture,observed_at=observed_at)
        if (value['page_id']!=page.page.page_record_id or not max(previous.page.page.stored_at,previous.window_recorded_at)<=page.page.stored_at<=at<=observed_at): raise ValueError
        return InventedWindowStarted(expected.scope,value['operation_id'],value['window_revision'],value['previous_stream_id'],
            value['previous_page_id'],value['stream_id'],page,at)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise FeedWindowLineageError('invented_window_started_unavailable') from None
