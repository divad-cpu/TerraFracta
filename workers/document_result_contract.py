"""Closed invented atomic original-document result/outcome protocol.

Pure request/readback mechanics. Native results are authenticated only by the
fresh owned-target custodian, not matching supplied JSON. No source association,
semantic mapping, language/rights/factual approval or publication is issued.
"""
from dataclasses import dataclass,asdict,field
from datetime import datetime
from hashlib import sha256
import base64
import json
from re import fullmatch
from urllib.parse import urlsplit

from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.feed_discovery import FeedReceipt
from workers.closed_pair_channel import _json as strict_json
from workers.document_passage_binding import (
    PlainDocumentReceipt,DocumentPassageBinding,DocumentSpanMap,DocumentByteSpan,BoundDocumentPassages,bind_document_passages,
)
from workers.feed_postgres_contract import (
    COMMIT_MARKER,HEAD,MAX_CAPTURE_STATEMENT,MAX_CAPTURE_OUTPUT,InventedPgCapture,
    _uuid,_utc,_time,_parse_time,parse_invented_pg_readback,
)
from workers.feed_postgres_processing import _event
from workers.pair_native_sql import _literal

MAX_RESULT_INPUT=256*1024
RECEIPT_MARGIN=4096


class DocumentResultContractError(ValueError):pass


@dataclass(frozen=True)
class FeedDocumentAssociation:
    # An independent trusted association, not identity inferred from a lead URL.
    feed_operation_id: str
    feed_item_id: str
    document_source_key: str
    document_item_key: str
    document_source_version_id: str
    document_content_sha256: str
    document_source_url: str


@dataclass(frozen=True)
class InventedDocumentResult:
    feed_capture: InventedPgCapture = field(repr=False)
    capture_receipt: bytes = field(repr=False)
    document_raw: bytes = field(repr=False)
    document: PlainDocumentReceipt
    binding: DocumentPassageBinding
    mapping: DocumentSpanMap
    association: FeedDocumentAssociation
    operation_id: str
    expected_revision: int
    observed_at: datetime
    canonical_input: bytes = field(repr=False)

    def statement(self):
        checked = _recheck(self)
        feed_raw=base64.b64encode(checked.feed_capture.raw).decode('ascii')
        sql=HEAD+"set time zone 'UTC';begin;select tf_feed_rehearsal.complete_document_result("+_literal(checked.canonical_input.decode('utf8'))+"::jsonb,decode("+_literal(feed_raw)+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(sql.encode('utf8'))>MAX_CAPTURE_STATEMENT:raise DocumentResultContractError('invented_document_result_input_limit')
        return sql


@dataclass(frozen=True)
class StoredInventedDocumentResult:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    outcome_operation_id: str
    outcome_revision: int
    result: BoundDocumentPassages
    evidence_state: str = 'invented_document_result_and_outcome_commit_only'


def _snapshot_document_values(*values):
    # Copy the whole parent context before any caller UTC normalization hook.
    return thaw_input(freeze_input(values, (InventedDocumentResult, InventedPgCapture,
        FeedReceipt, PlainDocumentReceipt, DocumentPassageBinding, DocumentSpanMap,
        DocumentByteSpan, FeedDocumentAssociation)))


def _recheck(expected):
    if type(expected) is not InventedDocumentResult or type(expected.canonical_input) is not bytes:raise DocumentResultContractError('invented_document_result_context_invalid')
    try:
        expected, = _snapshot_document_values(expected)
    except Exception:
        raise DocumentResultContractError('invented_document_result_context_invalid') from None
    checked=prepare_invented_document_result(expected.feed_capture,expected.capture_receipt,
        document_raw=expected.document_raw,document=expected.document,binding=expected.binding,mapping=expected.mapping,
        association=expected.association,operation_id=expected.operation_id,expected_revision=expected.expected_revision,
        observed_at=expected.observed_at)
    if checked!=expected:raise DocumentResultContractError('invented_document_result_context_invalid')
    return checked


def _stored_shape(payload,page,raw_bytes):
    # PostgreSQL JSONB's spaces/key ordering cannot add arbitrary user fields.
    # Fixed-size generated UUID/UTC fields plus an explicit margin must fit the
    # unchanged complete-output pipe before any native write is attempted.
    return {'schema_version':1,'kind':'invented_document_result_stored','operation_id':payload['operation_id'],
        'artifact_id':'ffffffff-ffff-4fff-bfff-ffffffffffff','stored_at':'9999-12-31T23:59:59.999999Z',
        'stored_raw_matches_input':True,'stored_raw_sha256':payload['document']['content_sha256'],
        'stored_raw_bytes':raw_bytes,'input':{k:v for k,v in payload.items() if k!='raw_base64'},'page':page,
        'outcome':{'operation_id':payload['operation_id'],'item_id':payload['feed_item_id'],
            'revision':payload['expected_outcome_revision']+1,'state':'processed','recorded_at':'9999-12-31T23:59:59.999999+00:00'}}


