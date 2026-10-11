"""Compose existing exact SSB broker/parser with durable, confirmed dispatch.

No built-in fetcher, CLI, scheduler, storage or registration mutation. A trusted
caller supplies the fixed deadline-enforced broker and confirmed backend.
This is transport composition, not source approval or publication eligibility.
"""
from dataclasses import dataclass
from datetime import datetime,timezone,timedelta
from fractions import Fraction
import io
from math import isfinite
import time
from typing import Callable,Protocol
from workers.reserved_response_capture import DurableResponseBackend,ReservedCapture,capture_reserved_response
from workers.source_response_receipts import ResponseRequest,validate_response_request
from workers.ssb_14059_capture import (CapturedResponse,ParsedCapture,ParsedMetadataCapture,
 DATA_URL,METADATA_URL,MAX_RESPONSE_BYTES,parse_captured_ssb_14059,parse_captured_ssb_14059_metadata,
 require_bounded_pair_chronology,require_matching_metadata,_is_json_content_type)
from workers.ssb_14059_pair_transport import PAIR_DEADLINE_SECONDS

class AuthorityBoundBackend(DurableResponseBackend,Protocol):
    def authorized_opener(self,opener): ...

@dataclass(frozen=True)
class ReservedSSBResponse:
    kind:str
    capture:CapturedResponse
    receipt:ReservedCapture
    parsed:ParsedCapture|ParsedMetadataCapture
    request:ResponseRequest


class _SSBClock:
    def __init__(self, monotonic):
        self.monotonic=monotonic
        self.previous=None
        self.transport_deadline=None

    def tick(self):
        try:
            value=self.monotonic()
            valid=type(value) in (int,float) and isfinite(value)
        except Exception as exc:
            raise ValueError('SSB parent monotonic clock refused') from exc
        if not valid:raise ValueError('SSB parent monotonic clock refused')
        exact=Fraction(value)
        if self.previous is not None and exact<self.previous:
            raise ValueError('SSB parent monotonic clock moved backward')
        self.previous=exact
        return value

    def remaining(self, deadline, message):
        try:
            valid=type(deadline) in (int,float) and isfinite(deadline)
        except OverflowError as exc:
            raise ValueError(message) from exc
        if not valid:raise ValueError(message)
        remaining=Fraction(deadline)-Fraction(self.tick())
        if not 0<remaining<=PAIR_DEADLINE_SECONDS:raise ValueError(message)
        return float(remaining)


def _context(kind,expected,now):
    if type(kind) is not str or kind not in ('metadata','data'):raise ValueError('Unknown fixed SSB response kind')
    validate_response_request(expected,now)
    if expected.endpoint!= {'metadata':METADATA_URL,'data':DATA_URL}[kind] \
      or expected.max_body_bytes!=MAX_RESPONSE_BYTES:raise ValueError('Reserved SSB context differs from exact candidate request')


