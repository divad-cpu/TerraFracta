"""Closed invented PostgreSQL feed capture/readback contract; no connection.

The trusted local test custodian selects an independently identified fresh
PostgreSQL17 target. No target, credentials, SQL operation, source permission,
SSB checkpoint, model, public writer or operational backend is selected here.
SQL constrains structural storage; this port reparses exact committed bytes.
"""

from __future__ import annotations

import base64
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
from re import fullmatch

from workers.closed_pair_channel import _json as strict_json
from workers.pair_native_sql import _literal
from workers.feed_discovery import FeedReceipt, PARSER_IDENTITY, discover_feed_entries
from workers.feed_storage_progress import FeedPageStoredReceipt, FeedItemStoredReceipt, plan_stored_feed_window

MAX_CAPTURE_INPUT = 256 * 1024
MAX_CAPTURE_OUTPUT = 128 * 1024
MAX_CAPTURE_STATEMENT = 294912
COMMIT_MARKER = b'TF_INVENTED_FEED_COMMITTED'
HEAD = "set standard_conforming_strings=on;set statement_timeout='3s';set lock_timeout='1s';"
UUID_PATTERN = r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
URL_PATTERN = r'https://example\.org/feed\.xml(?:\?[a-zA-Z0-9=&%_-]{1,200})?'


class FeedPostgresContractError(ValueError):
    """Generic protocol refusal, not rollback or current-source attestation."""


def _uuid(value):
    return type(value) is str and fullmatch(UUID_PATTERN,value) is not None


def _utc(value):
    return type(value) is datetime and value.tzinfo is not None and value.utcoffset()==timezone.utc.utcoffset(value)


def _time(value):
    if not _utc(value):
        raise FeedPostgresContractError('invented_feed_time_invalid')
    return value.strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def _parse_time(value):
    if type(value) is not str or fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z',value) is None:
        raise FeedPostgresContractError('invented_feed_time_invalid')
    return datetime.fromisoformat(value)


@dataclass(frozen=True)
class InventedPgCapture:
    stream_id: str
    operation_id: str
    expected_revision: int
    source: FeedReceipt
    format: str
    allowed_next_url: str | None
    raw: bytes = field(repr=False)
    canonical_input: bytes = field(repr=False)

    def statement(self):
        """Only a fixed capture call; supplied text is a bounded SQL literal."""
        if type(self.canonical_input) is not bytes:raise FeedPostgresContractError('invented_feed_statement_input_invalid')
        checked=prepare_invented_pg_capture(self.raw,self.source,format=self.format,stream_id=self.stream_id,
            operation_id=self.operation_id,expected_revision=self.expected_revision,allowed_next_url=self.allowed_next_url)
        if checked!=self:
            raise FeedPostgresContractError('invented_feed_statement_input_invalid')
        statement=HEAD+'begin;select tf_feed_rehearsal.capture('+_literal(self.canonical_input.decode('utf8'))+'::jsonb);commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
        if len(statement.encode('utf8'))>MAX_CAPTURE_STATEMENT:
            raise FeedPostgresContractError('invented_feed_statement_limit')
        return statement


@dataclass(frozen=True)
class InventedPgCursor:
    revision: int
    next_url: str | None
    state: str


@dataclass(frozen=True)
class InventedPgReadback:
    page: FeedPageStoredReceipt
    items: tuple[FeedItemStoredReceipt,...]
    cursor: InventedPgCursor
    evidence_state: str = 'invented_postgres_commit_readback_only'


def prepare_invented_pg_capture(raw: bytes,source: FeedReceipt,*,format: str,
        stream_id: str,operation_id: str,expected_revision: int,allowed_next_url=None):
    """Trusted parser snapshot, not a free-form SQL/permission input channel."""
    try:
        page=discover_feed_entries(raw,source,expected_format=format)
        if (not _uuid(stream_id) or not _uuid(operation_id) or type(expected_revision) is not int
                or not 0<=expected_revision<64 or fullmatch(r'fictional-[a-z0-9:-]{1,109}',source.source_key) is None
                or fullmatch(URL_PATTERN,source.feed_url) is None
                or (page.next_url is not None and fullmatch(URL_PATTERN,page.next_url) is None)
                or (allowed_next_url is not None and allowed_next_url!=page.next_url)):
            raise ValueError
        items=[]
        for lead in page.entries:
            items.append({'position':int(lead.locator.split(':')[1]),'locator':lead.locator,'entry_id':lead.entry_id,
                'held_reason':None,'state':'pending','metadata':{key:getattr(lead,key) for key in ('title','url','published_text','updated_text')}})
        for held in page.held:
            items.append({'position':held.entry_number,'locator':f'feed-entry:{held.entry_number}',
                'entry_id':held.entry_id,'held_reason':held.reason_code,'state':'parse_held','metadata':None})
        payload={'schema_version':1,'kind':'invented_feed_pg_capture','stream_id':stream_id,'operation_id':operation_id,
            'expected_revision':expected_revision,'format':format,'parser_identity':PARSER_IDENTITY,
            'source':{**asdict(source),'retrieved_at':_time(source.retrieved_at)},
            'raw_base64':base64.b64encode(raw).decode('ascii'),'advertised_next_url':page.next_url,
            'allowed_next_url':allowed_next_url,'items':sorted(items,key=lambda i:i['position'])}
        encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf8')
        if len(encoded)>MAX_CAPTURE_INPUT:
            raise ValueError
        return InventedPgCapture(stream_id,operation_id,expected_revision,source,format,allowed_next_url,raw,encoded)
    except (ValueError,TypeError,AttributeError,UnicodeError):
        raise FeedPostgresContractError('invented_feed_capture_input_invalid') from None


