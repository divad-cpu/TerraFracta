"""Invented owner-only HTML original/derivation custody, not feed processing.

Exact original and canonical metadata bytes stay separate. SQL attests byte
mechanics only; each Python receipt/reopen rederives the complete supplied HTML.
No connection, role, source/right/language trust or publication is established.
"""
from dataclasses import dataclass,asdict,field
from datetime import datetime
from hashlib import sha256
import base64
import json
import re
from urllib.parse import urlsplit

from workers.html_passage_binding import HtmlDocumentReceipt,HtmlPassageBinding,HtmlSelectionMap,BoundHtmlPassages,bind_html_passages,MAX_HTML_BYTES
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,MAX_CAPTURE_OUTPUT,MAX_CAPTURE_STATEMENT,_uuid,_utc,_time,_parse_time
from workers.pair_native_sql import _literal

MAX_HTML_METADATA_BYTES=32768
RECEIPT_MARGIN=4096
META_KEYS=frozenset('schema_version kind operation_id prepared_at document mapping adapter_identity parser_identity derivation_manifest_json derivation_manifest_sha256 snapshot'.split())
RECEIPT_KEYS=frozenset('schema_version kind operation_id artifact_id stored_at raw_base64 metadata_base64 raw_sha256 metadata_sha256 raw_bytes metadata_bytes'.split())


class HtmlOriginalCustodyError(ValueError):pass


