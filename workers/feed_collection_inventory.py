"""Bounded read-only rediscovery, not a claim/lease or processing authority.

A fixed captured structural prefix can be enumerated across pages; outcome
state is coherent per native observation, not one multi-page global snapshot.
Every later action still needs exact original bytes/source binding and live CAS.
"""
from dataclasses import asdict,dataclass
from datetime import datetime
import json
from re import fullmatch
from workers.closed_pair_channel import _json as strict_json
from workers.feed_discovery import PARSER_IDENTITY,_plain as _feed_plain
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,MAX_CAPTURE_OUTPUT,_uuid,_utc,_time,_parse_time,URL_PATTERN
from workers.feed_postgres_processing import InventedPgOutcomeReceipt,_event
from workers.feed_window_lineage import InventedCollectionScope,_scope,MAX_WINDOWS
from workers.pair_native_sql import _literal
from workers.dispatch_input_snapshot import freeze_input,thaw_input

MAX_INVENTORY_ITEMS=20
MAX_INVENTORY_INPUT=4096
MAX_INVENTORY_STATEMENT=8192
HELD_REASONS=frozenset({'entry_identity_invalid','entry_identity_duplicate','entry_title_invalid',
    'entry_link_invalid_or_ambiguous','entry_date_text_invalid'})


class FeedInventoryError(ValueError):pass


@dataclass(frozen=True)
class InventoryCut:
    window_revision: int
    stream_id: str
    stream_revision: int
    page_id: str
    page_stored_at: datetime
    window_recorded_at: datetime


@dataclass(frozen=True,order=True)
class InventoryCursor:
    window_revision: int
    page_revision: int
    item_position: int