def prepare_invented_document_result(feed_capture,capture_receipt,*,document_raw,document,binding,mapping,association,
        operation_id,expected_revision,observed_at):
    try:
        try:
            (feed_capture, capture_receipt, document_raw, document, binding, mapping,
             association, operation_id, expected_revision, observed_at) = _snapshot_document_values(
                feed_capture, capture_receipt, document_raw, document, binding, mapping,
                association, operation_id, expected_revision, observed_at)
        except Exception:
            raise DocumentResultContractError('invented_document_result_input_invalid') from None
        if (not _utc(observed_at) or type(association) is not FeedDocumentAssociation or not _uuid(operation_id)
                or type(expected_revision) is not int or not 0<=expected_revision<8):raise ValueError
        page=parse_invented_pg_readback(capture_receipt,feed_capture,observed_at=observed_at)
        bound=bind_document_passages(document_raw,document,binding=binding,mapping=mapping,observed_at=observed_at)
        matches=[item for item in page.items if item.item_state_record_id==association.feed_item_id]
        actual_page=strict_json(capture_receipt)
        if (len(matches)!=1 or matches[0].processing_state!='pending' or not _uuid(document.source_version_id)
                or document.source_version_id==feed_capture.source.source_version_id
                or fullmatch(r'fictional-[a-z0-9:-]{1,109}',document.source_key) is None
                or urlsplit(document.source_url).hostname!='example.org'
                or document.retrieved_at<feed_capture.source.retrieved_at
                or association!=FeedDocumentAssociation(feed_capture.operation_id,association.feed_item_id,
                    document.source_key,document.item_key,document.source_version_id,document.content_sha256,document.source_url)):
            raise ValueError
        stored_item=next(item for item in actual_page['items'] if item['item_id']==association.feed_item_id)
        if stored_item['metadata']['url']!=document.source_url:raise ValueError
        payload={'schema_version':1,'kind':'invented_document_passage_result','adapter_identity':bound.adapter_identity,
            'operation_id':operation_id,'expected_outcome_revision':expected_revision,
            'feed_operation_id':feed_capture.operation_id,'feed_stream_id':feed_capture.stream_id,
            'feed_page_id':page.page.page_record_id,'feed_item_id':association.feed_item_id,
            'association':asdict(association),'document':{**asdict(document),'retrieved_at':_time(document.retrieved_at)},
            'mapping':asdict(mapping),'snapshot':asdict(bound.snapshot),'span_manifest_sha256':bound.span_manifest_sha256,
            'raw_base64':base64.b64encode(document_raw).decode('ascii')}
        encoded=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf8')
        # JSONB has no U+0000 representation; raw unselected bytea may contain
        # zero bytes, but never smuggle that character through JSON text fields.
        if b'\x00' in document_raw or len(encoded)>MAX_RESULT_INPUT:raise ValueError
        if len(json.dumps(_stored_shape(payload,actual_page,len(document_raw)),ensure_ascii=False).encode('utf8'))+RECEIPT_MARGIN>MAX_CAPTURE_OUTPUT:
            raise ValueError
        return InventedDocumentResult(feed_capture,capture_receipt,document_raw,document,binding,mapping,association,
            operation_id,expected_revision,observed_at,encoded)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError,StopIteration):
        raise DocumentResultContractError('invented_document_result_input_invalid') from None


def invented_document_result_read_statement(expected):
    expected = _recheck(expected)
    raw=base64.b64encode(expected.document_raw).decode('ascii');feed=base64.b64encode(expected.feed_capture.raw).decode('ascii')
    return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_feed_rehearsal.document_result_receipt("+_literal(expected.operation_id)+"::uuid,decode("+_literal(raw)+",'base64'),decode("+_literal(feed)+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def parse_stored_invented_document_result(raw,expected,*,observed_at):
    try:
        try:
            raw, expected, observed_at = _snapshot_document_values(raw, expected, observed_at)
        except Exception:
            raise DocumentResultContractError('invented_document_result_readback_invalid') from None
        expected = _recheck(expected)
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at) or observed_at<expected.observed_at:
            raise ValueError
        value=strict_json(raw);p=strict_json(expected.canonical_input)
        if (type(value) is not dict or set(value)!={'schema_version','kind','operation_id','artifact_id','stored_at',
                'stored_raw_matches_input','stored_raw_sha256','stored_raw_bytes','input','page','outcome'}
                or type(value['schema_version']) is not int or value['schema_version']!=1
                or value['kind']!='invented_document_result_stored' or value['operation_id']!=expected.operation_id
                or not _uuid(value['artifact_id']) or value['stored_raw_matches_input'] is not True
                or value['stored_raw_sha256']!=expected.document.content_sha256 or type(value['stored_raw_bytes']) is not int
                or value['stored_raw_bytes']!=len(expected.document_raw)
                or value['input']!={k:v for k,v in p.items() if k!='raw_base64'}):raise ValueError
        # Strict canonical JSON comparison also distinguishes bool/int in nested
        # span positions/schema/revisions, unlike Python's equality rules.
        if json.dumps(value['input'],sort_keys=True,separators=(',',':'),ensure_ascii=False)!=json.dumps({k:v for k,v in p.items() if k!='raw_base64'},sort_keys=True,separators=(',',':'),ensure_ascii=False):raise ValueError
        page=parse_invented_pg_readback(json.dumps(value['page'],separators=(',',':'),ensure_ascii=False).encode(),expected.feed_capture,observed_at=observed_at)
        if value['page']!=strict_json(expected.capture_receipt):raise ValueError
        event=_event(value['outcome'],item_id=expected.association.feed_item_id,page_time=max(page.page.stored_at,expected.document.retrieved_at),observed_at=observed_at)
        stored_at=_parse_time(value['stored_at'])
        if (event.operation_id!=expected.operation_id or event.revision!=expected.expected_revision+1 or event.state!='processed'
                or not max(expected.document.retrieved_at,event.recorded_at)<=stored_at<=observed_at):raise ValueError
        result=bind_document_passages(expected.document_raw,expected.document,binding=expected.binding,mapping=expected.mapping,observed_at=observed_at)
        return StoredInventedDocumentResult(expected.operation_id,value['artifact_id'],stored_at,event.operation_id,event.revision,result)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise DocumentResultContractError('invented_document_result_readback_invalid') from None