def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf8')
def _b64(raw):return base64.b64encode(raw).decode('ascii')
def _decode(value,maximum):
    if type(value) is not str or not 4<=len(value)<=4*((maximum+2)//3):raise ValueError
    raw=base64.b64decode(value,validate=True)
    if not 1<=len(raw)<=maximum or _b64(raw)!=value:raise ValueError
    return raw


@dataclass(frozen=True)
class HtmlOriginalIntent:
    operation_id: str
    prepared_at: datetime
    canonical_metadata: bytes=field(repr=False)


@dataclass(frozen=True)
class PreparedHtmlOriginal:
    raw: bytes=field(repr=False)
    document: HtmlDocumentReceipt
    binding: HtmlPassageBinding
    mapping: HtmlSelectionMap
    intent: HtmlOriginalIntent=field(repr=False)
    observed_at: datetime
    def statement(self):
        checked=_recheck(self)
        sql=HEAD+"set time zone 'UTC';begin isolation level read committed read write;select tf_html_rehearsal.store_original(decode("+_literal(_b64(checked.intent.canonical_metadata))+",'base64'),decode("+_literal(_b64(checked.raw))+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(sql.encode('utf8'))>MAX_CAPTURE_STATEMENT:raise HtmlOriginalCustodyError('html_original_input_unavailable')
        return sql


@dataclass(frozen=True)
class StoredHtmlOriginal:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    raw: bytes=field(repr=False)
    canonical_metadata: bytes=field(repr=False)
    result: BoundHtmlPassages
    observed_at: datetime
    evidence_state: str='invented_html_original_bytes_stored_still_unqualified'


@dataclass(frozen=True)
class HtmlOriginalReopenExpected:
    intent: HtmlOriginalIntent=field(repr=False)
    document: HtmlDocumentReceipt
    binding: HtmlPassageBinding
    mapping: HtmlSelectionMap
    artifact_id: str
    stored_at: datetime
    observed_at: datetime
    def statement(self):
        checked=prepare_html_original_reopen(intent=self.intent,document=self.document,binding=self.binding,mapping=self.mapping,
            artifact_id=self.artifact_id,stored_at=self.stored_at,observed_at=self.observed_at)
        if checked!=self:raise HtmlOriginalCustodyError('html_original_reopen_unavailable')
        return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_html_rehearsal.original_receipt("+_literal(self.intent.operation_id)+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def _document(document):return {**asdict(document),'retrieved_at':_time(document.retrieved_at)}


def _scope(document,binding,mapping):
    if (type(document) is not HtmlDocumentReceipt or type(binding) is not HtmlPassageBinding or type(mapping) is not HtmlSelectionMap
            or type(document.source_key) is not str or re.fullmatch(r'fictional-[a-z0-9:-]{1,109}',document.source_key) is None
            or not _uuid(document.source_version_id) or type(document.source_url) is not str or not _utc(document.retrieved_at)):
        raise ValueError
    # Match this new laboratory fixture's literal URL dialect before SQL.
    if re.fullmatch(r'https://example[.]org/[^?#@\s]+',document.source_url) is None:raise ValueError
    url=urlsplit(document.source_url)
    if (url.scheme!='https' or url.hostname!='example.org' or url.port is not None or url.username or url.password
            or url.query or url.fragment or not url.path or len(document.source_url)>2048):raise ValueError


def _intent(intent):
    if (type(intent) is not HtmlOriginalIntent or not _uuid(intent.operation_id) or not _utc(intent.prepared_at)
            or type(intent.canonical_metadata) is not bytes or not 1<=len(intent.canonical_metadata)<=MAX_HTML_METADATA_BYTES):raise ValueError
    value=strict_json(intent.canonical_metadata)
    if (type(value) is not dict or set(value)!=META_KEYS or type(value['schema_version']) is not int or value['schema_version']!=1
            or value['kind']!='invented_html_original_intent' or value['operation_id']!=intent.operation_id
            or value['prepared_at']!=_time(intent.prepared_at) or _canonical(value)!=intent.canonical_metadata):raise ValueError
    return value


def _metadata(raw,document,binding,mapping,operation_id,prepared_at,observed_at):
    _scope(document,binding,mapping)
    if not _uuid(operation_id) or not _utc(prepared_at) or not _utc(observed_at) or not document.retrieved_at<=prepared_at<=observed_at:raise ValueError
    result=bind_html_passages(raw,document,binding=binding,mapping=mapping,observed_at=observed_at)
    value=dict(schema_version=1,kind='invented_html_original_intent',operation_id=operation_id,prepared_at=_time(prepared_at),
        document=_document(document),mapping=asdict(mapping),adapter_identity=result.adapter_identity,parser_identity=result.parser_identity,
        derivation_manifest_json=result.derivation_manifest_raw.decode('utf8'),derivation_manifest_sha256=result.derivation_manifest_sha256,
        snapshot=asdict(result.snapshot))
    return _canonical(value),result


def _receipt_shape(raw,metadata,operation):
    return dict(schema_version=1,kind='invented_html_original_stored',operation_id=operation,
        artifact_id='ffffffff-ffff-4fff-bfff-ffffffffffff',stored_at='9999-12-31T23:59:59.999999Z',
        raw_base64=_b64(raw),metadata_base64=_b64(metadata),raw_sha256=sha256(raw).hexdigest(),metadata_sha256=sha256(metadata).hexdigest(),
        raw_bytes=len(raw),metadata_bytes=len(metadata))


def prepare_html_original(raw,document,*,binding,mapping,operation_id,prepared_at,observed_at):
    try:
        metadata,_=_metadata(raw,document,binding,mapping,operation_id,prepared_at,observed_at)
        if len(metadata)>MAX_HTML_METADATA_BYTES or len(json.dumps(_receipt_shape(raw,metadata,operation_id)).encode())+RECEIPT_MARGIN>MAX_CAPTURE_OUTPUT:raise ValueError
        # Both operands are base64, so they cannot expand through SQL quote escapes.
        if len(_b64(raw))+len(_b64(metadata))+1024>MAX_CAPTURE_STATEMENT:raise ValueError
        return PreparedHtmlOriginal(raw,document,binding,mapping,HtmlOriginalIntent(operation_id,prepared_at,metadata),observed_at)
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError,RecursionError):
        raise HtmlOriginalCustodyError('html_original_input_unavailable') from None


def _recheck(expected):
    try:
        if type(expected) is not PreparedHtmlOriginal:raise ValueError
        _intent(expected.intent)
        checked=prepare_html_original(expected.raw,expected.document,binding=expected.binding,mapping=expected.mapping,
            operation_id=expected.intent.operation_id,prepared_at=expected.intent.prepared_at,observed_at=expected.observed_at)
        if checked!=expected:raise ValueError
        return checked
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError):
        raise HtmlOriginalCustodyError('html_original_input_unavailable') from None


