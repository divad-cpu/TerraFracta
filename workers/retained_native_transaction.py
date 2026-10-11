"""Fixed two-phase parent store using an already owned ordinary psql process.

No command, target, account, source, root or activation is selected here.
Retain the unchanged v2 source locks across the parent's fsync/reopen callback.
Filesystem and SQL are not atomic. Timeout/termination may release server locks
before a blocked filesystem call returns; preserve that uncertain/orphan state.
"""
import json
from dataclasses import dataclass
from datetime import datetime
from fractions import Fraction
from math import isfinite
import os
import selectors
import subprocess
import threading
import time

from workers.bounded_worker_process import communicate_bounded
from workers.native_pair_admission import MAX_ADMISSION_BYTES
from workers.private_pair_native_sql import private_operation_sql, private_retention_sql

MAX_INPUT = 294912
MAX_OUTPUT = 32768
COMMIT_MARKER = b'TF_PRIVATE_PAIR_STORE_COMMITTED'
BEGIN = (
    "begin isolation level read committed;\n"
    "set local transaction_timeout='6s';\n"
    "set local idle_in_transaction_session_timeout='3s';\n"
    + private_retention_sql() + '\n'
).encode('ascii')
END = b'\ncommit;\n\\echo ' + COMMIT_MARKER + b'\n'


@dataclass(frozen=True)
class RetainedPairStore:
    arguments: dict
    raw_attempt_id: str
    stored_at: datetime

    def statement(self):
        return private_operation_sql('store_pair', self.arguments,
            raw_attempt_id=self.raw_attempt_id, stored_at=self.stored_at)


class _RetainedDeadline:
    def __init__(self, timeout):
        self.previous = None
        self.deadline = Fraction(self._tick()) + Fraction(timeout)

    def _tick(self):
        value = time.monotonic()
        if type(value) not in (int, float) or not isfinite(value):
            raise ValueError('Retained native clock unavailable')
        exact = Fraction(value)
        if self.previous is not None and exact < self.previous:
            raise ValueError('Retained native clock moved backward')
        self.previous = exact
        return value

    def remaining(self):
        remaining = self.deadline - Fraction(self._tick())
        if remaining <= 0:
            raise ValueError('Retained native deadline reached')
        return float(remaining)


def _remaining(deadline):
    return deadline.remaining()


def _begin_receipt(process, payload, deadline):
    """Bounded first input/one JSON line; leave the same stdin open."""
    output = bytearray()
    sent = 0
    with selectors.DefaultSelector() as selector:
        for name in ('stdin', 'stdout', 'stderr'):
            stream = getattr(process, name)
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_WRITE if name == 'stdin' else selectors.EVENT_READ, name)
        while True:
            for key, _events in selector.select(_remaining(deadline)):
                _remaining(deadline)
                name, stream = key.data, key.fileobj
                if name == 'stdin':
                    count = os.write(stream.fileno(), payload[sent:sent + 4096])
                    if count <= 0: raise ValueError
                    sent += count
                    if sent == len(payload): selector.unregister(stream)
                else:
                    cap = MAX_ADMISSION_BYTES + 1 - len(output) if name == 'stdout' else 1
                    chunk = os.read(stream.fileno(), min(4096, cap))
                    if not chunk or name == 'stderr': raise ValueError
                    output.extend(chunk)
                    if len(output) > MAX_ADMISSION_BYTES + 1: raise ValueError
                    if b'\n' in output:
                        if sent != len(payload) or not output.endswith(b'\n') or output.count(b'\n') != 1: raise ValueError
                        raw = bytes(output[:-1])
                        if not 2 <= len(raw) <= MAX_ADMISSION_BYTES or type(json.loads(raw)) is not dict: raise ValueError
                        _remaining(deadline)
                        return raw


def retained_pair_store(process, prefix, prepare_store, *, timeout):
    """Parent callback receives checked framing, returns only fixed store data.

    The backend independently validates admission before any filesystem work.
    A store SELECT is withheld until COMMIT marker, EOF, clean exit and reaping.
    Killing a docker client alone does not establish remote rollback.
    """
    if not callable(prepare_store) or type(prefix) is not bytes or len(prefix) > 192 \
            or type(timeout) not in (int, float) or not 0 < timeout <= 8:
        raise ValueError('Invalid retained native configuration')
    deadline = None
    expired = threading.Event()
    def expire():
        expired.set()
        # This callback runs on its own thread, outside the client's generic
        # error boundary. Preserve expiry even if local process APIs fail;
        # never emit diagnostics that can contain private target information.
        try:
            if process.poll() is None: process.kill()
        except Exception: pass
    watchdog = None
    failed = True
    try:
        # Admission owns the process before reading its clock. Every clock
        # failure must cross the same cleanup and private error boundary.
        deadline = _RetainedDeadline(timeout)
        watchdog = threading.Timer(timeout, expire)
        watchdog.daemon = True
        watchdog.start()
        receipt = _begin_receipt(process, prefix + BEGIN, deadline)
        selected = prepare_store(receipt)
        _remaining(deadline)
        if expired.is_set() or process.poll() is not None: raise ValueError
        if type(selected) is not RetainedPairStore: raise ValueError
        # The existing validated builder supplies the only SQL statement.
        # The callback cannot select a query, transaction or meta-command.
        payload = selected.statement().encode('utf-8') + END
        if len(prefix) + len(BEGIN) + len(payload) > MAX_INPUT: raise ValueError
        output = communicate_bounded(process, payload, timeout=_remaining(deadline),
            max_input=MAX_INPUT, max_stdout=MAX_OUTPUT - len(receipt) - 1, max_stderr=1024)
        _remaining(deadline)
        lines = output.stdout.splitlines()
        if expired.is_set() or output.returncode or output.stderr or len(lines) != 2 \
                or lines[1] != COMMIT_MARKER or not 2 <= len(lines[0]) <= MAX_OUTPUT \
                or type(json.loads(lines[0])) is not dict:
            raise ValueError
        failed = False
        return lines[0].decode('utf-8')
    except BaseException as error:
        if isinstance(error, Exception):
            raise ValueError('Retained native store unavailable; preserved state requires recovery') from None
        raise
    finally:
        if watchdog is not None:
            watchdog.cancel()
        if failed and process.poll() is None:
            try: process.kill()
            except ProcessLookupError: pass
        if process.poll() is None:
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                raise ValueError('Retained native cleanup unavailable') from None
        for name in ('stdin', 'stdout', 'stderr'):
            stream = getattr(process, name, None)
            if stream is not None and not stream.closed: stream.close()
        if not failed:
            try:
                _remaining(deadline)
            except Exception:
                raise ValueError('Retained native store unavailable; preserved state requires recovery') from None
