"""Exact detached HTML preparation intent; no durable store or held capture.

Reuses the existing four opaque preparation parts and byte bounds, never the
plain-document extraction type. Reobservation preserves historical context and
provenance while rederiving both full HTML originals and the exact stored output.
"""
from dataclasses import dataclass,field
from datetime import datetime
from hashlib import sha256

from workers.html_extraction_custody import HtmlExtractionReopenExpected, _CUSTODY_RECORDS
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.html_extraction_held_proposal import prepare_html_extraction_held_proposal
from workers.detached_proposal_custody import DetachedProposalParts,part_bytes
from workers.private_extraction_held_proposal import _json,_instant,_date
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import _uuid,_utc

INTENT_FIELDS=frozenset('schema_version kind operation_id extraction_operation_id extraction_artifact_id extraction_request_sha256 extraction_output_sha256 payload_sha256 selection_sha256 provenance_sha256 context_raw_sha256 prepared_at'.split())


class HtmlProposalCustodyError(ValueError):pass


@dataclass(frozen=True)
class HtmlPreparationIntent:
    canonical_metadata:bytes=field(repr=False)


@dataclass(frozen=True)
class PreparedHtmlProposal:
    intent:HtmlPreparationIntent=field(repr=False)
    parts:DetachedProposalParts=field(repr=False)
    receipt:bytes=field(repr=False)
    extraction_expected:HtmlExtractionReopenExpected=field(repr=False)
    current_receipt:bytes=field(repr=False)
    previous_receipt:bytes=field(repr=False)
    observed_at:datetime
    evidence_state:str='invented_html_preparation_only_not_stored_or_captured'


@dataclass(frozen=True)
class ReobservedHtmlProposal:
    intent:HtmlPreparationIntent=field(repr=False)
    parts:DetachedProposalParts=field(repr=False)
    prepared_at:datetime
    historical_artifact_observed_at:datetime
    stored_at:datetime
    observed_at:datetime
    evidence_state:str='invented_html_historical_preparation_not_current_qualification_or_capture'


_PREPARATION_RECORDS = _CUSTODY_RECORDS + (DetachedProposalParts,
    HtmlPreparationIntent, PreparedHtmlProposal, ReobservedHtmlProposal)


def _snapshot_preparation_values(*values):
    return thaw_input(freeze_input(values, _PREPARATION_RECORDS))


def intent_metadata(intent):
    if type(intent) is not HtmlPreparationIntent or type(intent.canonical_metadata) is not bytes or not 1<=len(intent.canonical_metadata)<=4096:raise ValueError
    value=strict_json(intent.canonical_metadata)
    if (type(value) is not dict or set(value)!=INTENT_FIELDS or _json(value)!=intent.canonical_metadata
            or type(value['schema_version']) is not int or value['schema_version']!=1 or value['kind']!='invented_detached_html_proposal_preparation'):raise ValueError
    if any(not _uuid(value[k]) for k in ('operation_id','extraction_operation_id','extraction_artifact_id')):raise ValueError
    from re import fullmatch
    if any(type(value[k]) is not str or fullmatch('[a-f0-9]{64}',value[k]) is None for k in
            ('extraction_request_sha256','extraction_output_sha256','payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256')):raise ValueError
    _instant(value['prepared_at']);return value


def _match_parts(parts,intent):
    values=part_bytes(parts);metadata=intent_metadata(intent)
    for raw,key in zip(values,('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256')):
        if sha256(raw).hexdigest()!=metadata[key]:raise ValueError
    for raw in values[:3]:
        if _json(strict_json(raw))!=raw:raise ValueError
    return metadata


def _metadata(operation_id,parts):
    proof=strict_json(parts.provenance_raw);artifact=proof['artifact']
    return HtmlPreparationIntent(_json(dict(schema_version=1,kind='invented_detached_html_proposal_preparation',operation_id=operation_id,
        extraction_operation_id=artifact['operation_id'],extraction_artifact_id=artifact['artifact_id'],extraction_request_sha256=artifact['request_sha256'],extraction_output_sha256=artifact['output_sha256'],
        payload_sha256=sha256(parts.payload_raw).hexdigest(),selection_sha256=sha256(parts.selection_raw).hexdigest(),
        provenance_sha256=sha256(parts.provenance_raw).hexdigest(),context_raw_sha256=sha256(parts.context_raw).hexdigest(),prepared_at=proof['prepared_at'])))


