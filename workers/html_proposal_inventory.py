"""Historical HTML preparation metadata; explicit independent intent still needed.

A complete retained extraction pair scopes the query. No row is selected, read
in full, captured or qualified automatically. Stored metadata is not an original
prewrite witness, current issue context, authentication or editorial approval.
"""
from dataclasses import dataclass,field
from datetime import datetime
from hashlib import sha256
import base64

from workers.html_extraction_custody import HtmlExtractionReopenExpected,reopen_html_extraction
from workers.html_proposal_custody import HtmlPreparationIntent,intent_metadata
from workers.html_proposal_postgres import HtmlPreparationReopenExpected,prepare_html_preparation_reopen
from workers.private_extraction_held_proposal import _json,_instant
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,_uuid,_utc,_time,_parse_time
from workers.pair_native_sql import _literal

MAX_CANDIDATES=50
MAX_INVENTORY_OUTPUT=98304


class HtmlProposalInventoryError(ValueError):pass


@dataclass(frozen=True)
class HtmlProposalInventoryRequest:
    receipt:bytes=field(repr=False)
    extraction_expected:HtmlExtractionReopenExpected=field(repr=False)
    current_receipt:bytes=field(repr=False)
    previous_receipt:bytes=field(repr=False)
    canonical_scope:bytes=field(repr=False)
    observed_at:datetime
    def statement(self):
        try:
            request=_recheck(self);scope=strict_json(request.canonical_scope)
            op=_literal(scope['extraction_operation_id'])+'::uuid'
            sql=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;with matching as materialized (select p.operation_id,p.artifact_id,p.stored_at,p.metadata from tf_html_preparation.preparations p join tf_html_extraction.results e on e.operation_id=p.extraction_operation_id where e.operation_id="+op+" and e.artifact_id="+_literal(scope['extraction_artifact_id'])+"::uuid and encode(sha256(e.request_raw),'hex')="+_literal(scope['extraction_request_sha256'])+" and encode(sha256(e.output_raw),'hex')="+_literal(scope['extraction_output_sha256'])+" and encode(sha256(convert_to(tf_html_extraction.result_receipt("+op+")::text,'UTF8')),'hex')="+_literal(scope['extraction_full_receipt_sha256'])+" order by p.stored_at,p.operation_id limit 51) select jsonb_build_object('schema_version',1,'kind','invented_html_preparation_inventory','scope',"+_literal(request.canonical_scope.decode())+"::jsonb,'principal',current_user,'session_principal',session_user,'observed_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'candidates',coalesce((select jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'stored_at',to_char(stored_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'metadata_base64',replace(encode(metadata,'base64'),E'\\n','')) order by stored_at,operation_id) from matching),'[]'::jsonb));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
            if len(sql.encode())>294912:raise ValueError
            return sql
        except Exception:raise HtmlProposalInventoryError('html_proposal_inventory_unavailable') from None


@dataclass(frozen=True)
class HistoricalHtmlProposalCandidate:
    operation_id:str
    artifact_id:str
    intent:HtmlPreparationIntent=field(repr=False)
    prepared_at:datetime
    stored_at:datetime
    evidence_state:str='historical_html_metadata_not_full_parts_or_independent_intent'


@dataclass(frozen=True)
class HtmlProposalInventoryObservation:
    request:HtmlProposalInventoryRequest=field(repr=False)
    candidates:tuple[HistoricalHtmlProposalCandidate,...]=field(repr=False)
    full_receipt:bytes=field(repr=False)
    observed_at:datetime
    evidence_state:str='invented_html_metadata_explicit_independent_intent_required'


def prepare_html_proposal_inventory(receipt,extraction_expected,*,current_receipt,previous_receipt,observed_at):
    try:
        if not _utc(observed_at):raise ValueError
        checked=reopen_html_extraction(receipt,extraction_expected,current_receipt=current_receipt,previous_receipt=previous_receipt,observed_at=observed_at)
        request=checked.result.plan.request
        scope=_json(dict(schema_version=1,kind='invented_html_preparation_lookup_scope',extraction_operation_id=checked.operation_id,
            extraction_artifact_id=checked.artifact_id,extraction_request_sha256=request.request_sha256,
            extraction_output_sha256=sha256(checked.result.output_raw).hexdigest(),extraction_full_receipt_sha256=sha256(receipt).hexdigest()))
        return HtmlProposalInventoryRequest(receipt,extraction_expected,current_receipt,previous_receipt,scope,observed_at)
    except Exception:raise HtmlProposalInventoryError('html_proposal_inventory_unavailable') from None


def _recheck(expected):
    if type(expected) is not HtmlProposalInventoryRequest or type(expected.canonical_scope) is not bytes or not 1<=len(expected.canonical_scope)<=4096:raise ValueError
    fresh=prepare_html_proposal_inventory(expected.receipt,expected.extraction_expected,current_receipt=expected.current_receipt,previous_receipt=expected.previous_receipt,observed_at=expected.observed_at)
    if fresh!=expected:raise ValueError
    return fresh


def parse_html_proposal_inventory(raw,expected,*,observed_at):
    try:
        checked=_recheck(expected)
        if type(raw) is not bytes or not 1<=len(raw)<=MAX_INVENTORY_OUTPUT or not _utc(observed_at) or observed_at<checked.observed_at:raise ValueError
        value=strict_json(raw);scope=strict_json(checked.canonical_scope)
        if (type(value) is not dict or set(value)!=set('schema_version kind scope principal session_principal observed_at candidates'.split())
                or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_html_preparation_inventory'
                or value['principal']!='postgres' or value['session_principal']!='postgres' or _json(value['scope'])!=checked.canonical_scope
                or type(value['candidates']) is not list or len(value['candidates'])>MAX_CANDIDATES):raise ValueError
        at=_parse_time(value['observed_at'])
        if _time(at)!=value['observed_at'] or not checked.observed_at<=at<=observed_at:raise ValueError
        candidates=[];operations=set();artifacts=set();last=None
        for row in value['candidates']:
            if (type(row) is not dict or set(row)!=set('operation_id artifact_id stored_at metadata_base64'.split())
                    or not _uuid(row['operation_id']) or not _uuid(row['artifact_id']) or row['operation_id'] in operations or row['artifact_id'] in artifacts
                    or type(row['metadata_base64']) is not str or not 4<=len(row['metadata_base64'])<=5464):raise ValueError
            metadata=base64.b64decode(row['metadata_base64'],validate=True)
            if base64.b64encode(metadata).decode()!=row['metadata_base64']:raise ValueError
            intent=HtmlPreparationIntent(metadata);meta=intent_metadata(intent)
            if meta['operation_id']!=row['operation_id'] or any(meta[k]!=scope[k] for k in ('extraction_operation_id','extraction_artifact_id','extraction_request_sha256','extraction_output_sha256')):raise ValueError
            prepared=_instant(meta['prepared_at']);stored=_parse_time(row['stored_at']);position=(stored,row['operation_id'])
            if (_time(stored)!=row['stored_at'] or not checked.extraction_expected.stored_at<=prepared<=stored<=at or (last is not None and position<=last)):raise ValueError
            candidates.append(HistoricalHtmlProposalCandidate(row['operation_id'],row['artifact_id'],intent,prepared,stored))
            operations.add(row['operation_id']);artifacts.add(row['artifact_id']);last=position
        return HtmlProposalInventoryObservation(checked,tuple(candidates),raw,at)
    except Exception:raise HtmlProposalInventoryError('html_proposal_inventory_unavailable') from None


def select_html_proposal(observation,independent_intent,*,operation_id,artifact_id,observed_at)->HtmlPreparationReopenExpected:
    """No first/latest fallback; exact prewrite intent must come from the caller."""
    try:
        if type(observation) is not HtmlProposalInventoryObservation or not _uuid(operation_id) or not _uuid(artifact_id) or not _utc(observed_at) or observed_at<observation.observed_at:raise ValueError
        checked=parse_html_proposal_inventory(observation.full_receipt,observation.request,observed_at=observed_at)
        if checked!=observation:raise ValueError
        meta=intent_metadata(independent_intent)
        if meta['operation_id']!=operation_id:raise ValueError
        matches=[row for row in checked.candidates if row.operation_id==operation_id and row.artifact_id==artifact_id]
        if len(matches)!=1 or matches[0].intent.canonical_metadata!=independent_intent.canonical_metadata:raise ValueError
        row=matches[0]
        return prepare_html_preparation_reopen(intent=independent_intent,artifact_id=row.artifact_id,stored_at=row.stored_at,observed_at=observed_at)
    except Exception:raise HtmlProposalInventoryError('html_proposal_selection_unavailable') from None