def invented_pg_read_statement(expected: InventedPgCapture):
    expected.statement()  # Recheck the same closed context before selecting SQL.
    raw_base64=base64.b64encode(expected.raw).decode('ascii')
    return HEAD+"begin isolation level repeatable read read only;select tf_feed_rehearsal.page_receipt("+_literal(expected.operation_id)+"::uuid,decode("+_literal(raw_base64)+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+"\n"


def committed_pg_json(stdout: bytes,stderr: bytes,returncode: int):
    """Withhold SELECT output until COMMIT marker, EOF and clean reaped exit.

    The bounded native process custodian supplies these complete streams only
    after cleanup. Missing output or failure never establishes remote rollback.
    """
    try:
        if (type(stdout) is not bytes or type(stderr) is not bytes or type(returncode) is not int
                or returncode!=0 or stderr or not 1<=len(stdout)<=MAX_CAPTURE_OUTPUT
                or not stdout.endswith(b'\n'+COMMIT_MARKER+b'\n') or stdout.count(b'\n')!=2):
            raise ValueError
        record=stdout.split(b'\n',1)[0]
        value=strict_json(record)
        if type(value) is not dict:
            raise ValueError
        return record
    except (ValueError,UnicodeError,TypeError):
        raise FeedPostgresContractError('invented_feed_commit_unconfirmed_inspection_required') from None


def parse_invented_pg_readback(raw_receipt: bytes,expected: InventedPgCapture,*,observed_at: datetime):
    """Compare native stored rows with the original parser-bound input context."""
    try:
        if type(raw_receipt) is not bytes or not 1<=len(raw_receipt)<=MAX_CAPTURE_OUTPUT or type(expected) is not InventedPgCapture or type(expected.canonical_input) is not bytes or not _utc(observed_at):
            raise ValueError
        # Regenerate the trusted snapshot: a caller cannot construct a forged
        # dataclass with a different raw/format/input combination to skip parsing.
        checked=prepare_invented_pg_capture(expected.raw,expected.source,format=expected.format,
            stream_id=expected.stream_id,operation_id=expected.operation_id,expected_revision=expected.expected_revision,
            allowed_next_url=expected.allowed_next_url)
        if checked!=expected:
            raise ValueError
        value=strict_json(raw_receipt);keys={'schema_version','kind','operation_id','stream_id','page_id','batch_id',
            'source','format','parser_identity','stored_raw_matches_input','stored_raw_sha256','stored_raw_bytes','stored_at','allowed_next_url','cursor','items'}
        if (type(value) is not dict or set(value)!=keys or type(value['schema_version']) is not int or value['schema_version']!=1
                or value['kind']!='invented_feed_pg_page' or value['operation_id']!=expected.operation_id
                or value['stream_id']!=expected.stream_id or not _uuid(value['page_id']) or not _uuid(value['batch_id'])
                or value['source']!={**asdict(expected.source),'retrieved_at':_time(expected.source.retrieved_at)}
                or value['format']!=expected.format or value['parser_identity']!=PARSER_IDENTITY
                or value['stored_raw_matches_input'] is not True
                or value['stored_raw_sha256']!=expected.source.content_sha256
                or type(value['stored_raw_bytes']) is not int or value['stored_raw_bytes']!=len(expected.raw)
                or value['allowed_next_url']!=expected.allowed_next_url or type(value['items']) is not list or len(value['items'])>50):
            raise ValueError
        at=_parse_time(value['stored_at'])
        if not expected.source.retrieved_at<=at<=observed_at:
            raise ValueError
        original=strict_json(expected.canonical_input)['items'];items=[]
        if len(value['items'])!=len(original):
            raise ValueError
        for row,wanted in zip(value['items'],original,strict=True):
            if (type(row) is not dict or set(row)!=set(wanted)|{'item_id'} or not _uuid(row['item_id'])
                    or {key:row[key] for key in wanted}!=wanted or type(row['position']) is not int):
                raise ValueError
            items.append(FeedItemStoredReceipt(expected.source.source_key,expected.source.source_version_id,
                expected.source.content_sha256,value['batch_id'],value['page_id'],row['item_id'],row['locator'],row['entry_id'],
                row['held_reason'],row['state'],at))
        stored=FeedPageStoredReceipt(expected.source,PARSER_IDENTITY,value['batch_id'],value['page_id'],at)
        proposal=plan_stored_feed_window(expected.raw,expected.source,expected_format=expected.format,observed_at=observed_at,
            page_receipt=stored,item_receipts=tuple(items),allowed_next_url=expected.allowed_next_url)
        if proposal.state=='held':
            raise ValueError
        cursor=value['cursor']
        discovery=discover_feed_entries(expected.raw,expected.source,expected_format=expected.format)
        state='window_boundary' if discovery.next_url is None else 'next_permission_unresolved' if expected.allowed_next_url is None else 'next_ready'
        if (type(cursor) is not dict or set(cursor)!={'revision','next_url','state'} or type(cursor['revision']) is not int
                or cursor!={'revision':expected.expected_revision+1,'next_url':proposal.proposed_next_url,'state':state}):
            raise ValueError
        return InventedPgReadback(stored,tuple(items),InventedPgCursor(**cursor))
    except (ValueError,TypeError,UnicodeError,KeyError,AttributeError,OverflowError):
        raise FeedPostgresContractError('invented_feed_stored_readback_invalid') from None
