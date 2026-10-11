"""Strict native admission readback matched to a separately trusted context.

A parsed record is not source permission or authentication. The trusted parent
must obtain it from the fixed no-argument native reader on its scoped account.
It is a dated observation, not a transferable token or permission to retry.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from re import fullmatch

from workers.exact_timestamp import parse_exact_timestamp
from workers.closed_pair_channel import _json
from workers.closed_ssb_worker import ClosedSSBContext, parse_closed_ssb_context
from workers.update_request_identity import canonical_update_request

MAX_ADMISSION_BYTES = 16384
FIELDS = frozenset({'schemaVersion','principal','sourceInventorySha256','canonicalRequest',
    'runId','workClaimId','pairId','workAttempt','leaseExpiresAt','deadlineAt','scopeExpiresAt',
    'observedAt','responseContexts'})
RESPONSE_FIELDS = frozenset({'registrationId','sourceVersionId','requestKey','maxBodyBytes','endpointSha256'})


@dataclass(frozen=True)
class NativePairAdmission:
    context: ClosedSSBContext
    source_fingerprint: str
    observed_at: datetime
    expires_at: datetime
    receipt_sha256: str


def _instant(value):
    if type(value) is not str or not 1 <= len(value) <= 40:
        raise ValueError
    instant = parse_exact_timestamp(value)
    if instant.utcoffset() != timedelta(0):
        raise ValueError
    return instant


def parse_private_pair_context(raw_context,source_fingerprint,*,now):
    """Local manual bounds only; never a native admission or source grant."""
    context=parse_closed_ssb_context(raw_context,now=now)
    request=context.metadata.invocation;work=context.metadata.work
    if type(source_fingerprint) is not str or fullmatch('[0-9a-f]{64}',source_fingerprint) is None \
            or request.code_version!='ssb-sha256:'+source_fingerprint or request.trigger!='manual' \
            or request.scheduled_due_at is not None or request.limits.max_items!=3 \
            or request.limits.max_retries!=0 or request.limits.max_model_calls!=0 \
            or request.limits.max_response_bytes!=131074 or work.attempt!=1:
        raise ValueError('Private pair context exceeds fixed manual bounds')
    return context


def confirm_native_pair_admission(raw, raw_context, source_fingerprint, *, now):
    try:
        context = parse_private_pair_context(raw_context, source_fingerprint, now=now)
        request = context.metadata.invocation; work = context.metadata.work
        if type(raw) is not bytes or not 2 <= len(raw) <= MAX_ADMISSION_BYTES \
                or type(source_fingerprint) is not str or fullmatch('[0-9a-f]{64}',source_fingerprint) is None:
            raise ValueError
        value = _json(raw)
        if type(value) is not dict or frozenset(value) != FIELDS \
                or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 \
                or value['principal'] != context.principal or value['sourceInventorySha256'] != source_fingerprint \
                or value['canonicalRequest'] != canonical_update_request(request) \
                or value['runId'] != str(work.run_id) or value['workClaimId'] != str(work.lease_id) \
                or value['pairId'] != context.pair_id or type(value['workAttempt']) is not int \
                or value['workAttempt'] != work.attempt:
            raise ValueError
        if type(value['responseContexts']) is not dict or set(value['responseContexts']) != {'metadata','data'}:
            raise ValueError
        for kind, expected, version in (('metadata', context.metadata, context.metadata_version_id),
                ('data', context.data, context.data_version_id)):
            fields = value['responseContexts'][kind]
            if type(fields) is not dict or frozenset(fields) != RESPONSE_FIELDS \
                    or fields['registrationId'] != expected.registration_id or fields['sourceVersionId'] != version \
                    or fields['requestKey'] != expected.request_key or type(fields['maxBodyBytes']) is not int \
                    or fields['maxBodyBytes'] != expected.max_body_bytes \
                    or fields['endpointSha256'] != sha256(expected.endpoint.encode()).hexdigest():
                raise ValueError
        observed = _instant(value['observedAt']); expires = _instant(value['scopeExpiresAt'])
        if _instant(value['leaseExpiresAt']) != work.lease_expires_at \
                or _instant(value['deadlineAt']) != work.deadline_at \
                or not work.observed_at <= observed <= now < expires \
                or expires > min(work.lease_expires_at, work.deadline_at) \
                or (now-observed).total_seconds() > 3 or (expires-now).total_seconds() < 1:
            raise ValueError
        return NativePairAdmission(context, source_fingerprint, observed, expires, sha256(raw).hexdigest())
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError,ArithmeticError):
        raise ValueError('Native private pair admission is invalid, changed or expired') from None
