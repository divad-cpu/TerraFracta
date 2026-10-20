"""Reopen invented retained feed bytes from a checked inventory occurrence.

No fetch, permission renewal, queue claim or processing-state assertion. Original
page readback and current history/CAS remain separate required steps.
"""
from __future__ import annotations
import base64
from dataclasses import dataclass,field,asdict
from datetime import datetime
import json
from workers.feed_collection_inventory import InventoryRequest,InventoryItem,InventoryCut,InventoryCursor,parse_collection_inventory_page
from workers.feed_postgres_contract import (InventedPgCapture,InventedPgReadback,HEAD,COMMIT_MARKER,
    MAX_CAPTURE_OUTPUT,_uuid,_utc,_time,_parse_time,prepare_invented_pg_capture,parse_invented_pg_readback)
from workers.feed_discovery import FeedReceipt,MAX_FEED_BYTES,PARSER_IDENTITY
from workers.closed_pair_channel import _json as strict_json
from workers.pair_native_sql import _literal
from workers.dispatch_input_snapshot import freeze_input,thaw_input
from workers.feed_window_lineage import InventedCollectionScope
from workers.feed_postgres_processing import InventedPgOutcomeReceipt

class FeedReopenError(ValueError):pass

def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()

@dataclass(frozen=True)
class ReopenRequest:
    inventory_request: InventoryRequest
    inventory_raw: bytes=field(repr=False)
    inventory_observed_at: datetime
    item_id: str
    canonical_input: bytes=field(repr=False)

    def statement(self):
        try:
            expected, = _snapshot_reopen_inputs(self)
        except Exception:
            raise FeedReopenError('reopen_request_binding_invalid') from None
        if type(expected.canonical_input) is not bytes:raise FeedReopenError('reopen_request_binding_invalid')
        checked=prepare_capture_reopen(expected.inventory_request,expected.inventory_raw,observed_at=expected.inventory_observed_at,item_id=expected.item_id)
        if checked!=expected:raise FeedReopenError('reopen_request_binding_invalid')
        statement=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_feed_reopen.original("+_literal(checked.canonical_input.decode())+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(statement.encode())>8192:raise FeedReopenError('reopen_statement_limit')
        return statement

@dataclass(frozen=True)
class ReopenedCapture:
    request: ReopenRequest
    raw_response: bytes=field(repr=False)
    observed_at: datetime
    capture: InventedPgCapture
    item: InventoryItem
    evidence_state: str='invented_original_reopened_page_readback_and_current_history_still_required'


_REOPEN_INPUT_RECORDS = (ReopenRequest, ReopenedCapture, InventoryRequest, InventoryItem,
    InventoryCut, InventoryCursor, InventedCollectionScope, InventedPgCapture,
    FeedReceipt, InventedPgOutcomeReceipt)


def _snapshot_reopen_inputs(*values):
    return thaw_input(freeze_input(values, _REOPEN_INPUT_RECORDS))


def _selected(request,raw,at,item_id):
    if not _uuid(item_id):raise ValueError
    page=parse_collection_inventory_page(raw,request,observed_at=at)
    return next(row for row in page.rows if row.item_id==item_id)


def prepare_capture_reopen(inventory_request,inventory_raw,*,observed_at,item_id):
    try:
        try:
            inventory_request, inventory_raw, observed_at, item_id = _snapshot_reopen_inputs(
                inventory_request, inventory_raw, observed_at, item_id)
        except Exception:
            raise FeedReopenError('reopen_input_invalid') from None
        item=_selected(inventory_request,inventory_raw,observed_at,item_id)
        value={'scope':asdict(inventory_request.scope),'window_revision':item.position.window_revision,
            'page_revision':item.position.page_revision,'item_position':item.position.item_position,
            'stream_id':item.stream_id,'page_id':item.page_id,'capture_operation_id':item.capture_operation_id,'item_id':item_id}
        body=_canonical(value)
        if len(body)>4096:raise ValueError
        return ReopenRequest(inventory_request,inventory_raw,observed_at,item_id,body)
    except (ValueError,TypeError,AttributeError,StopIteration,UnicodeError,KeyError,OverflowError):
        raise FeedReopenError('reopen_input_invalid') from None


def parse_reopened_capture(raw,expected,*,observed_at):
    try:
        try:
            raw, expected, observed_at = _snapshot_reopen_inputs(raw, expected, observed_at)
        except Exception:
            raise FeedReopenError('reopen_observation_unavailable') from None
        if type(expected) is not ReopenRequest or type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at):raise ValueError
        expected.statement();item=_selected(expected.inventory_request,expected.inventory_raw,expected.inventory_observed_at,expected.item_id)
        value=strict_json(raw)
        if (type(value) is not dict or set(value)!={'schema_version','kind','request','raw_base64','source','format','parser_identity','allowed_next_url','expected_revision','stored_at','observed_at'}
            or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_feed_reopened_original'
            or _canonical(value['request'])!=expected.canonical_input or value['format']!=expected.inventory_request.scope.format
            or value['parser_identity']!=PARSER_IDENTITY or type(value['expected_revision']) is not int
            or value['expected_revision']!=item.position.page_revision-1
            or type(value['raw_base64']) is not str or not 4<=len(value['raw_base64'])<=4*((MAX_FEED_BYTES+2)//3)):raise ValueError
        original=base64.b64decode(value['raw_base64'],validate=True)
        if not 1<=len(original)<=MAX_FEED_BYTES or base64.b64encode(original).decode()!=value['raw_base64']:raise ValueError
        at=_parse_time(value['observed_at']);stored=_parse_time(value['stored_at'])
        if stored!=item.page_stored_at or not max(stored,expected.inventory_observed_at)<=at<=observed_at:raise ValueError
        source=FeedReceipt(expected.inventory_request.scope.source_key,item.source_version_id,item.feed_url,item.source_sha256,item.source_retrieved_at)
        if value['source']!={**asdict(source),'retrieved_at':_time(source.retrieved_at)}:raise ValueError
        capture=prepare_invented_pg_capture(original,source,format=value['format'],stream_id=item.stream_id,
            operation_id=item.capture_operation_id,expected_revision=value['expected_revision'],allowed_next_url=value['allowed_next_url'])
        # Matching source hash alone cannot bind an occurrence locator/identity.
        selected=next(row for row in strict_json(capture.canonical_input)['items'] if row['position']==item.position.item_position)
        if (selected['locator'],selected['entry_id'],selected['held_reason'])!=(item.locator,item.entry_id,item.held_reason):raise ValueError
        return ReopenedCapture(expected,raw,observed_at,capture,item)
    except (ValueError,TypeError,AttributeError,StopIteration,UnicodeError,KeyError,OverflowError):
        raise FeedReopenError('reopen_observation_unavailable') from None


def confirm_reopened_page(raw_receipt,reopened,*,observed_at):
    """Bind complete stored page/items using the existing original-byte parser."""
    try:
        try:
            raw_receipt, reopened, observed_at = _snapshot_reopen_inputs(raw_receipt, reopened, observed_at)
        except Exception:
            raise FeedReopenError('reopen_page_unavailable') from None
        if type(reopened) is not ReopenedCapture:raise ValueError
        checked=parse_reopened_capture(reopened.raw_response,reopened.request,observed_at=reopened.observed_at)
        if checked!=reopened or not _utc(observed_at) or observed_at<reopened.observed_at:raise ValueError
        page=parse_invented_pg_readback(raw_receipt,reopened.capture,observed_at=observed_at)
        wanted=reopened.item
        selected=next(item for item in page.items if item.item_state_record_id==wanted.item_id)
        if (page.page.page_record_id!=wanted.page_id or page.page.stored_at!=wanted.page_stored_at
            or (selected.locator,selected.entry_id,selected.held_reason)!=(wanted.locator,wanted.entry_id,wanted.held_reason)):raise ValueError
        return page
    except (ValueError,TypeError,AttributeError,StopIteration,UnicodeError,KeyError,OverflowError):
        raise FeedReopenError('reopen_page_unavailable') from None
