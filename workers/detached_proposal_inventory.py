"""Owner-only metadata rediscovery for one complete private extraction artifact.

No candidate is selected, read, approved or dispatched automatically. Metadata
from storage is historical; it does not replace an independently retained
pre-write intent. A subsequent full read must re-admit all four original parts.
"""
from dataclasses import dataclass,field
from datetime import datetime
from hashlib import sha256
import json
from workers.private_extraction_reopen import ReopenedPrivateExtractionResult,parse_reopened_private_extraction
from workers.detached_proposal_custody import DetachedPreparationIntent,intent_metadata
from workers.private_extraction_held_proposal import _json
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,_uuid,_utc,_time,_parse_time
from workers.pair_native_sql import _literal
MAX_CANDIDATES=50
MAX_INVENTORY_OUTPUT=98304


class DetachedProposalInventoryError(ValueError):pass


@dataclass(frozen=True)
class DetachedProposalInventoryRequest:
    extraction: ReopenedPrivateExtractionResult=field(repr=False)
    canonical_scope: bytes=field(repr=False)
    observed_at: datetime
    def statement(self):
        try:
            request=_recheck(self);scope=strict_json(request.canonical_scope)
            op=_literal(scope['extraction_operation_id'])+'::uuid'
            sql=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;with matching as materialized (select p.operation_id,p.artifact_id,p.stored_at,p.input from tf_detached_proposal.preparations p join tf_private_extraction.results e on e.operation_id=p.extraction_operation_id where e.operation_id="+op+" and e.artifact_id="+_literal(scope['extraction_artifact_id'])+"::uuid and e.input->>'request_sha256'="+_literal(scope['extraction_request_sha256'])+" and e.input->>'output_sha256'="+_literal(scope['extraction_output_sha256'])+" and encode(sha256(convert_to(tf_private_extraction.result_receipt("+op+")::text,'UTF8')),'hex')="+_literal(scope['extraction_full_receipt_sha256'])+" order by p.stored_at,p.operation_id limit 51) select jsonb_build_object('schema_version',1,'kind','invented_detached_preparation_inventory','scope',"+_literal(request.canonical_scope.decode())+"::jsonb,'principal',current_user,'observed_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'candidates',coalesce((select jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'stored_at',to_char(stored_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'input',input) order by stored_at,operation_id) from matching),'[]'::jsonb));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
            if len(sql.encode('utf8'))>294912:raise ValueError
            return sql
        except Exception:raise DetachedProposalInventoryError('detached_proposal_inventory_unavailable') from None


@dataclass(frozen=True)
class HistoricalDetachedProposalCandidate:
    operation_id: str
    artifact_id: str
    intent: DetachedPreparationIntent=field(repr=False)
    prepared_at: datetime
    stored_at: datetime
    evidence_state: str='historical_metadata_not_full_parts_or_independent_prewrite_intent'


@dataclass(frozen=True)
class DetachedProposalInventoryObservation:
    request: DetachedProposalInventoryRequest=field(repr=False)
    candidates: tuple[HistoricalDetachedProposalCandidate,...]=field(repr=False)
    observed_at: datetime
    evidence_state: str='invented_historical_metadata_explicit_independent_intent_required'


def prepare_detached_proposal_inventory(extraction,*,observed_at):
    try:
        if type(extraction) is not ReopenedPrivateExtractionResult or not _utc(observed_at):raise ValueError
        checked=parse_reopened_private_extraction(extraction.full_receipt,extraction.request,observed_at=extraction.observed_at)
        if observed_at<checked.observed_at:raise ValueError
        a=checked.stored
        scope=_json(dict(schema_version=1,kind='invented_detached_preparation_lookup_scope',extraction_operation_id=a.operation_id,
            extraction_artifact_id=a.artifact_id,extraction_request_sha256=a.request_sha256,extraction_output_sha256=a.output_sha256,
            extraction_full_receipt_sha256=sha256(checked.full_receipt).hexdigest()))
        return DetachedProposalInventoryRequest(checked,scope,observed_at)
    except Exception:raise DetachedProposalInventoryError('detached_proposal_inventory_unavailable') from None


def _recheck(expected):
    if type(expected) is not DetachedProposalInventoryRequest or type(expected.canonical_scope) is not bytes or not 1<=len(expected.canonical_scope)<=4096:raise ValueError
    rebuilt=prepare_detached_proposal_inventory(expected.extraction,observed_at=expected.observed_at)
    if rebuilt.canonical_scope!=expected.canonical_scope:raise ValueError
    return rebuilt


def parse_detached_proposal_inventory(raw,expected,*,observed_at):
    try:
        checked=_recheck(expected)
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_INVENTORY_OUTPUT or not _utc(observed_at) or observed_at<checked.observed_at:raise ValueError
        value=strict_json(raw);scope=strict_json(checked.canonical_scope)
        if (type(value) is not dict or set(value)!=set('schema_version kind scope principal observed_at candidates'.split())
                or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_detached_preparation_inventory'
                or value['principal']!='tf_feed_lab_owner' or _json(value['scope'])!=checked.canonical_scope
                or type(value['candidates']) is not list or len(value['candidates'])>MAX_CANDIDATES):raise ValueError
        at=_parse_time(value['observed_at'])
        if _time(at)!=value['observed_at'] or not checked.observed_at<=at<=observed_at:raise ValueError
        candidates=[];operations=set();artifacts=set();last=None
        for row in value['candidates']:
            if (type(row) is not dict or set(row)!=set('operation_id artifact_id stored_at input'.split()) or not _uuid(row['operation_id'])
                    or not _uuid(row['artifact_id']) or row['operation_id'] in operations or row['artifact_id'] in artifacts):raise ValueError
            intent=DetachedPreparationIntent(_json(row['input']));meta=intent_metadata(intent)
            if meta['operation_id']!=row['operation_id'] or any(meta[k]!=scope[k] for k in ('extraction_operation_id','extraction_artifact_id','extraction_request_sha256','extraction_output_sha256')):raise ValueError
            prepared=_parse_time(meta['prepared_at']);stored=_parse_time(row['stored_at']);position=(stored,row['operation_id'])
            if (_time(stored)!=row['stored_at'] or not checked.extraction.stored.stored_at<=prepared<=stored<=at or (last is not None and position<=last)):raise ValueError
            candidates.append(HistoricalDetachedProposalCandidate(row['operation_id'],row['artifact_id'],intent,prepared,stored))
            operations.add(row['operation_id']);artifacts.add(row['artifact_id']);last=position
        return DetachedProposalInventoryObservation(checked,tuple(candidates),at)
    except Exception:raise DetachedProposalInventoryError('detached_proposal_inventory_unavailable') from None
