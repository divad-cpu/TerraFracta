"""Reopen invented stored document originals under independent expectations.

Stored historical source/mapping/association do not create current trust. The
caller supplies them separately; native raw + existing complete result readback
must match. No model, publication, write, source request or rights renewal.
"""
from dataclasses import dataclass,asdict,field
from datetime import datetime
import base64
import json
from workers.feed_capture_reopen import ReopenedCapture,confirm_reopened_page
from workers.feed_postgres_processing import parse_invented_pg_item_history
from workers.document_passage_binding import PlainDocumentReceipt,DocumentPassageBinding,DocumentSpanMap,bind_document_passages,MAX_DOCUMENT_BYTES
from workers.document_result_contract import (FeedDocumentAssociation,InventedDocumentResult,prepare_invented_document_result,parse_stored_invented_document_result)
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,MAX_CAPTURE_OUTPUT,_utc,_time,_parse_time,_uuid
from workers.pair_native_sql import _literal
from workers.closed_pair_channel import _json as strict_json

class DocumentReopenError(ValueError):pass

def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()

@dataclass(frozen=True)
class DocumentReopenRequest:
 feed: ReopenedCapture=field(repr=False)
 page_receipt: bytes=field(repr=False)
 history_raw: bytes=field(repr=False)
 binding: DocumentPassageBinding
 mapping: DocumentSpanMap
 association: FeedDocumentAssociation
 observed_at: datetime
 canonical_input: bytes=field(repr=False)

 def statement(self):
  if type(self.canonical_input) is not bytes:raise DocumentReopenError('document_reopen_input_invalid')
  checked=prepare_document_reopen(self.feed,self.page_receipt,self.history_raw,binding=self.binding,mapping=self.mapping,association=self.association,observed_at=self.observed_at)
  if checked!=self:raise DocumentReopenError('document_reopen_input_invalid')
  sql=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_document_reopen.original("+_literal(self.canonical_input.decode())+"::jsonb);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
  if len(sql.encode())>32768:raise DocumentReopenError('document_reopen_statement_limit')
  return sql

@dataclass(frozen=True)
class ReopenedDocumentResult:
 request: DocumentReopenRequest=field(repr=False)
 response_raw: bytes=field(repr=False)
 observed_at: datetime
 result_request: InventedDocumentResult=field(repr=False)
 artifact_id: str
 stored_at: datetime
 evidence_state: str='invented_document_original_reopened_full_result_readback_still_required'


def _current(feed,page_receipt,history_raw,at):
 confirm_reopened_page(page_receipt,feed,observed_at=at)
 history=parse_invented_pg_item_history(history_raw,feed.capture,item_id=feed.item.item_id,observed_at=at)
 if history.state!='processed' or not history.outcomes:raise ValueError
 return history.outcomes[-1]


def prepare_document_reopen(feed,page_receipt,history_raw,*,binding,mapping,association,observed_at):
 try:
  if (type(feed) is not ReopenedCapture or type(page_receipt) is not bytes or type(history_raw) is not bytes
      or type(binding) is not DocumentPassageBinding or type(mapping) is not DocumentSpanMap
      or type(association) is not FeedDocumentAssociation or not _utc(observed_at)):raise ValueError
  last=_current(feed,page_receipt,history_raw,observed_at)
  if (association!=FeedDocumentAssociation(feed.capture.operation_id,feed.item.item_id,binding.source_key,binding.item_key,
       binding.source_version_id,binding.content_sha256,binding.source_url)
      or mapping.source_version_id!=binding.source_version_id or mapping.content_sha256!=binding.content_sha256
      or mapping.mapping_sha256!=binding.mapping_sha256 or mapping.language_code!=binding.language_code
      or not _utc(binding.retrieved_at)):raise ValueError
  body=_canonical({'feed':strict_json(feed.request.canonical_input),'outcome_operation_id':last.operation_id,'outcome_revision':last.revision,
       'binding':{**asdict(binding),'retrieved_at':_time(binding.retrieved_at)},'association':asdict(association)})
  if len(body)>16384:raise ValueError
  return DocumentReopenRequest(feed,page_receipt,history_raw,binding,mapping,association,observed_at,body)
 except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError):
  raise DocumentReopenError('document_reopen_input_invalid') from None


def parse_reopened_document(raw,expected,*,observed_at):
 try:
  if type(expected) is not DocumentReopenRequest or type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at):raise ValueError
  expected.statement();value=strict_json(raw);last=_current(expected.feed,expected.page_receipt,expected.history_raw,expected.observed_at)
  if (type(value) is not dict or set(value)!={'schema_version','kind','request','raw_base64','artifact_id','stored_at','observed_at'}
      or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_document_reopened_original'
      or _canonical(value['request'])!=expected.canonical_input or not _uuid(value['artifact_id'])
      or type(value['raw_base64']) is not str or not 4<=len(value['raw_base64'])<=4*((MAX_DOCUMENT_BYTES+2)//3)):raise ValueError
  original=base64.b64decode(value['raw_base64'],validate=True)
  if not 1<=len(original)<=MAX_DOCUMENT_BYTES or base64.b64encode(original).decode()!=value['raw_base64']:raise ValueError
  stored=_parse_time(value['stored_at']);at=_parse_time(value['observed_at'])
  if not max(expected.binding.retrieved_at,last.recorded_at)<=stored<=at<=observed_at or at<expected.observed_at:raise ValueError
  b=expected.binding
  document=PlainDocumentReceipt(b.source_key,b.item_key,b.source_version_id,b.source_url,b.content_sha256,b.retrieved_at)
  # Full bytes including unselected UTF8 and every exact span are rebound.
  bind_document_passages(original,document,binding=b,mapping=expected.mapping,observed_at=observed_at)
  result=prepare_invented_document_result(expected.feed.capture,expected.page_receipt,document_raw=original,document=document,
       binding=b,mapping=expected.mapping,association=expected.association,operation_id=last.operation_id,
       expected_revision=last.revision-1,observed_at=observed_at)
  return ReopenedDocumentResult(expected,raw,observed_at,result,value['artifact_id'],stored)
 except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError):
  raise DocumentReopenError('document_reopen_observation_unavailable') from None


def confirm_reopened_document_result(raw_receipt,reopened,*,observed_at):
 try:
  if type(reopened) is not ReopenedDocumentResult or not _utc(observed_at) or observed_at<reopened.observed_at:raise ValueError
  checked=parse_reopened_document(reopened.response_raw,reopened.request,observed_at=reopened.observed_at)
  if checked!=reopened:raise ValueError
  result=parse_stored_invented_document_result(raw_receipt,reopened.result_request,observed_at=observed_at)
  if result.artifact_id!=reopened.artifact_id or result.stored_at!=reopened.stored_at:raise ValueError
  return result
 except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError):
  raise DocumentReopenError('document_reopen_result_unavailable') from None
