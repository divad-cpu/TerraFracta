"""Check supplied HTTP metadata/body consistency for explicit offline profiles.

No URL/open/DNS/TLS/backend/source/rights/retention/publication capability. The
trusted transport must enforce origin, zero redirects, framing and bounds before
releasing a complete body. Supplied metadata alone cannot prove that happened.
Existing durable dispatch/capture/settlement/no-resend rules remain untouched.
"""
from dataclasses import dataclass,field
from datetime import datetime,timezone
from hashlib import sha256
import json
import re

from workers.public_source_url import public_https_source_url
from workers.dispatch_input_snapshot import freeze_input, thaw_input

MAX_BODY_BYTES=64*1024
MAX_RELEVANT_HEADERS=8
MEDIA={'rss20':'application/rss+xml','atom10':'application/atom+xml','utf8_text':'text/plain','utf8_html':'text/html','native_pdf':'application/pdf'}
HEADERS=frozenset({'content-type','content-length','content-encoding','transfer-encoding'})


class ResponseEnvelopeError(ValueError):pass


@dataclass(frozen=True)
class ExpectedResponseBody:
    endpoint: str
    profile: str
    max_body_bytes: int


@dataclass(frozen=True)
class SuppliedResponseEnvelope:
    requested_url: str
    final_url: str
    status: int
    redirect_count: int
    # Trusted transport projects only these representation/framing fields;
    # duplicate occurrences stay separate, never flattened by a dictionary.
    relevant_headers: tuple[tuple[str,str],...]
    retrieved_at: datetime


@dataclass(frozen=True)
class CheckedResponseBody:
    body: bytes = field(repr=False)
    endpoint: str
    profile: str
    media_type: str
    content_sha256: str
    retrieved_at: datetime
    declared_length: int | None
    envelope_sha256: str
    evidence_state: str = 'supplied_http_envelope_consistency_only'


def _utc(value):
    return type(value) is datetime and value.tzinfo is not None and value.utcoffset()==timezone.utc.utcoffset(value)


def check_fixed_response_envelope(body: bytes,expected: ExpectedResponseBody,envelope: SuppliedResponseEnvelope,*,observed_at: datetime):
    """A conservative200/identity/no-transfer-coding profile, not all HTTP.

    Duplicate relevant fields (even equal values), parameter extensions, redirects,
    partial/not-modified responses and transfer codings refuse. A missing length
    remains unknown; EOF/framing completeness must come from the trusted opener.
    Text profiles allow only optional UTF-8 charset; binary PDF allows no media
    parameters. Actual document syntax belongs to the downstream parser.
    """
    try:
        # Preserve every primitive and header occurrence before a supplied UTC
        # callback can mutate either independent expectations or response data.
        body, expected, envelope, observed_at = thaw_input(freeze_input(
            (body, expected, envelope, observed_at), (ExpectedResponseBody, SuppliedResponseEnvelope)))
        if (type(body) is not bytes or type(expected) is not ExpectedResponseBody or type(envelope) is not SuppliedResponseEnvelope
                or type(expected.profile) is not str or expected.profile not in MEDIA
                or type(expected.endpoint) is not str or not public_https_source_url(expected.endpoint)
                or type(expected.max_body_bytes) is not int or not 1<=expected.max_body_bytes<=MAX_BODY_BYTES
                or not 1<=len(body)<=expected.max_body_bytes or not _utc(observed_at) or not _utc(envelope.retrieved_at)
                or envelope.retrieved_at>observed_at or type(envelope.requested_url) is not str or type(envelope.final_url) is not str
                or envelope.requested_url!=expected.endpoint or envelope.final_url!=expected.endpoint
                or type(envelope.status) is not int or envelope.status!=200
                or type(envelope.redirect_count) is not int or envelope.redirect_count!=0
                or type(envelope.relevant_headers) is not tuple or not 1<=len(envelope.relevant_headers)<=MAX_RELEVANT_HEADERS):
            raise ValueError
        values={}
        for pair in envelope.relevant_headers:
            if type(pair) is not tuple or len(pair)!=2:raise ValueError
            name,value=pair
            if (type(name) is not str or type(value) is not str or not 1<=len(name)<=32 or not name.isascii()
                    or name.lower() not in HEADERS or not value.isascii() or not 1<=len(value)<=256
                    or any(ord(c)<32 and c!='\t' or ord(c)==127 for c in value) or name.lower() in values):raise ValueError
            values[name.lower()]=value.strip(' \t')
        # Content-Encoding identity is representation coding; transfer framing
        # is a separate concern. This first profile refuses all advertised TE.
        if 'transfer-encoding' in values or values.get('content-encoding','identity').lower()!='identity':raise ValueError
        content_type=values.get('content-type','')
        media=MEDIA[expected.profile]
        pattern=re.escape(media)
        if expected.profile!='native_pdf':
            pattern+=r'(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?'
        if re.fullmatch(pattern,content_type,re.IGNORECASE|re.ASCII) is None:raise ValueError
        declared=None
        if 'content-length' in values:
            text=values['content-length']
            if re.fullmatch('[0-9]{1,20}',text,re.ASCII) is None:raise ValueError
            declared=int(text)
            if declared!=len(body) or declared>expected.max_body_bytes:raise ValueError
        digest=sha256(body).hexdigest()
        identity={'schema_version':1,'profile':expected.profile,'expected_endpoint':expected.endpoint,
            'maximum_body_bytes':expected.max_body_bytes,'requested_url':envelope.requested_url,'final_url':envelope.final_url,
            'status':envelope.status,'redirect_count':envelope.redirect_count,'relevant_headers':envelope.relevant_headers,
            'retrieved_at':envelope.retrieved_at.isoformat(timespec='microseconds'),'body_bytes':len(body),'content_sha256':digest}
        encoded=json.dumps(identity,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
        return CheckedResponseBody(body,expected.endpoint,expected.profile,media,digest,envelope.retrieved_at,declared,sha256(encoded).hexdigest())
    except Exception:
        raise ResponseEnvelopeError('fixed_response_envelope_unavailable') from None