def capture_reserved_ssb_once(kind:str,expected:ResponseRequest,backend:AuthorityBoundBackend,
                             fixed_fetcher:Callable[...,CapturedResponse],*,pair_deadline:float,
                             utc_now=lambda:datetime.now(timezone.utc),monotonic=time.monotonic,
                             _clock=None)->ReservedSSBResponse|None:
    _context(kind,expected,utc_now())
    clock=_SSBClock(monotonic) if _clock is None else _clock
    clock.remaining(pair_deadline,'SSB response has no bounded parent deadline')
    saved=[]
    def opener(endpoint,seconds):
        if endpoint!=expected.endpoint:raise ValueError('SSB opener endpoint changed')
        opened_at=utc_now();origin=clock.tick()
        try:
            if type(seconds) not in (int,float) or not isfinite(seconds) or seconds<=0:
                raise ValueError
            deadline=min(pair_deadline,origin+seconds)
            exact_limit=min(Fraction(pair_deadline),Fraction(origin)+Fraction(seconds))
            if Fraction(deadline)>exact_limit:raise ValueError
        except (ValueError,OverflowError) as exc:
            raise ValueError('SSB opener has no bounded request deadline') from exc
        # A later dispatch may receive fresh authority, but cannot renew the
        # tighter transport interval already consumed by this shared pair.
        if clock.transport_deadline is not None:
            deadline=min(deadline,clock.transport_deadline)
        clock.remaining(deadline,'SSB parent deadline expired before broker')
        clock.transport_deadline=deadline
        capture=fixed_fetcher(kind,deadline=deadline)
        clock.remaining(deadline,'SSB broker returned after parent deadline')
        if not isinstance(capture,CapturedResponse) or capture.requested_url!=endpoint or capture.final_url!=endpoint \
          or type(capture.redirect_count) is not int or capture.redirect_count!=0 \
          or type(capture.status) is not int or capture.status!=200 or type(capture.content_type) is not str \
          or not _is_json_content_type(capture.content_type) or type(capture.body) is not bytes \
          or not 0<len(capture.body)<=expected.max_body_bytes or not isinstance(capture.retrieved_at,datetime) \
          or capture.retrieved_at.utcoffset()!=timedelta(0) or not opened_at<=capture.retrieved_at<=utc_now():
            raise ValueError('Fixed SSB broker returned an invalid transport capture')
        saved.append(capture);return io.BytesIO(capture.body)
    result=capture_reserved_response(expected,backend,backend.authorized_opener(opener),utc_now=utc_now,monotonic=clock.tick)
    if result is None:return None
    clock.remaining(pair_deadline,'SSB result arrived after shared parent deadline')
    assert len(saved)==1 and saved[0].body==result.body
    parsed=(parse_captured_ssb_14059_metadata if kind=='metadata' else parse_captured_ssb_14059)(saved[0])
    clock.remaining(pair_deadline,'SSB parsing completed after shared parent deadline')
    return ReservedSSBResponse(kind,saved[0],result,parsed,expected)


def capture_reserved_ssb_pair(metadata:ResponseRequest,data:ResponseRequest,
                             backend_factory:Callable[[ResponseRequest],AuthorityBoundBackend],
                             fixed_fetcher:Callable[...,CapturedResponse],*,
                             utc_now=lambda:datetime.now(timezone.utc),monotonic=time.monotonic):
    """One shared ten-second deadline; no automatic retry or replayed half-pair.

    Both exact contexts must be admitted together. If either dispatch already
    exists, hold the pair rather than refetching or accepting an incomplete
    result. Successful measured capture alone never declares source coverage.
    """
    _context('metadata',metadata,utc_now());_context('data',data,utc_now())
    if metadata.invocation!=data.invocation or metadata.work!=data.work \
      or metadata.registration_id==data.registration_id or metadata.request_key==data.request_key \
      or metadata.invocation.limits.max_response_bytes<2*(MAX_RESPONSE_BYTES+1) \
      or metadata.invocation.limits.max_items*(metadata.invocation.limits.max_retries+1)<2:
        raise ValueError('SSB pair requires distinct approved contexts and one adequate admitted budget')
    clock=_SSBClock(monotonic)
    started=clock.tick()
    try:
        deadline=started+PAIR_DEADLINE_SECONDS
        valid=isfinite(deadline) and Fraction(deadline)==Fraction(started)+PAIR_DEADLINE_SECONDS
    except OverflowError as exc:
        raise ValueError('SSB pair has no bounded parent deadline') from exc
    if not valid:raise ValueError('SSB pair has no bounded parent deadline')
    first=capture_reserved_ssb_once('metadata',metadata,backend_factory(metadata),fixed_fetcher,
      pair_deadline=deadline,utc_now=utc_now,monotonic=monotonic,_clock=clock)
    if first is None:raise ValueError('SSB metadata dispatch already exists; pair held without refetch')
    clock.remaining(deadline,'SSB parent deadline expired before data reservation')
    second=capture_reserved_ssb_once('data',data,backend_factory(data),fixed_fetcher,
      pair_deadline=deadline,utc_now=utc_now,monotonic=monotonic,_clock=clock)
    if second is None:raise ValueError('SSB data dispatch already exists; pair held without refetch')
    require_bounded_pair_chronology(second.parsed,first.parsed)
    require_matching_metadata(second.parsed,first.parsed)
    clock.remaining(deadline,'SSB pair reconciliation completed after shared parent deadline')
    return first,second
