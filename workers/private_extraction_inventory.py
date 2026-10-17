"""Bounded owner metadata rediscovery for one exact confirmed document pair.

Historical candidates are not trusted bindings, facts, source rights, provider
usage or permission to dispatch again. Even one match requires explicit later
choice and full artifact reopening. Routine invented storage holds at most50;
51 rows refuse the entire observation. No schema/function/grant/runner changes.
"""
from dataclasses import dataclass,field
from datetime import datetime
import base64
from re import fullmatch
from workers.document_result_reopen import ReopenedDocumentResult
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import OfflineExtractionRequest,compile_extraction_request
from workers.private_extraction_result import _canonical,_document_ref
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,_uuid,_utc,_time,_parse_time
from workers.closed_pair_channel import _json as strict_json
from workers.pair_native_sql import _literal
MAX_CANDIDATES=50
MAX_INVENTORY_OUTPUT=32768
MAX_INVENTORY_STATEMENT=294912


class PrivateExtractionInventoryError(ValueError):pass


@dataclass(frozen=True)
class PrivateExtractionInventoryRequest:
    current: ReopenedDocumentResult=field(repr=False)
    current_receipt: bytes=field(repr=False)
    previous: ReopenedDocumentResult=field(repr=False)
    previous_receipt: bytes=field(repr=False)
    request: OfflineExtractionRequest=field(repr=False)
    maximum_output_tokens: int
    observed_at: datetime
    canonical_scope: bytes=field(repr=False)

    def statement(self):
        try:
            _recheck(self)
            scope=strict_json(self.canonical_scope)
            current=scope['current_document'];previous=scope['previous_document']
            sql=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;with matching as materialized (select operation_id,artifact_id,stored_at,input->>'prepared_at' as prepared_at,encode(sha256(output_raw),'hex') as output_sha256 from tf_private_extraction.results where current_document_operation_id="+_literal(current['operation_id'])+"::uuid and previous_document_operation_id="+_literal(previous['operation_id'])+"::uuid and input->'current_document'="+_literal(_canonical(current).decode())+"::jsonb and input->'previous_document'="+_literal(_canonical(previous).decode())+"::jsonb and request_raw=decode("+_literal(base64.b64encode(self.request.body).decode('ascii'))+",'base64') order by stored_at,operation_id limit 51) select jsonb_build_object('schema_version',1,'kind','invented_private_extraction_inventory','scope',"+_literal(self.canonical_scope.decode())+"::jsonb,'principal',current_user,'observed_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'candidates',coalesce((select jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'prepared_at',prepared_at,'stored_at',to_char(stored_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'output_sha256',output_sha256) order by stored_at,operation_id) from matching),'[]'::jsonb));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
            if len(sql.encode())>MAX_INVENTORY_STATEMENT:raise ValueError
            return sql
        except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
            raise PrivateExtractionInventoryError('private_extraction_inventory_unavailable') from None


@dataclass(frozen=True)
class HistoricalPrivateExtractionCandidate:
    operation_id: str
    artifact_id: str
    prepared_at: datetime
    stored_at: datetime
    output_sha256: str
    evidence_state: str='historical_candidate_not_full_artifact_or_dispatch_authority'


@dataclass(frozen=True)
class PrivateExtractionInventoryObservation:
    request: PrivateExtractionInventoryRequest=field(repr=False)
    candidates: tuple[HistoricalPrivateExtractionCandidate,...]=field(repr=False)
    observed_at: datetime
    evidence_state: str='invented_exact_pair_request_matches_only_explicit_choice_required'


def prepare_private_extraction_inventory(current,current_receipt,previous,previous_receipt,*,maximum_output_tokens,observed_at):
    try:
        if (not _utc(observed_at) or any(type(doc) is not ReopenedDocumentResult for doc in (current,previous))
                or any(observed_at<doc.observed_at for doc in (current,previous))):raise ValueError
        pair=prepare_reopened_document_change(current,current_receipt,previous,previous_receipt,observed_at=observed_at)
        if current.result_request.operation_id==previous.result_request.operation_id or current.artifact_id==previous.artifact_id:raise ValueError
        request=compile_extraction_request(pair.current,pair.previous,observed_at=observed_at,maximum_output_tokens=maximum_output_tokens)
        scope=_canonical(dict(schema_version=1,kind='invented_private_extraction_lookup_scope',
            current_document=_document_ref(current),previous_document=_document_ref(previous),
            request_sha256=request.request_sha256,selected_payload_sha256=request.selected_payload_sha256,
            maximum_output_tokens=maximum_output_tokens))
        if len(scope)>4096:raise ValueError
        return PrivateExtractionInventoryRequest(current,current_receipt,previous,previous_receipt,request,maximum_output_tokens,observed_at,scope)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise PrivateExtractionInventoryError('private_extraction_inventory_unavailable') from None


def _recheck(expected):
    if type(expected) is not PrivateExtractionInventoryRequest or type(expected.canonical_scope) is not bytes:raise ValueError
    request=expected.request
    if (type(request) is not OfflineExtractionRequest or type(request.body) is not bytes
            or type(request.maximum_output_tokens) is not int
            or any(type(getattr(request,k)) is not str for k in
                ('item_key','request_sha256','selected_payload_sha256','evidence_state'))):raise ValueError
    rebuilt=prepare_private_extraction_inventory(expected.current,expected.current_receipt,expected.previous,expected.previous_receipt,
        maximum_output_tokens=expected.maximum_output_tokens,observed_at=expected.observed_at)
    if rebuilt!=expected:raise ValueError


def parse_private_extraction_inventory(raw,expected,*,observed_at):
    try:
        _recheck(expected)
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_INVENTORY_OUTPUT or not _utc(observed_at) or observed_at<expected.observed_at:raise ValueError
        value=strict_json(raw)
        if (type(value) is not dict or set(value)!={'schema_version','kind','scope','principal','observed_at','candidates'}
                or type(value['schema_version']) is not int or value['schema_version']!=1
                or value['kind']!='invented_private_extraction_inventory' or value['principal']!='tf_feed_lab_owner'
                or _canonical(value['scope'])!=expected.canonical_scope
                or type(value['candidates']) is not list or len(value['candidates'])>MAX_CANDIDATES):raise ValueError
        at=_parse_time(value['observed_at'])
        if _time(at)!=value['observed_at'] or not expected.observed_at<=at<=observed_at:raise ValueError
        candidates=[];operations=set();artifacts=set();last=None
        for row in value['candidates']:
            if (type(row) is not dict or set(row)!={'operation_id','artifact_id','prepared_at','stored_at','output_sha256'}
                    or not _uuid(row['operation_id']) or not _uuid(row['artifact_id'])
                    or row['operation_id'] in operations or row['artifact_id'] in artifacts
                    or type(row['output_sha256']) is not str or fullmatch('[a-f0-9]{64}',row['output_sha256']) is None):raise ValueError
            prepared=_parse_time(row['prepared_at']);stored=_parse_time(row['stored_at']);position=(stored,row['operation_id'])
            if (_time(prepared)!=row['prepared_at'] or _time(stored)!=row['stored_at']
                    or not max(expected.current.stored_at,expected.previous.stored_at)<=prepared<=stored<=at
                    or (last is not None and position<=last)):raise ValueError
            candidates.append(HistoricalPrivateExtractionCandidate(row['operation_id'],row['artifact_id'],prepared,stored,row['output_sha256']))
            operations.add(row['operation_id']);artifacts.add(row['artifact_id']);last=position
        return PrivateExtractionInventoryObservation(expected,tuple(candidates),at)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise PrivateExtractionInventoryError('private_extraction_inventory_unavailable') from None
