"""Strict post-COMMIT authority receipts for a trusted fixed-execution adapter.

A receipt is private fencing metadata, not a bearer token or permission to
resend. The adapter owns autocommit statements; source/model inputs cannot
supply SQL or credentials. This pure module never opens a connection.
"""
from dataclasses import dataclass
from datetime import datetime,timezone
from hashlib import sha256
import json
from workers.exact_timestamp import parse_exact_timestamp
from workers.source_response_receipts import ResponseRequest,validate_response_request,_unique,_uuid,_time
FIELDS=frozenset({'schemaVersion','phase','principal','reservationId','runId','workClaimId','registrationId',
 'maxBodyBytes','endpointSha256','receiptSha256','observedAt','authorityExpiresAt'})

@dataclass(frozen=True)
class ResponseAuthority:
    phase:str
    reservation_id:str
    observed_at:datetime
    expires_at:datetime

    def remaining_seconds(self,now:datetime)->int:
        if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset().total_seconds()!=0:
            raise ValueError('Response authority time is invalid')
        return max(0,int((self.expires_at-now).total_seconds())) if now>=self.observed_at else 0


def parse_response_authority(data:bytes,expected:ResponseRequest,*,phase:str,principal:str,
                             reservation_id:str,receipt:bytes,now:datetime)->ResponseAuthority:
    try:
        validate_response_request(expected,now);_uuid(reservation_id)
        if phase not in ('reserve','dispatch','settle') or type(principal) is not str or not principal \
          or type(data) is not bytes or not 2<=len(data)<=4096 or type(receipt) is not bytes or not 2<=len(receipt)<=4096:
            raise ValueError
        p=json.loads(data.decode('utf8'),object_pairs_hook=_unique)
        if type(p) is not dict or frozenset(p)!=FIELDS or type(p['schemaVersion']) is not int or p['schemaVersion']!=1 \
          or p['phase']!=phase or p['principal']!=principal or p['reservationId']!=reservation_id \
          or p['runId']!=str(expected.work.run_id) or p['workClaimId']!=str(expected.work.lease_id) \
          or p['registrationId']!=expected.registration_id or type(p['maxBodyBytes']) is not int \
          or p['maxBodyBytes']!=expected.max_body_bytes or p['endpointSha256']!=sha256(expected.endpoint.encode()).hexdigest() \
          or p['receiptSha256']!=sha256(receipt).hexdigest():raise ValueError
        observed=_time(p['observedAt'],now)
        expires=parse_exact_timestamp(p['authorityExpiresAt'])
        if expires.tzinfo is None:raise ValueError
        expires=expires.astimezone(timezone.utc)
        if observed<expected.work.observed_at \
          or expires>expected.work.lease_expires_at or expires>expected.work.deadline_at \
          or observed>=expires:raise ValueError
        authority=ResponseAuthority(phase,reservation_id,observed,expires)
        if authority.remaining_seconds(now)<1:raise ValueError
        return authority
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError) as exc:
        raise ValueError('Post-COMMIT response authority is invalid or expired') from exc