def prepare_html_proposal_custody(receipt,extraction_expected,context_raw,*,current_receipt,previous_receipt,operation_id,observed_at):
    """Bind prewrite intent and four exact parts; no store operation selected."""
    try:
        receipt, extraction_expected, context_raw, current_receipt, previous_receipt, operation_id, observed_at = _snapshot_preparation_values(
            receipt, extraction_expected, context_raw, current_receipt, previous_receipt, operation_id, observed_at)
        if not _uuid(operation_id) or not _utc(observed_at):raise ValueError
        candidate=prepare_html_extraction_held_proposal(receipt,extraction_expected,context_raw,
            current_receipt=current_receipt,previous_receipt=previous_receipt,observed_at=observed_at)
        parts=DetachedProposalParts(candidate.payload_raw,candidate.selection_raw,candidate.provenance_raw,candidate.context_raw)
        part_bytes(parts);intent=_metadata(operation_id,parts);_match_parts(parts,intent)
        return PreparedHtmlProposal(intent,parts,receipt,extraction_expected,current_receipt,previous_receipt,observed_at)
    except Exception:
        raise HtmlProposalCustodyError('html_proposal_preparation_unavailable') from None


def recheck_prepared_html_proposal(prepared):
    try:
        if type(prepared) is not PreparedHtmlProposal:raise ValueError
        prepared, = _snapshot_preparation_values(prepared)
        metadata=_match_parts(prepared.parts,prepared.intent)
        fresh=prepare_html_proposal_custody(prepared.receipt,prepared.extraction_expected,prepared.parts.context_raw,
            current_receipt=prepared.current_receipt,previous_receipt=prepared.previous_receipt,
            operation_id=metadata['operation_id'],observed_at=prepared.observed_at)
        if fresh!=prepared:raise ValueError
        return fresh
    except Exception:
        raise HtmlProposalCustodyError('html_proposal_preparation_unavailable') from None


def reobserve_html_proposal(receipt,extraction_expected,parts,intent,*,current_receipt,previous_receipt,stored_at,observed_at):
    """Full fresh receipts do not renew old context, rights, support or work."""
    try:
        (receipt, extraction_expected, parts, intent, current_receipt,
         previous_receipt, stored_at, observed_at) = _snapshot_preparation_values(
            receipt, extraction_expected, parts, intent, current_receipt,
            previous_receipt, stored_at, observed_at)
        metadata=_match_parts(parts,intent)
        if not _utc(stored_at) or not _utc(observed_at):raise ValueError
        historical=strict_json(parts.provenance_raw);prepared_at=_instant(metadata['prepared_at'])
        old_observed=_instant(historical['artifact_observed_at'])
        if historical['prepared_at']!=metadata['prepared_at']:raise ValueError
        regenerated=prepare_html_extraction_held_proposal(receipt,extraction_expected,parts.context_raw,
            current_receipt=current_receipt,previous_receipt=previous_receipt,observed_at=observed_at)
        current=strict_json(regenerated.provenance_raw)
        artifact_stored=_instant(current['artifact_stored_at']);fresh_observed=_instant(current['artifact_observed_at'])
        if not artifact_stored<=old_observed<=prepared_at<=stored_at<=fresh_observed<=observed_at:raise ValueError
        context=current['independent_context']
        if (_instant(context['held']['decided_at'])>prepared_at or _instant(context['issue']['observed_at'])>prepared_at
                or _date(context['content']['last_evidence_review_on'])>prepared_at.date()):raise ValueError
        if regenerated.payload_raw!=parts.payload_raw or regenerated.selection_raw!=parts.selection_raw:raise ValueError
        if set(historical)!=set(current):raise ValueError
        stable=lambda value:{key:item for key,item in value.items() if key not in ('prepared_at','artifact_observed_at')}
        if _json(stable(current))!=_json(stable(historical)):raise ValueError
        artifact=current['artifact']
        if any(artifact[key]!=metadata['extraction_'+key] for key in ('operation_id','artifact_id','request_sha256','output_sha256')):raise ValueError
        return ReobservedHtmlProposal(intent,parts,prepared_at,old_observed,stored_at,observed_at)
    except Exception:
        raise HtmlProposalCustodyError('html_proposal_reobservation_unavailable') from None
