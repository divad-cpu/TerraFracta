"""Closed paired-capture protocol over an inherited Unix packet socket.

The custodian supplies eight fixed operations. Requests have no SQL, transaction,
role, connection, path or endpoint selector. This is protocol separation for a
cooperative worker, not isolation from hostile code running as the same OS user.
No credentials, source authority, networking or database connection are created.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timedelta
from fractions import Fraction
import json
from math import isfinite
import re
import socket
import time
from uuid import UUID

from workers.exact_timestamp import parse_exact_timestamp

MAX_REQUEST_BYTES = 184_320
MAX_RECEIPT_BYTES = 32_768
MAX_RESPONSE_BYTES = 45_056
MAX_BODY_BYTES = 65_536
MAX_PACKETS = 32
FIELDS = {
    'reserve_response': frozenset({'kind'}),
    'dispatch_response': frozenset({'kind', 'reservationId'}),
    'settle_response': frozenset({'kind', 'reservationId', 'outcome', 'bodyBytes', 'contentSha256'}),
    'confirm_response': frozenset({'kind', 'phase', 'receipt'}),
    'store_pair': frozenset({'metadata', 'data', 'metadataRetrievedAt', 'dataRetrievedAt', 'manifest'}),
    'read_pair_checkpoint': frozenset(),
    'close_processing': frozenset(),
    'read_closeout': frozenset(),
}


class PairChannelError(ValueError):
    """Generic refusal; never carry backend or source exception details."""


def _json(raw: bytes):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result
    def invalid(_value):
        raise ValueError
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique, parse_constant=invalid)
    except (ValueError, UnicodeError, RecursionError):
        raise PairChannelError('Invalid paired channel message') from None


def _encode(value) -> bytes:
    try:
        return json.dumps(value, allow_nan=False, separators=(',', ':')).encode('utf-8')
    except (ValueError, TypeError, RecursionError, UnicodeError):
        raise PairChannelError('Invalid paired channel message') from None


def _binary(value, limit):
    if type(value) is not str or not 4 <= len(value) <= 4 * ((limit + 2) // 3):
        raise PairChannelError('Invalid paired channel argument')
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise PairChannelError('Invalid paired channel argument') from None
    if not 1 <= len(decoded) <= limit or base64.b64encode(decoded).decode('ascii') != value:
        raise PairChannelError('Invalid paired channel argument')
    return decoded


def _uuid(value):
    if type(value) is not str or len(value) != 36:
        raise PairChannelError('Invalid paired channel argument')
    try:
        parsed = UUID(value)
    except ValueError:
        raise PairChannelError('Invalid paired channel argument') from None
    if str(parsed) != value or parsed.version != 4:
        raise PairChannelError('Invalid paired channel argument')


def _instant(value):
    if type(value) is not str or len(value) > 40:
        raise PairChannelError('Invalid paired channel argument')
    try:
        parsed = parse_exact_timestamp(value)
    except ValueError:
        raise PairChannelError('Invalid paired channel argument') from None
    if parsed.utcoffset() != timedelta(0):
        raise PairChannelError('Invalid paired channel argument')
    return parsed


def validate_operation(operation, arguments):
    """Validate before calling the fixed custodian implementation.

    Semantic request/receipt, current-rights and COMMIT validation remain in the
    source-specific backend. No client-selected function is admitted here.
    """
    if type(operation) is not str or operation not in FIELDS or type(arguments) is not dict \
            or frozenset(arguments) != FIELDS[operation]:
        raise PairChannelError('Invalid paired channel operation')
    if 'kind' in arguments and arguments['kind'] not in ('metadata', 'data'):
        raise PairChannelError('Invalid paired channel argument')
    if 'reservationId' in arguments:
        _uuid(arguments['reservationId'])
    if operation == 'settle_response':
        measured = arguments['outcome'] == 'measured'
        digest = arguments['contentSha256']
        if arguments['outcome'] not in ('measured', 'uncertain') \
                or type(arguments['bodyBytes']) is not int or not 0 <= arguments['bodyBytes'] <= MAX_BODY_BYTES + 1 \
                or (measured and (type(digest) is not str or re.fullmatch('[0-9a-f]{64}', digest) is None)) \
                or (not measured and (digest is not None or arguments['bodyBytes'] != MAX_BODY_BYTES + 1)):
            raise PairChannelError('Invalid paired channel argument')
    if operation == 'confirm_response':
        if arguments['phase'] not in ('reserve', 'dispatch', 'settle'):
            raise PairChannelError('Invalid paired channel argument')
        receipt = _binary(arguments['receipt'], 4096)
        if type(_json(receipt)) is not dict:
            raise PairChannelError('Invalid paired channel argument')
    if operation == 'store_pair':
        for kind in ('metadata', 'data'):
            _binary(arguments[kind], MAX_BODY_BYTES)
        metadata_time = _instant(arguments['metadataRetrievedAt'])
        data_time = _instant(arguments['dataRetrievedAt'])
        manifest = arguments['manifest']
        if not metadata_time <= data_time <= metadata_time + timedelta(minutes=5) \
                or type(manifest) is not str or not 2 <= len(manifest.encode('utf-8')) <= 8192 \
                or type(_json(manifest.encode('utf-8'))) is not dict:
            raise PairChannelError('Invalid paired channel argument')


def _packet(connection, limit):
    raw, ancillary, flags, _address = connection.recvmsg(limit + 1)
    if not raw or ancillary or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or len(raw) > limit:
        raise PairChannelError('Invalid paired channel packet')
    return raw


def _send(connection, raw):
    if connection.send(raw) != len(raw):
        raise PairChannelError('Incomplete paired channel packet')


@dataclass
class PairCustodianSession:
    """One private capability, fixed deadline and packet budget; no retries.

    Callbacks must themselves have bounded execution and COMMIT before return.
    A lost reply never causes this session to replay a write. A refused request
    terminates this capability. Creating another session is custodian authority.
    """
    operations: dict
    deadline: float
    next_id: int = 1
    closed: bool = False

    def __post_init__(self):
        if type(self.operations) is not dict or set(self.operations) != set(FIELDS) \
                or any(not callable(callback) for callback in self.operations.values()) \
                or type(self.deadline) not in (int, float) or not self.deadline < float('inf'):
            raise PairChannelError('Invalid paired custodian configuration')
        if type(self.next_id) is not int or self.next_id != 1 or self.closed is not False:
            raise PairChannelError('Invalid paired custodian state')
        self.operations = dict(self.operations)
        self._previous_tick=None
        self._deadline=self.deadline
        self._remaining()

    def _remaining(self):
        try:
            tick=time.monotonic()
            if type(tick) not in (int,float) or not isfinite(tick) \
                    or (self._previous_tick is not None and tick<self._previous_tick):
                raise ValueError
            remaining=Fraction(self._deadline)-Fraction(tick)
            if remaining<=0:
                raise ValueError
            result=float(remaining)
            if not isfinite(result):
                raise ValueError
        except Exception:
            raise PairChannelError('Paired capability clock unavailable or expired') from None
        self._previous_tick=tick
        return result

    def serve_one(self, connection):
        identity = 0
        try:
            if self.closed or self.next_id > MAX_PACKETS:
                raise PairChannelError('Paired capability ended')
            connection.settimeout(max(.001, self._remaining()))
            request = _json(_packet(connection, MAX_REQUEST_BYTES))
            if type(request) is dict and type(request.get('requestId')) is int \
                    and 1 <= request['requestId'] <= MAX_PACKETS:
                identity = request['requestId']
            if type(request) is not dict or set(request) != {'schemaVersion', 'requestId', 'operation', 'arguments'} \
                    or type(request['schemaVersion']) is not int or request['schemaVersion'] != 1 \
                    or type(request['requestId']) is not int or request['requestId'] != self.next_id:
                raise PairChannelError('Invalid paired channel request')
            validate_operation(request['operation'], request['arguments'])
            self._remaining()
        except (ValueError, OSError, TypeError, UnicodeError):
            self.closed = True
            response = {'schemaVersion': 1, 'requestId': identity, 'state': 'refused', 'reason': 'invalid_request'}
        else:
            # Consume identity before invoking a mutating callback: uncertain
            # execution cannot be retried through this capability.
            self.next_id += 1
            try:
                receipt = self.operations[request['operation']](request['arguments'])
                if type(receipt) is not bytes or not 2 <= len(receipt) <= MAX_RECEIPT_BYTES \
                        or type(_json(receipt)) is not dict:
                    raise PairChannelError('Paired result unavailable')
                self._remaining()
                response = {'schemaVersion': 1, 'requestId': identity, 'state': 'receipt',
                            'receipt': base64.b64encode(receipt).decode('ascii')}
            except Exception:
                self.closed = True
                response = {'schemaVersion': 1, 'requestId': identity, 'state': 'refused', 'reason': 'unavailable'}
            except BaseException:
                self.closed = True
                raise
        raw = _encode(response)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise PairChannelError('Paired result unavailable')
        if response['state']=='receipt':
            try:
                connection.settimeout(max(.001,self._remaining()))
            except (ValueError,OSError,TypeError):
                self.closed=True
                response={'schemaVersion':1,'requestId':identity,'state':'refused','reason':'unavailable'}
                raw=_encode(response)
        try:
            _send(connection, raw)
        except OSError:
            self.closed = True
            raise PairChannelError('Paired channel unavailable') from None
        return response['state']


class PairChannelClient:
    """Credential-free caller; never retries after a missing or refused reply."""
    def __init__(self, connection, *, timeout=10):
        if type(timeout) not in (int, float) or not 0 < timeout <= 10:
            raise PairChannelError('Invalid paired channel timeout')
        self.connection = connection
        self.timeout = timeout
        self.next_id = 1
        self.closed = False

    def call(self, operation, arguments):
        if self.closed or self.next_id > MAX_PACKETS:
            raise PairChannelError('Paired capability ended')
        validate_operation(operation, arguments)
        identity = self.next_id
        request = _encode({'schemaVersion': 1, 'requestId': identity,
                           'operation': operation, 'arguments': arguments})
        if len(request) > MAX_REQUEST_BYTES:
            raise PairChannelError('Paired request oversized')
        # No resend after any send/receive ambiguity.
        self.next_id += 1
        try:
            self.connection.settimeout(self.timeout)
            _send(self.connection, request)
            response = _json(_packet(self.connection, MAX_RESPONSE_BYTES))
            if type(response) is not dict or type(response.get('schemaVersion')) is not int \
                    or response['schemaVersion'] != 1 or type(response.get('requestId')) is not int \
                    or response['requestId'] != identity \
                    or set(response) != {'schemaVersion', 'requestId', 'state', 'receipt'} \
                    or response['state'] != 'receipt':
                raise PairChannelError('Paired response unavailable')
            receipt = _binary(response['receipt'], MAX_RECEIPT_BYTES)
            if type(_json(receipt)) is not dict:
                raise PairChannelError('Paired response unavailable')
            return receipt
        except (OSError, ValueError, TypeError):
            self.closed = True
            raise PairChannelError('Paired response unavailable') from None
