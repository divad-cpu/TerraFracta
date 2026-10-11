"""One fixed metadata/data transport sequence for an admitted caller.

No CLI, identity, source registration, storage or publication. Supplying this
broker does not grant permission to fetch. The reserved driver must independently
confirm dispatch before calling it. The actual live custodian is not connected.
"""
from fractions import Fraction
from math import isfinite
from threading import Lock
from time import monotonic
from workers.ssb_14059_pair_transport import PAIR_DEADLINE_SECONDS, _run_one
from workers.ssb_14059_capture import (parse_captured_ssb_14059_metadata,
    parse_captured_ssb_14059, require_matching_metadata, require_bounded_pair_chronology)


class FixedSSBTransportBroker:
    def __init__(self):
        self._next = 'metadata'
        self._deadline = None
        self._metadata = None
        self._previous_tick = None
        self._lock = Lock()

    def _remaining(self, deadline, *, clock=None):
        try:
            tick = (monotonic if clock is None else clock)()
            valid = type(tick) in (int, float) and isfinite(tick)
        except Exception as exc:
            raise ValueError('Fixed transport monotonic clock refused') from exc
        if not valid:
            raise ValueError('Fixed transport monotonic clock refused')
        exact_tick = Fraction(tick)
        if self._previous_tick is not None and exact_tick < self._previous_tick:
            raise ValueError('Fixed transport monotonic clock moved backward')
        self._previous_tick = exact_tick
        remaining = Fraction(deadline) - exact_tick
        if not 0 < remaining <= PAIR_DEADLINE_SECONDS:
            raise ValueError('Fixed transport shared deadline ended')
        return float(remaining)

    def _capture(self, kind, *, deadline):
        return _run_one(kind, deadline=deadline)

    def __call__(self, kind, *, deadline):
        if not self._lock.acquire(blocking=False):
            raise ValueError('Fixed transport is already processing a response')
        try:
            try:
                valid = type(kind) is str and kind == self._next and type(deadline) in (int, float) \
                    and isfinite(deadline) and (self._deadline is None or deadline <= self._deadline)
            except OverflowError as exc:
                raise ValueError('Fixed transport sequence or shared deadline changed') from exc
            if not valid:
                raise ValueError('Fixed transport sequence or shared deadline changed')
            self._remaining(deadline)
            # Consume before starting a process. Failure never reopens a request
            # or authorizes another metadata fetch in this broker instance.
            self._next = 'failed'
            self._deadline = deadline
            capture = self._capture(kind, deadline=deadline)
            if kind == 'metadata':
                parsed = parse_captured_ssb_14059_metadata(capture)
            else:
                parsed = parse_captured_ssb_14059(capture)
                require_matching_metadata(parsed, self._metadata)
                require_bounded_pair_chronology(parsed, self._metadata)
            self._remaining(deadline)
            if kind == 'metadata':
                self._metadata = parsed
                self._next = 'data'
            else:
                self._next = 'complete'
            return capture
        except BaseException:
            self._next = 'failed'
            raise
        finally:
            self._lock.release()
