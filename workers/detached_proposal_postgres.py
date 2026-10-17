"""Fixed owner-only laboratory byte custody; no actual held capture or transport."""
from dataclasses import dataclass,field
from datetime import datetime
import base64
from workers.detached_proposal_custody import (DetachedProposalParts,DetachedPreparationIntent,PreparedDetachedProposal,
 ReobservedDetachedProposal,PART_LIMITS,part_bytes,intent_metadata,recheck_prepared_detached_proposal,reobserve_detached_proposal)
from workers.private_extraction_held_proposal import _json
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,MAX_CAPTURE_OUTPUT,MAX_CAPTURE_STATEMENT,_uuid,_utc,_parse_time,_time
from workers.pair_native_sql import _literal
RECEIPT_MARGIN=4096

class DetachedProposalPostgresError(ValueError):pass

@dataclass(frozen=True)
class DetachedProposalStoreRequest:
    prepared: PreparedDetachedProposal=field(repr=False)
    def statement(self):
        try:
            prepared=_recheck(self)
            args=[_literal(prepared.intent.canonical_metadata.decode('utf8'))+'::jsonb']
            args.extend("decode("+_literal(base64.b64encode(raw).decode('ascii'))+",'base64')" for raw in part_bytes(prepared.parts))
            sql=HEAD+"set time zone 'UTC';begin;select tf_detached_proposal.store_preparation("+','.join(args)+");commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
            if len(sql.encode('utf8'))>MAX_CAPTURE_STATEMENT:raise ValueError
            return sql
        except Exception:raise DetachedProposalPostgresError('detached_proposal_store_unavailable') from None

@dataclass(frozen=True)
class StoredDetachedProposal:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    evidence_state: str='invented_detached_preparation_stored_not_held_capture'

@dataclass(frozen=True)
class ReopenedStoredDetachedProposal:
    result: ReobservedDetachedProposal=field(repr=False)
    stored: StoredDetachedProposal=field(repr=False)
    full_receipt: bytes=field(repr=False)
    observed_at: datetime
    evidence_state: str='invented_reopened_detached_preparation_not_current_qualification_or_capture'


def _shape(parts,intent,*,artifact_id,stored_at):
    raw=part_bytes(parts);v=intent_metadata(intent)
    return dict(schema_version=1,kind='invented_detached_preparation_stored',operation_id=v['operation_id'],artifact_id=artifact_id,
        stored_at=_time(stored_at),input=v,**{key:base64.b64encode(value).decode('ascii') for key,value in zip(
            ('payload_base64','selection_base64','provenance_base64','context_base64'),raw)})


def prepare_detached_proposal_store(prepared):
    try:
        confirmed=recheck_prepared_detached_proposal(prepared)
        estimate=_json(_shape(confirmed.parts,confirmed.intent,artifact_id='00000000-0000-4000-8000-000000000001',stored_at=confirmed.observed_at))
        if len(estimate)+RECEIPT_MARGIN>MAX_CAPTURE_OUTPUT:raise ValueError
        return DetachedProposalStoreRequest(confirmed)
    except Exception:raise DetachedProposalPostgresError('detached_proposal_store_unavailable') from None


def _recheck(request):
    if type(request) is not DetachedProposalStoreRequest:raise ValueError
    checked=prepare_detached_proposal_store(request.prepared)
    return checked.prepared


def detached_proposal_read_statement(intent):
    try:
        v=intent_metadata(intent)
        return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_detached_proposal.preparation_receipt("+_literal(v['operation_id'])+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
    except Exception:raise DetachedProposalPostgresError('detached_proposal_read_unavailable') from None


def _receipt(raw,intent):
    if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT:raise ValueError
    v=strict_json(raw);expected=intent_metadata(intent)
    if (type(v) is not dict or set(v)!=set('schema_version kind operation_id artifact_id stored_at input payload_base64 selection_base64 provenance_base64 context_base64'.split())
            or type(v['schema_version']) is not int or v['schema_version']!=1 or v['kind']!='invented_detached_preparation_stored'
            or v['operation_id']!=expected['operation_id'] or not _uuid(v['artifact_id']) or _json(v['input'])!=intent.canonical_metadata):raise ValueError
    values=[]
    for key,limit in zip(('payload_base64','selection_base64','provenance_base64','context_base64'),PART_LIMITS):
        text=v[key]
        if type(text) is not str or not 4<=len(text)<=4*((limit+2)//3):raise ValueError
        value=base64.b64decode(text,validate=True)
        if not 1<=len(value)<=limit or base64.b64encode(value).decode('ascii')!=text:raise ValueError
        values.append(value)
    return DetachedProposalParts(*values),StoredDetachedProposal(v['operation_id'],v['artifact_id'],_parse_time(v['stored_at']))


def parse_stored_detached_proposal(raw,request,*,observed_at):
    """Warm exact store acknowledgement, not a cold original read."""
    try:
        prepared=_recheck(request)
        if not _utc(observed_at) or observed_at<prepared.observed_at:raise ValueError
        parts,stored=_receipt(raw,prepared.intent)
        if part_bytes(parts)!=part_bytes(prepared.parts) or not prepared.observed_at<=stored.stored_at<=observed_at:raise ValueError
        return stored
    except Exception:raise DetachedProposalPostgresError('detached_proposal_stored_result_unavailable') from None


def parse_reopened_detached_proposal(raw,intent,extraction,*,observed_at):
    """Fresh full artifact + four newly read parts and independent pre-write intent."""
    try:
        parts,stored=_receipt(raw,intent)
        result=reobserve_detached_proposal(extraction,parts,intent,stored_at=stored.stored_at,observed_at=observed_at)
        return ReopenedStoredDetachedProposal(result,stored,raw,observed_at)
    except Exception:raise DetachedProposalPostgresError('detached_proposal_reopened_result_unavailable') from None