@dataclass(frozen=True)
class InventoryRequest:
    scope: InventedCollectionScope
    item_limit: int
    cut: InventoryCut | None
    after: InventoryCursor | None
    canonical_input: bytes

    def statement(self):
        try:
            expected, = _snapshot_inventory_inputs(self)
        except Exception:
            raise FeedInventoryError('inventory_request_binding_invalid') from None
        if type(expected.canonical_input) is not bytes:raise FeedInventoryError('inventory_request_binding_invalid')
        checked=prepare_inventory_request(expected.scope,item_limit=expected.item_limit,cut=expected.cut,after=expected.after)
        if checked!=expected:raise FeedInventoryError('inventory_request_binding_invalid')
        statement=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_feed_inventory.page("+_literal(checked.canonical_input.decode())+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(statement.encode())>MAX_INVENTORY_STATEMENT:raise FeedInventoryError('inventory_statement_limit')
        return statement


@dataclass(frozen=True)
class InventoryItem:
    position: InventoryCursor
    stream_id: str
    page_id: str
    capture_operation_id: str
    item_id: str
    source_version_id: str
    source_sha256: str
    feed_url: str
    page_stored_at: datetime
    source_retrieved_at: datetime
    locator: str
    entry_id: str | None
    held_reason: str | None
    processing_state: str
    outcomes: tuple[InventedPgOutcomeReceipt,...]

    @property
    def outcome_revision(self):return len(self.outcomes)


@dataclass(frozen=True)
class CollectionInventoryPage:
    scope: InventedCollectionScope
    cut: InventoryCut
    rows: tuple[InventoryItem,...]
    next_cursor: InventoryCursor | None
    observed_at: datetime
    evidence_state: str = 'invented_captured_prefix_current_states_per_page_only'


_INVENTORY_INPUT_RECORDS = (InventoryRequest, InventoryCut, InventoryCursor, InventedCollectionScope)


def _snapshot_inventory_inputs(*values):
    return thaw_input(freeze_input(values, _INVENTORY_INPUT_RECORDS))


def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def _integer(value,maximum):return type(value) is int and 1<=value<=maximum

def _cut(value):
    if (type(value) is not InventoryCut or not _integer(value.window_revision,MAX_WINDOWS)
            or not _integer(value.stream_revision,64) or not _uuid(value.stream_id) or not _uuid(value.page_id)
            or not _utc(value.page_stored_at) or not _utc(value.window_recorded_at)):raise ValueError
    return {**asdict(value),'page_stored_at':_time(value.page_stored_at),'window_recorded_at':_time(value.window_recorded_at)}


def _cursor(value,cut):
    if (type(value) is not InventoryCursor or not _integer(value.window_revision,cut.window_revision)
            or not _integer(value.page_revision,64) or not _integer(value.item_position,50)
            or (value.window_revision==cut.window_revision and value.page_revision>cut.stream_revision)):raise ValueError
    return asdict(value)


def prepare_inventory_request(scope,*,item_limit=MAX_INVENTORY_ITEMS,cut=None,after=None):
    try:
        try:
            scope, item_limit, cut, after = _snapshot_inventory_inputs(scope, item_limit, cut, after)
        except Exception:
            raise FeedInventoryError('inventory_request_unavailable') from None
        _scope(scope)
        if not _integer(item_limit,MAX_INVENTORY_ITEMS) or (cut is None and after is not None):raise ValueError
        payload={'scope':asdict(scope),'item_limit':item_limit,'cut':None if cut is None else _cut(cut),
            'after':None if after is None else _cursor(after,cut)}
        body=_canonical(payload)
        if len(body)>MAX_INVENTORY_INPUT:raise ValueError
        return InventoryRequest(scope,item_limit,cut,after,body)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise FeedInventoryError('inventory_request_unavailable') from None


def _parse_cut(value):
    if type(value) is not dict or set(value)!={'window_revision','stream_id','stream_revision','page_id','page_stored_at','window_recorded_at'}:raise ValueError
    cut=InventoryCut(value['window_revision'],value['stream_id'],value['stream_revision'],value['page_id'],
        _parse_time(value['page_stored_at']),_parse_time(value['window_recorded_at']))
    _cut(cut);return cut


def _parse_cursor(value,cut):
    if type(value) is not dict or set(value)!={'window_revision','page_revision','item_position'}:raise ValueError
    result=InventoryCursor(value['window_revision'],value['page_revision'],value['item_position']);_cursor(result,cut);return result


def _text(value,maximum):
    if not _feed_plain(value,maximum):return False
    try:value.encode('utf8');return True
    except UnicodeError:return False


def _item(row,scope,cut,observed_at):
    if type(row) is not dict or set(row)!={'window_revision','page_revision','position','stream_id','page_id','capture_operation_id',
        'item_id','source_version_id','source_sha256','feed_url','page_stored_at','source_retrieved_at','format','parser_identity',
        'locator','entry_id','held_reason','base_state','outcomes'}:raise ValueError
    position=InventoryCursor(row['window_revision'],row['page_revision'],row['position']);_cursor(position,cut)
    if (any(not _uuid(row[key]) for key in ('stream_id','page_id','capture_operation_id','item_id','source_version_id'))
            or type(row['source_sha256']) is not str or fullmatch('[a-f0-9]{64}',row['source_sha256']) is None
            or type(row['feed_url']) is not str or fullmatch(URL_PATTERN,row['feed_url']) is None
            or row['format']!=scope.format or row['parser_identity']!=PARSER_IDENTITY
            or row['locator']!='feed-entry:'+str(row['position'])
            or (position.page_revision==1 and row['feed_url']!=scope.initial_url)
            or (position.window_revision==cut.window_revision and row['stream_id']!=cut.stream_id)
            or (position.window_revision==cut.window_revision and position.page_revision==cut.stream_revision and row['page_id']!=cut.page_id)):
        raise ValueError
    stored=_parse_time(row['page_stored_at']);retrieved=_parse_time(row['source_retrieved_at'])
    if not retrieved<=stored<=observed_at or (position.window_revision==cut.window_revision and position.page_revision==cut.stream_revision and stored!=cut.page_stored_at):raise ValueError
    if row['entry_id'] is not None and not _text(row['entry_id'],300):raise ValueError
    if row['base_state']=='pending':
        if row['entry_id'] is None or row['held_reason'] is not None:raise ValueError
    elif row['base_state']=='parse_held':
        if row['held_reason'] not in HELD_REASONS or (row['held_reason']=='entry_identity_invalid' and row['entry_id'] is not None):raise ValueError
    else:raise ValueError
    if type(row['outcomes']) is not list or len(row['outcomes'])>8:raise ValueError
    events=[];operations=set();previous_time=stored
    for revision,value in enumerate(row['outcomes'],1):
        event=_event(value,item_id=row['item_id'],page_time=previous_time,observed_at=observed_at)
        if row['base_state']!='pending' or event.revision!=revision or event.operation_id in operations or (events and events[-1].state=='processed'):raise ValueError
        events.append(event);operations.add(event.operation_id);previous_time=event.recorded_at
    return InventoryItem(position,row['stream_id'],row['page_id'],row['capture_operation_id'],row['item_id'],
        row['source_version_id'],row['source_sha256'],row['feed_url'],stored,retrieved,row['locator'],row['entry_id'],
        row['held_reason'],events[-1].state if events else row['base_state'],tuple(events))


def parse_collection_inventory_page(raw,expected,*,observed_at):
    try:
        try:
            raw, expected, observed_at = _snapshot_inventory_inputs(raw, expected, observed_at)
        except Exception:
            raise FeedInventoryError('inventory_observation_unavailable') from None
        if type(expected) is not InventoryRequest:raise ValueError
        expected.statement()
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at):raise ValueError
        value=strict_json(raw)
        if (type(value) is not dict or set(value)!={'schema_version','kind','request','cut','rows','has_more','next_cursor','observed_at'}
                or type(value['schema_version']) is not int or value['schema_version']!=1
                or value['kind']!='invented_collection_inventory_page'
                or _canonical(value['request'])!=expected.canonical_input or type(value['rows']) is not list
                or len(value['rows'])>expected.item_limit or type(value['has_more']) is not bool):raise ValueError
        cut=_parse_cut(value['cut']);at=_parse_time(value['observed_at'])
        if (expected.cut is not None and _canonical(_cut(cut))!=_canonical(_cut(expected.cut))) or not max(cut.page_stored_at,cut.window_recorded_at)<=at<=observed_at:raise ValueError
        rows=tuple(_item(row,expected.scope,cut,at) for row in value['rows'])
        previous=expected.after;ids=set();operations=set();pages={};streams={cut.window_revision:cut.stream_id}
        page_keys={cut.page_id:(cut.window_revision,cut.stream_revision)};capture_keys={};stream_windows={cut.stream_id:cut.window_revision}
        for row in rows:
            if previous is not None and row.position<=previous:raise ValueError
            if row.item_id in ids or any(event.operation_id in operations for event in row.outcomes):raise ValueError
            ids.add(row.item_id);operations.update(event.operation_id for event in row.outcomes);previous=row.position
            key=(row.position.window_revision,row.position.page_revision)
            if (row.page_id in page_keys and page_keys[row.page_id]!=key) or (row.capture_operation_id in capture_keys and capture_keys[row.capture_operation_id]!=key) or (row.stream_id in stream_windows and stream_windows[row.stream_id]!=row.position.window_revision):raise ValueError
            page_keys[row.page_id]=key;capture_keys[row.capture_operation_id]=key;stream_windows[row.stream_id]=row.position.window_revision
            facts=(row.stream_id,row.page_id,row.capture_operation_id,row.source_version_id,row.source_sha256,row.feed_url,row.page_stored_at,row.source_retrieved_at)
            if (key in pages and pages[key]!=facts) or (row.position.window_revision in streams and streams[row.position.window_revision]!=row.stream_id):raise ValueError
            pages[key]=facts;streams[row.position.window_revision]=row.stream_id
        if value['has_more']:
            cursor=_parse_cursor(value['next_cursor'],cut)
            if len(rows)!=expected.item_limit or cursor!=rows[-1].position:raise ValueError
        else:
            if value['next_cursor'] is not None:raise ValueError
            cursor=None
        return CollectionInventoryPage(expected.scope,cut,rows,cursor,at)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise FeedInventoryError('inventory_observation_unavailable') from None
