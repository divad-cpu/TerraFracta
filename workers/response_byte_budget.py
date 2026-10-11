"""One-process body-read reservations shared by requests in one update run.

Reuses Python byte streams and a lock. Does not open URLs or authenticate a
source. A trusted adapter must bound each read, enforce a deadline, and share
one instance across every response/retry. This is not a durable multi-process
ledger, a header/TLS byte meter or a monetary budget.
"""

from dataclasses import dataclass
from threading import Lock
from typing import BinaryIO

from workers.update_request_identity import MAX_RESPONSE_BYTES


class ResponseBudgetError(ValueError):
    """A body read cannot proceed within its allocated byte bound."""


@dataclass(frozen=True)
class ResponseBudgetSnapshot:
    limit_bytes: int
    charged_bytes: int
    reserved_bytes: int
    uncertain_attempts: int

    @property
    def remaining_bytes(self):
        return self.limit_bytes - self.charged_bytes - self.reserved_bytes


class ResponseByteBudget:
    def __init__(self, limit_bytes: int):
        if type(limit_bytes) is not int or not 1 <= limit_bytes <= MAX_RESPONSE_BYTES:
            raise ResponseBudgetError('Response budget is invalid')
        self._limit = limit_bytes
        self._charged = self._reserved = self._uncertain = 0
        self._lock = Lock()

    def snapshot(self) -> ResponseBudgetSnapshot:
        with self._lock:
            return ResponseBudgetSnapshot(self._limit,self._charged,self._reserved,self._uncertain)

    def read_body(self, stream: BinaryIO, *, max_body_bytes: int) -> bytes:
        """Reserve worst-case bytes before reading; reconcile only measured reads.

        One extra byte is reserved for oversize detection. If the body has
        exactly max_body_bytes, its final EOF read returns no byte. Measured
        oversized responses stay charged. If a read raises, or violates the
        trusted bounded-stream contract, conservatively charge the entire
        reservation because the exact consumed count is unknown. Cancellation
        also retains that charge. The caller owns/ closes the stream.
        """
        if type(max_body_bytes) is not int or not 1 <= max_body_bytes <= MAX_RESPONSE_BYTES:
            raise ResponseBudgetError('Response body bound is invalid')
        capacity = max_body_bytes + 1
        with self._lock:
            if self._charged + self._reserved + capacity > self._limit:
                raise ResponseBudgetError('Response budget has insufficient unreserved bytes')
            self._reserved += capacity
        body = bytearray()
        charged = capacity
        uncertain = True
        try:
            while True:
                size = min(8192,capacity-len(body))
                try:
                    chunk = stream.read(size)
                except Exception:
                    raise ResponseBudgetError('Response body read failed; reservation remains charged') from None
                if type(chunk) is not bytes or len(chunk) > size:
                    raise ResponseBudgetError('Response stream violated its bounded byte contract')
                body.extend(chunk)
                if len(body) > max_body_bytes:
                    charged,uncertain = len(body),False
                    raise ResponseBudgetError('Response body exceeds its byte bound')
                if not chunk:
                    charged,uncertain = len(body),False
                    return bytes(body)
        finally:
            with self._lock:
                self._reserved -= capacity
                self._charged += charged
                self._uncertain += int(uncertain)
