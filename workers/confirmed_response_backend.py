"""Fixed-execution adapter plus post-COMMIT authority and bounded stream wrapper.

No database client, credential creation or network transport. Only a trusted
implementation may supply commit/confirm operations. Direct arbitrary SQL is
outside this boundary. Each instance serves one trusted response context.
"""
from datetime import datetime,timezone
from fractions import Fraction
from math import isfinite
import time
from typing import BinaryIO,Callable,Protocol
from workers.reserved_response_capture import DurableResponseBackend
from workers.response_authority import ResponseAuthority,parse_response_authority
from workers.source_response_receipts import (ResponseRequest,ResponseReservation,
 parse_response_reservation,parse_response_dispatch)

def _clock_tick(monotonic, previous=None):
    value=monotonic()
    try:
        valid=type(value) in (int,float) and isfinite(value)
    except OverflowError:
        valid=False
    if not valid or (previous is not None and value<previous):
        raise ValueError('Confirmed response clock is invalid or moved backwards')
    return value

class AuthorityConfirmer(Protocol):
    def confirm(self,phase:str,receipt:bytes)->bytes: ...

class ConfirmedResponseBackend:
    def __init__(self,expected:ResponseRequest,principal:str,backend:DurableResponseBackend,
                 confirmer:AuthorityConfirmer,*,utc_now:Callable[[],datetime]=lambda:datetime.now(timezone.utc),
                 monotonic:Callable[[],float]=time.monotonic):
        self.expected=expected;self.principal=principal;self.backend=backend;self.confirmer=confirmer
        self.utc_now=utc_now;self.monotonic=monotonic;self.authority:ResponseAuthority|None=None

    def _context(self,expected):
        self.authority=None
        if expected!=self.expected:raise ValueError('Confirmed adapter has another trusted response context')

    def _confirm(self,phase,receipt,reservation):
        authority=parse_response_authority(self.confirmer.confirm(phase,receipt),self.expected,
          phase=phase,principal=self.principal,reservation_id=reservation.reservation_id,receipt=receipt,now=self.utc_now())
        self.authority=authority
        return receipt

    def reserve(self,expected):
        self._context(expected)
        receipt=self.backend.reserve(expected)
        reservation=parse_response_reservation(receipt,expected,now=self.utc_now())
        return self._confirm('reserve',receipt,reservation)

    def dispatch(self,expected,reservation):
        self._context(expected)
        receipt=self.backend.dispatch(expected,reservation)
        parse_response_dispatch(receipt,expected,reservation,now=self.utc_now())
        return self._confirm('dispatch',receipt,reservation)

    def settle(self,expected,reservation,*,outcome,body_bytes,content_sha256):
        self._context(expected)
        # Independent driver validates settlement against its measured body and
        # accepted dispatch before return. Confirmation checks exact saved state.
        receipt=self.backend.settle(expected,reservation,outcome=outcome,body_bytes=body_bytes,content_sha256=content_sha256)
        return self._confirm('settle',receipt,reservation)

    def authorized_opener(self,opener:Callable[[str,int],BinaryIO]):
        def guarded(endpoint,seconds):
            authority=self.authority
            if authority is None or authority.phase!='dispatch' or endpoint!=self.expected.endpoint \
              or type(seconds) is not int or seconds<1:raise ValueError('No confirmed dispatch authority')
            residual=min(seconds,authority.remaining_seconds(self.utc_now()))
            if residual<1:raise ValueError('Confirmed dispatch authority expired before opening')
            started=_clock_tick(self.monotonic)
            try:
                approximate_deadline=started+residual
                valid_interval=isfinite(approximate_deadline) and approximate_deadline>started
            except OverflowError:
                valid_interval=False
            if not valid_interval:
                raise ValueError('Confirmed response clock cannot represent its authority duration')
            deadline=Fraction(started)+residual
            stream=opener(endpoint,residual)
            return AuthorizedResponseStream(stream,authority,deadline,self.utc_now,self.monotonic,started)
        return guarded

class AuthorizedResponseStream:
    def __init__(self,stream,authority,deadline,utc_now,monotonic,started):
        self.stream=stream;self.authority=authority;self.deadline=deadline
        self.utc_now=utc_now;self.monotonic=monotonic;self.previous_tick=started

    def _check(self):
        tick=_clock_tick(self.monotonic,self.previous_tick)
        if self.authority.remaining_seconds(self.utc_now())<1 or Fraction(tick)>=self.deadline:
            raise ValueError('Confirmed response authority expired during reading')
        self.previous_tick=tick

    def read(self,size):
        self._check();body=self.stream.read(size);self._check();return body

    def close(self):
        # Closing never needs write or read authority, including after expiry.
        self.stream.close()
