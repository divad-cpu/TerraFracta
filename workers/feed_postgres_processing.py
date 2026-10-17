"""Closed invented item-outcome and coherent history protocol; no connection.

The trusted fresh-target custodian must obtain native committed capture/history
rows. Supplied JSON alone is not storage authentication or a production queue.
No claim extraction, source approval, factual acceptance or publication occurs.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import base64
import json
from re import fullmatch

from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import (
    COMMIT_MARKER,HEAD,MAX_CAPTURE_OUTPUT,FeedPostgresContractError,InventedPgCapture,
    _uuid,_utc,parse_invented_pg_readback,
)
from workers.pair_native_sql import _literal


class FeedPostgresProcessingError(ValueError):pass


@dataclass(frozen=True)
class InventedPgOutcome:
    operation_id: str
    item_id: str
    expected_revision: int
    state: str
    capture: InventedPgCapture = field(repr=False)
    capture_receipt: bytes = field(repr=False)
    capture_observed_at: datetime

    def statement(self):
        checked=prepare_invented_pg_outcome(self.capture,self.capture_receipt,observed_at=self.capture_observed_at,
            item_id=self.item_id,operation_id=self.operation_id,expected_revision=self.expected_revision,state=self.state)
        if checked!=self:raise FeedPostgresProcessingError('invented_feed_outcome_context_invalid')
        return HEAD+"set time zone 'UTC';begin;select tf_feed_rehearsal.record_outcome("+_literal(self.operation_id)+"::uuid,"+_literal(self.item_id)+f"::uuid,{self.expected_revision},"+_literal(self.state)+");commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


@dataclass(frozen=True)
class InventedPgOutcomeReceipt:
    operation_id: str
    item_id: str
    revision: int
    state: str
    recorded_at: datetime


@dataclass(frozen=True)
class InventedPgItemHistory:
    item_id: str
    state: str
    revision: int
    held_reason: str | None
    outcomes: tuple[InventedPgOutcomeReceipt,...]
    evidence_state: str = 'invented_postgres_item_history_only'


def _capture_item(capture,raw,at,item_id):
    page=parse_invented_pg_readback(raw,capture,observed_at=at)
    if not _uuid(item_id):raise ValueError
    matches=[item for item in page.items if item.item_state_record_id==item_id]
    if len(matches)!=1:raise ValueError
    return page,matches[0]


def prepare_invented_pg_outcome(capture,capture_receipt,*,observed_at,item_id,operation_id,expected_revision,state):
    try:
        _,item=_capture_item(capture,capture_receipt,observed_at,item_id)
        if (item.processing_state!='pending' or not _uuid(operation_id) or type(expected_revision) is not int
                or not 0<=expected_revision<8 or type(state) is not str or state not in ('failed','processed')):
            raise ValueError
        return InventedPgOutcome(operation_id,item_id,expected_revision,state,capture,capture_receipt,observed_at)
    except (ValueError,TypeError,AttributeError,KeyError):
        raise FeedPostgresProcessingError('invented_feed_outcome_input_invalid') from None


def _event(row,*,item_id,page_time,observed_at):
    if (type(row) is not dict or set(row)!={'operation_id','item_id','revision','state','recorded_at'}
            or not _uuid(row['operation_id']) or row['item_id']!=item_id or type(row['revision']) is not int
            or not 1<=row['revision']<=8 or type(row['state']) is not str or row['state'] not in ('failed','processed')
            or type(row['recorded_at']) is not str or fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?\+00:00',row['recorded_at']) is None):
        raise ValueError
    at=datetime.fromisoformat(row['recorded_at'])
    if not page_time<=at<=observed_at:raise ValueError
    return InventedPgOutcomeReceipt(row['operation_id'],row['item_id'],row['revision'],row['state'],at)


def parse_invented_pg_outcome(raw,request,*,observed_at):
    """A committed outcome ack is not proof that it remains the latest state."""
    try:
        if type(request) is not InventedPgOutcome or not _utc(observed_at):raise ValueError
        request.statement()
        if observed_at<request.capture_observed_at or type(raw) is not bytes or not 1<=len(raw)<=2048:raise ValueError
        page,_=_capture_item(request.capture,request.capture_receipt,observed_at,request.item_id)
        event=_event(strict_json(raw),item_id=request.item_id,page_time=page.page.stored_at,observed_at=observed_at)
        if (event.operation_id,event.revision,event.state)!=(request.operation_id,request.expected_revision+1,request.state):raise ValueError
        return event
    except (ValueError,TypeError,AttributeError,KeyError,OverflowError):
        raise FeedPostgresProcessingError('invented_feed_outcome_readback_invalid') from None


def invented_pg_item_history_statement(capture,item_id):
    """One coherent read-only snapshot; native bytes are compared in PostgreSQL."""
    if type(capture) is not InventedPgCapture or not _uuid(item_id):
        raise FeedPostgresProcessingError('invented_feed_history_input_invalid')
    capture.statement()
    raw=base64.b64encode(capture.raw).decode('ascii')
    return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select jsonb_build_object('item_id',"+_literal(item_id)+",'page',tf_feed_rehearsal.page_receipt("+_literal(capture.operation_id)+"::uuid,decode("+_literal(raw)+",'base64')),'outcomes',coalesce((select jsonb_agg(to_jsonb(o) order by o.revision) from tf_feed_rehearsal.outcomes o where o.item_id="+_literal(item_id)+"::uuid),'[]'::jsonb));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def parse_invented_pg_item_history(raw,capture,*,item_id,observed_at):
    """Reparse original capture and validate every ordered processing event."""
    try:
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at):raise ValueError
        value=strict_json(raw)
        if type(value) is not dict or set(value)!={'item_id','page','outcomes'} or value['item_id']!=item_id:
            raise ValueError
        page,item=_capture_item(capture,json.dumps(value['page'],separators=(',',':'),ensure_ascii=False).encode('utf8'),observed_at,item_id)
        rows=value['outcomes']
        if type(rows) is not list or len(rows)>8:raise ValueError
        events=[];operations=set();previous_time=page.page.stored_at
        for revision,row in enumerate(rows,1):
            event=_event(row,item_id=item_id,page_time=previous_time,observed_at=observed_at)
            if (item.processing_state!='pending' or event.revision!=revision or event.operation_id in operations
                    or (events and events[-1].state=='processed')):raise ValueError
            operations.add(event.operation_id);events.append(event);previous_time=event.recorded_at
        return InventedPgItemHistory(item_id,events[-1].state if events else item.processing_state,len(events),item.held_reason,tuple(events))
    except (ValueError,TypeError,AttributeError,KeyError,OverflowError):
        raise FeedPostgresProcessingError('invented_feed_history_readback_invalid') from None
