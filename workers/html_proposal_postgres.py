"""Owner-only invented HTML preparation byte ports; no connection or capture."""
from dataclasses import dataclass,field
from datetime import datetime
import base64

from workers.html_proposal_custody import (HtmlPreparationIntent,PreparedHtmlProposal,ReobservedHtmlProposal,
    intent_metadata,_match_parts,recheck_prepared_html_proposal,reobserve_html_proposal,_PREPARATION_RECORDS)
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.detached_proposal_custody import DetachedProposalParts,part_bytes,PART_LIMITS
from workers.private_extraction_held_proposal import _json,_instant
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,MAX_CAPTURE_OUTPUT,MAX_CAPTURE_STATEMENT,_uuid,_utc,_parse_time,_time
from workers.pair_native_sql import _literal


class HtmlProposalPostgresError(ValueError):pass


@dataclass(frozen=True)
class HtmlProposalStoreRequest:
    prepared:PreparedHtmlProposal=field(repr=False)
    def statement(self):
        try:
            if type(self) is not HtmlProposalStoreRequest:raise ValueError
            expected, = _snapshot_proposal_values(self)
            return _statement(prepare_html_proposal_store(expected.prepared).prepared)
        except Exception:raise HtmlProposalPostgresError('html_proposal_store_unavailable') from None


@dataclass(frozen=True)
class StoredHtmlProposal:
    operation_id:str
    artifact_id:str
    stored_at:datetime
    evidence_state:str='invented_html_preparation_stored_not_held_capture'


