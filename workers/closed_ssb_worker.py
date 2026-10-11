"""Credential-free closed-channel SSB composition, without a live entry point.

Context contains fixed identities and budgets only. The trusted caller supplies
the channel and transport; this module creates no connection, SQL, path, source
approval, schedule or public writer. Context validation is not authentication.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from re import fullmatch
from uuid import UUID

from workers.exact_timestamp import parse_exact_timestamp
from workers.closed_pair_channel import _json
from workers.closed_pair_backend import ChannelResponseBackend, ChannelPendingPairBackend
from workers.confirmed_response_backend import ConfirmedResponseBackend
from workers.source_response_receipts import ResponseRequest, validate_response_request, _uuid
from workers.ssb_14059_capture import METADATA_URL, DATA_URL, MAX_RESPONSE_BYTES
from workers.ssb_pair_processing import process_reserved_ssb_pair, PendingPairResult
from workers.update_request_identity import RunLimits, UpdateRequest, canonical_update_request
from workers.update_run_work import WorkClaim

MAX_CONTEXT_BYTES = 16_384
KINDS = ('metadata', 'data')


@dataclass(frozen=True)
class ClosedSSBContext:
    metadata: ResponseRequest
    data: ResponseRequest
    metadata_version_id: str
    data_version_id: str
    pair_id: str
    principal: str


@dataclass(frozen=True)
class ClosedSSBResult:
    pending: PendingPairResult
    checkpoint: bytes
    closeout: bytes


def _context_instant(value):
    # Keep the established datetime default=str context separator. All receipt
    # writers use T; context work fields also admit one ASCII space at position 10.
    if type(value) is str and value[10:11] == ' ':
        value = value[:10] + 'T' + value[11:]
    return parse_exact_timestamp(value)


def parse_closed_ssb_context(raw: bytes, *, now: datetime) -> ClosedSSBContext:
    """Reject malformed authority context before any channel or transport call."""
    try:
        if type(raw) is not bytes or not 2 <= len(raw) <= MAX_CONTEXT_BYTES:
            raise ValueError
        value = _json(raw)
        if type(value) is not dict or set(value) != {'request', 'work', 'responses', 'versions', 'pairId', 'principal'}:
            raise ValueError
        for name in ('request', 'work', 'responses', 'versions'):
            if type(value[name]) is not dict:
                raise ValueError
        if type(value['principal']) is not str or not fullmatch(r'[a-z_][a-z0-9_]{0,62}', value['principal']):
            raise ValueError
        _uuid(value['pairId'])
        if set(value['responses']) != set(KINDS) or set(value['versions']) != set(KINDS):
            raise ValueError
        for kind in KINDS:
            _uuid(value['versions'][kind])
        if value['versions']['metadata'] == value['versions']['data']:
            raise ValueError
        payload = dict(value['request'])
        if type(payload['limits']) is not dict:
            raise ValueError
        limits = dict(payload.pop('limits'))
        for key in ('run_cap_usd', 'month_cap_usd'):
            if type(limits[key]) is not str or len(limits[key]) > 64:
                raise ValueError
            limits[key] = Decimal(limits[key])
        payload['limits'] = RunLimits(**limits)
        if payload['scheduled_due_at'] is not None:
            payload['scheduled_due_at'] = _context_instant(payload['scheduled_due_at'])
        request = UpdateRequest(**payload)
        canonical_update_request(request)
        if request.mode != 'shadow':
            raise ValueError
        work_payload = dict(value['work'])
        for key in ('run_id', 'lease_id'):
            _uuid(work_payload[key])
            work_payload[key] = UUID(work_payload[key])
        for key in ('lease_expires_at', 'deadline_at', 'observed_at'):
            if type(work_payload[key]) is not str or len(work_payload[key]) > 40:
                raise ValueError
            instant = _context_instant(work_payload[key])
            if instant.tzinfo is None:
                raise ValueError
            work_payload[key] = instant.astimezone(timezone.utc)
        work = WorkClaim(**work_payload)
        if type(work.attempt) is not int or not 1 <= work.attempt <= request.limits.max_retries + 1 \
                or work.status not in {'claimed', 'existing_claim', 'renewed'} \
                or work.lease_expires_at > work.deadline_at \
                or work.lease_expires_at > work.observed_at + timedelta(seconds=30) \
                or work.deadline_at > work.observed_at + timedelta(seconds=request.limits.max_duration_seconds):
            raise ValueError
        responses = {}
        for kind, endpoint in (('metadata', METADATA_URL), ('data', DATA_URL)):
            fields = value['responses'][kind]
            if type(fields) is not dict or set(fields) != {'registration_id', 'request_key'}:
                raise ValueError
            response = ResponseRequest(request, work, endpoint=endpoint, max_body_bytes=MAX_RESPONSE_BYTES, **fields)
            validate_response_request(response, now)
            responses[kind] = response
        if responses['metadata'].registration_id == responses['data'].registration_id \
                or responses['metadata'].request_key == responses['data'].request_key \
                or request.limits.max_response_bytes < 2 * (MAX_RESPONSE_BYTES + 1):
            raise ValueError
        return ClosedSSBContext(responses['metadata'], responses['data'], value['versions']['metadata'],
            value['versions']['data'], value['pairId'], value['principal'])
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError, ArithmeticError):
        raise ValueError('Invalid closed SSB context') from None


def process_closed_ssb_context(raw, client, fixed_fetcher, *, utc_now=lambda: datetime.now(timezone.utc), monotonic=None):
    context = parse_closed_ssb_context(raw, now=utc_now())
    options = {'utc_now': utc_now}
    if monotonic is not None:
        options['monotonic'] = monotonic
    requests = {'metadata': context.metadata, 'data': context.data}
    adapters = {kind: ChannelResponseBackend(client, requests[kind], kind) for kind in KINDS}
    confirmed = {kind: ConfirmedResponseBackend(requests[kind], context.principal, adapters[kind], adapters[kind], **options)
                 for kind in KINDS}
    def factory(expected):
        for kind in KINDS:
            if expected == requests[kind]:
                return confirmed[kind]
        raise ValueError('Unknown closed response context')
    backend = ChannelPendingPairBackend(client)
    result = process_reserved_ssb_pair(context.metadata, context.data, context.metadata_version_id,
        context.data_version_id, context.pair_id, factory, fixed_fetcher, backend, **options)
    return ClosedSSBResult(result, backend.checkpoint, backend.closeout)