def _read_receipt(raw,intent,document,binding,mapping,observed_at):
    if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at):raise ValueError
    value=strict_json(raw)
    if (type(value) is not dict or set(value)!=RECEIPT_KEYS or type(value['schema_version']) is not int or value['schema_version']!=1
            or value['kind']!='invented_html_original_stored' or value['operation_id']!=intent.operation_id
            or not _uuid(value['artifact_id']) or type(value['raw_bytes']) is not int or type(value['metadata_bytes']) is not int):raise ValueError
    original=_decode(value['raw_base64'],MAX_HTML_BYTES);metadata=_decode(value['metadata_base64'],MAX_HTML_METADATA_BYTES)
    if (metadata!=intent.canonical_metadata or value['raw_sha256']!=sha256(original).hexdigest()
            or value['metadata_sha256']!=sha256(metadata).hexdigest() or value['raw_bytes']!=len(original) or value['metadata_bytes']!=len(metadata)):raise ValueError
    stored=_parse_time(value['stored_at'])
    if not max(intent.prepared_at,document.retrieved_at)<=stored<=observed_at:raise ValueError
    prepared=prepare_html_original(original,document,binding=binding,mapping=mapping,operation_id=intent.operation_id,
        prepared_at=intent.prepared_at,observed_at=observed_at)
    if prepared.intent!=intent:raise ValueError
    result=bind_html_passages(original,document,binding=binding,mapping=mapping,observed_at=observed_at)
    return StoredHtmlOriginal(intent.operation_id,value['artifact_id'],stored,original,metadata,result,observed_at)


def parse_stored_html_original(raw,expected,*,observed_at):
    try:
        expected=_recheck(expected)
        if not _utc(observed_at) or observed_at<expected.observed_at:raise ValueError
        result=_read_receipt(raw,expected.intent,expected.document,expected.binding,expected.mapping,observed_at)
        if result.raw!=expected.raw:raise ValueError
        return result
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError,RecursionError):
        raise HtmlOriginalCustodyError('html_original_receipt_unavailable') from None


def prepare_html_original_reopen(*,intent,document,binding,mapping,artifact_id,stored_at,observed_at):
    try:
        value=_intent(intent);_scope(document,binding,mapping)
        if (not _uuid(artifact_id) or not _utc(stored_at) or not _utc(observed_at)
                or not document.retrieved_at<=intent.prepared_at<=stored_at<=observed_at
                or _canonical(value['document'])!=_canonical(_document(document))
                or _canonical(value['mapping'])!=_canonical(asdict(mapping))
                or any(getattr(binding,key)!=getattr(document,key) for key in ('source_key','item_key','source_version_id','source_url','content_sha256','retrieved_at'))
                or binding.mapping_sha256!=mapping.mapping_sha256 or binding.language_code!=mapping.language_code):raise ValueError
        return HtmlOriginalReopenExpected(intent,document,binding,mapping,artifact_id,stored_at,observed_at)
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError,RecursionError):
        raise HtmlOriginalCustodyError('html_original_reopen_unavailable') from None


def reopen_html_original(raw,expected,*,observed_at):
    try:
        if type(expected) is not HtmlOriginalReopenExpected:raise ValueError
        expected.statement()
        if not _utc(observed_at) or observed_at<expected.observed_at:raise ValueError
        result=_read_receipt(raw,expected.intent,expected.document,expected.binding,expected.mapping,observed_at)
        if result.artifact_id!=expected.artifact_id or result.stored_at!=expected.stored_at:raise ValueError
        return result
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError,RecursionError):
        raise HtmlOriginalCustodyError('html_original_reopen_unavailable') from None