@dataclass(frozen=True)
class HtmlPreparationReopenExpected:
    intent:HtmlPreparationIntent=field(repr=False)
    artifact_id:str
    stored_at:datetime
    observed_at:datetime
    def statement(self):
        try:
            if type(self) is not HtmlPreparationReopenExpected:raise ValueError
            expected, = _snapshot_proposal_values(self)
            checked=prepare_html_preparation_reopen(intent=expected.intent,artifact_id=expected.artifact_id,stored_at=expected.stored_at,observed_at=expected.observed_at)
            if expected!=checked:raise ValueError
            operation=intent_metadata(checked.intent)['operation_id']
            return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_html_preparation.preparation_receipt("+_literal(operation)+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        except Exception:raise HtmlProposalPostgresError('html_proposal_read_unavailable') from None


@dataclass(frozen=True)
class ReopenedStoredHtmlProposal:
    result:ReobservedHtmlProposal=field(repr=False)
    stored:StoredHtmlProposal=field(repr=False)
    full_receipt:bytes=field(repr=False)
    observed_at:datetime
    evidence_state:str='invented_html_reopened_preparation_not_current_qualification_or_capture'


_PROPOSAL_RECORDS = _PREPARATION_RECORDS + (HtmlProposalStoreRequest,
    StoredHtmlProposal, HtmlPreparationReopenExpected, ReopenedStoredHtmlProposal)


def _snapshot_proposal_values(*values):
    return thaw_input(freeze_input(values, _PROPOSAL_RECORDS))


def _shape(parts,intent,*,artifact_id,stored_at):
    metadata=intent_metadata(intent)
    return dict(schema_version=1,kind='invented_html_preparation_stored',operation_id=metadata['operation_id'],artifact_id=artifact_id,stored_at=_time(stored_at),
        metadata_base64=base64.b64encode(intent.canonical_metadata).decode(),**{key:base64.b64encode(raw).decode() for key,raw in zip(
            ('payload_base64','selection_base64','provenance_base64','context_base64'),part_bytes(parts))})


def _statement(prepared):
    values=(prepared.intent.canonical_metadata,*part_bytes(prepared.parts))
    operands=','.join("decode("+_literal(base64.b64encode(raw).decode('ascii'))+",'base64')" for raw in values)
    sql=HEAD+"set time zone 'UTC';begin isolation level read committed read write;select tf_html_preparation.store_preparation("+operands+");commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
    if len(sql.encode('utf8'))>MAX_CAPTURE_STATEMENT:raise ValueError
    return sql


def prepare_html_proposal_store(prepared):
    try:
        checked=recheck_prepared_html_proposal(prepared)
        estimate=_json(_shape(checked.parts,checked.intent,artifact_id='00000000-0000-4000-8000-000000000001',stored_at=checked.observed_at))
        if len(estimate)+4096>MAX_CAPTURE_OUTPUT:raise ValueError
        _statement(checked)
        return HtmlProposalStoreRequest(checked)
    except Exception:raise HtmlProposalPostgresError('html_proposal_store_unavailable') from None


def prepare_html_preparation_reopen(*,intent,artifact_id,stored_at,observed_at):
    try:
        intent, artifact_id, stored_at, observed_at = _snapshot_proposal_values(intent, artifact_id, stored_at, observed_at)
        metadata=intent_metadata(intent)
        if (not _uuid(artifact_id) or not _utc(stored_at) or not _utc(observed_at)
                or not _instant(metadata['prepared_at'])<=stored_at<=observed_at):raise ValueError
        return HtmlPreparationReopenExpected(intent,artifact_id,stored_at,observed_at)
    except Exception:raise HtmlProposalPostgresError('html_proposal_read_unavailable') from None


def _receipt(raw,intent):
    if type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT:raise ValueError
    value=strict_json(raw);metadata=intent_metadata(intent)
    if (type(value) is not dict or set(value)!=set('schema_version kind operation_id artifact_id stored_at metadata_base64 payload_base64 selection_base64 provenance_base64 context_base64'.split())
            or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_html_preparation_stored'
            or value['operation_id']!=metadata['operation_id'] or not _uuid(value['artifact_id'])):raise ValueError
    values=[]
    for key,limit in zip(('metadata_base64','payload_base64','selection_base64','provenance_base64','context_base64'),(4096,*PART_LIMITS)):
        text=value[key]
        if type(text) is not str or not 4<=len(text)<=4*((limit+2)//3):raise ValueError
        body=base64.b64decode(text,validate=True)
        if not 1<=len(body)<=limit or base64.b64encode(body).decode('ascii')!=text:raise ValueError
        values.append(body)
    if values[0]!=intent.canonical_metadata:raise ValueError
    parts=DetachedProposalParts(*values[1:]);_match_parts(parts,intent)
    return parts,StoredHtmlProposal(value['operation_id'],value['artifact_id'],_parse_time(value['stored_at']))


def parse_stored_html_proposal(raw,request,*,observed_at):
    try:
        raw, request, observed_at = _snapshot_proposal_values(raw, request, observed_at)
        if type(request) is not HtmlProposalStoreRequest:raise ValueError
        prepared=prepare_html_proposal_store(request.prepared).prepared
        parts,stored=_receipt(raw,prepared.intent)
        if (not _utc(observed_at) or not prepared.observed_at<=stored.stored_at<=observed_at
                or part_bytes(parts)!=part_bytes(prepared.parts)):raise ValueError
        return stored
    except Exception:raise HtmlProposalPostgresError('html_proposal_stored_result_unavailable') from None


def reopen_stored_html_proposal(raw,expected,*,extraction_receipt,extraction_expected,current_receipt,previous_receipt,observed_at):
    """Require independently retained preparation identity and three fresh inputs."""
    try:
        (raw, expected, extraction_receipt, extraction_expected, current_receipt,
         previous_receipt, observed_at) = _snapshot_proposal_values(raw, expected,
            extraction_receipt, extraction_expected, current_receipt, previous_receipt, observed_at)
        if type(expected) is not HtmlPreparationReopenExpected or not _utc(observed_at) or observed_at<expected.observed_at:raise ValueError
        expected.statement()
        parts,stored=_receipt(raw,expected.intent)
        if stored.artifact_id!=expected.artifact_id or stored.stored_at!=expected.stored_at:raise ValueError
        result=reobserve_html_proposal(extraction_receipt,extraction_expected,parts,expected.intent,
            current_receipt=current_receipt,previous_receipt=previous_receipt,stored_at=stored.stored_at,observed_at=observed_at)
        return ReopenedStoredHtmlProposal(result,stored,raw,observed_at)
    except Exception:raise HtmlProposalPostgresError('html_proposal_reopened_result_unavailable') from None
