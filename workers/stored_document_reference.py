"""A historical stored-document candidate, never an independent trust record.

One checked feed occurrence maps to zero or one stored result. No original text,
span map, current source/recipe/association approval or baseline is supplied.
Callers locate independent trusted records before the existing reopen protocol.
"""
from dataclasses import dataclass,field
from datetime import datetime
import json
from re import fullmatch
from workers.feed_capture_reopen import ReopenRequest,_canonical,_snapshot_reopen_inputs
from workers.feed_collection_inventory import parse_collection_inventory_page
from workers.feed_stream_reader import _route
from workers.feed_postgres_contract import _utc,_parse_time,_uuid
from workers.document_passage_binding import _plain,_digest
from workers.public_source_url import public_https_source_url
from workers.closed_pair_channel import _json as strict_json
MAX_REFERENCE_OUTPUT=16384


class StoredDocumentReferenceError(ValueError):pass


@dataclass(frozen=True)
class HistoricalStoredDocumentReference:
 artifact_id: str
 operation_id: str
 outcome_revision: int
 stored_at: datetime
 source_key: str
 item_key: str
 source_version_id: str
 source_url: str
 content_sha256: str
 retrieved_at: datetime
 mapping_sha256: str
 language_code: str
 feed_capture_operation_id: str
 feed_stream_id: str
 feed_page_id: str
 feed_item_id: str
 evidence_state: str='historical_stored_document_candidate_not_independent_trust'


@dataclass(frozen=True)
class StoredDocumentReferenceObservation:
 request: ReopenRequest=field(repr=False)
 reference: HistoricalStoredDocumentReference | None
 observed_at: datetime
 evidence_state: str='invented_single_occurrence_document_reference_only'


def stored_document_reference_statement(request):
 if type(request) is not ReopenRequest:raise StoredDocumentReferenceError('stored_document_reference_request_invalid')
 return _route(request.statement(),'tf_feed_reopen.original','tf_feed_runtime.document_reference')


def parse_stored_document_reference(raw,request,*,observed_at):
 """Never infer a full binding, source history or source chronology from this."""
 try:
  try:
   raw,request,observed_at = _snapshot_reopen_inputs(raw,request,observed_at)
  except Exception:
   raise StoredDocumentReferenceError('stored_document_reference_unavailable') from None
  if type(raw) is not bytes or not 1<=len(raw)<=MAX_REFERENCE_OUTPUT or type(request) is not ReopenRequest or not _utc(observed_at):raise ValueError
  stored_document_reference_statement(request)
  inventory=parse_collection_inventory_page(request.inventory_raw,request.inventory_request,observed_at=request.inventory_observed_at)
  selected=next(item for item in inventory.rows if item.item_id==request.item_id)
  value=strict_json(raw)
  if (type(value) is not dict or set(value)!={'schema_version','kind','request','reference','observed_at'}
    or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_stored_document_reference'
    or _canonical(value['request'])!=request.canonical_input):raise ValueError
  at=_parse_time(value['observed_at'])
  if not max(selected.page_stored_at,request.inventory_observed_at)<=at<=observed_at:raise ValueError
  r=value['reference']
  if r is None:return StoredDocumentReferenceObservation(request,None,at)
  keys={'artifact_id','operation_id','outcome_revision','stored_at','source_key','item_key','source_version_id','source_url','content_sha256','retrieved_at',
   'mapping_sha256','language_code','feed_capture_operation_id','feed_stream_id','feed_page_id','feed_item_id'}
  if type(r) is not dict or set(r)!=keys:raise ValueError
  if (not all(_uuid(r[key]) for key in ['artifact_id','operation_id','source_version_id','feed_capture_operation_id','feed_stream_id','feed_page_id','feed_item_id'])
    or type(r['outcome_revision']) is not int or not 1<=r['outcome_revision']<=8
    or r['feed_capture_operation_id']!=selected.capture_operation_id or r['feed_stream_id']!=selected.stream_id
    or r['feed_page_id']!=selected.page_id or r['feed_item_id']!=selected.item_id
    or r['source_version_id']==selected.source_version_id
    or not _plain(r['source_key'],120) or fullmatch(r'fictional-[a-z0-9:-]{1,109}',r['source_key']) is None
    or not _plain(r['item_key'],120) or not _plain(r['source_url'],2048) or not public_https_source_url(r['source_url'])
    or not _digest(r['content_sha256']) or not _digest(r['mapping_sha256']) or type(r['language_code']) is not str
    or fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?',r['language_code']) is None):raise ValueError
  retrieved=_parse_time(r['retrieved_at']);stored=_parse_time(r['stored_at'])
  lower=max(selected.page_stored_at,selected.outcomes[-1].recorded_at if selected.outcomes else selected.page_stored_at)
  if not selected.source_retrieved_at<=retrieved<=stored<=at or stored<lower or selected.held_reason is not None:raise ValueError
  if selected.outcomes:
   last=selected.outcomes[-1]
   if last.state=='processed':
    if r['outcome_revision']!=last.revision or r['operation_id']!=last.operation_id:raise ValueError
   elif r['outcome_revision']<=last.revision or r['operation_id'] in {event.operation_id for event in selected.outcomes}:raise ValueError
  historical=HistoricalStoredDocumentReference(**{**r,'retrieved_at':retrieved,'stored_at':stored})
  return StoredDocumentReferenceObservation(request,historical,at)
 except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError,StopIteration):
  raise StoredDocumentReferenceError('stored_document_reference_unavailable') from None
