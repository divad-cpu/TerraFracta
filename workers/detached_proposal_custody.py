"""Lossless invented preparation custody, not a held capture or current trust.

Four exact parts include the original context spelling. Historical intent is
immutable while both full originals/output are independently reobserved. The
existing detached producer and TypeScript admission keep their contracts.
"""
from dataclasses import dataclass,field
from datetime import datetime
from hashlib import sha256
import json,re
from workers.private_extraction_held_proposal import (prepare_private_extraction_held_proposal,
    MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,MAX_PROVENANCE_BYTES,_json,_instant,_date)
from workers.private_extraction_reopen import ReopenedPrivateExtractionResult,parse_reopened_private_extraction
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import _uuid,_utc,_time

MAX_SELECTION_BYTES=2048
PART_LIMITS=(MAX_PAYLOAD_BYTES,MAX_SELECTION_BYTES,MAX_PROVENANCE_BYTES,MAX_CONTEXT_BYTES)
INTENT_FIELDS=frozenset('schema_version kind operation_id extraction_operation_id extraction_artifact_id extraction_request_sha256 extraction_output_sha256 payload_sha256 selection_sha256 provenance_sha256 context_raw_sha256 prepared_at'.split())

class DetachedProposalCustodyError(ValueError):pass

@dataclass(frozen=True)
class DetachedProposalParts:
    payload_raw: bytes=field(repr=False)
    selection_raw: bytes=field(repr=False)
    provenance_raw: bytes=field(repr=False)
    context_raw: bytes=field(repr=False)

@dataclass(frozen=True)
class DetachedPreparationIntent:
    canonical_metadata: bytes=field(repr=False)

@dataclass(frozen=True)
class PreparedDetachedProposal:
    intent: DetachedPreparationIntent=field(repr=False)
    parts: DetachedProposalParts=field(repr=False)
    extraction: ReopenedPrivateExtractionResult=field(repr=False)
    observed_at: datetime
    evidence_state: str='invented_preparation_only_not_held_capture'

@dataclass(frozen=True)
class ReobservedDetachedProposal:
    intent: DetachedPreparationIntent=field(repr=False)
    parts: DetachedProposalParts=field(repr=False)
    extraction: ReopenedPrivateExtractionResult=field(repr=False)
    prepared_at: datetime
    historical_artifact_observed_at: datetime
    stored_at: datetime
    observed_at: datetime
    evidence_state: str='invented_historical_preparation_not_current_qualification_or_capture'


def part_bytes(parts):
    if type(parts) is not DetachedProposalParts:raise ValueError
    values=(parts.payload_raw,parts.selection_raw,parts.provenance_raw,parts.context_raw)
    if any(type(raw) is not bytes or not 1<=len(raw)<=limit for raw,limit in zip(values,PART_LIMITS)):raise ValueError
    return values


def intent_metadata(intent):
    if type(intent) is not DetachedPreparationIntent or type(intent.canonical_metadata) is not bytes or not 1<=len(intent.canonical_metadata)<=4096:raise ValueError
    v=strict_json(intent.canonical_metadata)
    if (type(v) is not dict or set(v)!=INTENT_FIELDS or _json(v)!=intent.canonical_metadata
            or type(v['schema_version']) is not int or v['schema_version']!=1 or v['kind']!='invented_detached_proposal_preparation'):raise ValueError
    if any(not _uuid(v[k]) for k in ('operation_id','extraction_operation_id','extraction_artifact_id')):raise ValueError
    for key in ('extraction_request_sha256','extraction_output_sha256','payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'):
        if type(v[key]) is not str or not re.fullmatch('[a-f0-9]{64}',v[key]):raise ValueError
    _instant(v['prepared_at']);return v


def _match_parts(parts,intent):
    values=part_bytes(parts);v=intent_metadata(intent)
    if any(sha256(raw).hexdigest()!=v[key] for raw,key in zip(values,('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'))):raise ValueError
    for raw in values[:3]:
        if _json(strict_json(raw))!=raw:raise ValueError
    return v


def _metadata(operation_id,parts):
    proof=strict_json(parts.provenance_raw);a=proof['artifact']
    return DetachedPreparationIntent(_json(dict(schema_version=1,kind='invented_detached_proposal_preparation',operation_id=operation_id,
        extraction_operation_id=a['operation_id'],extraction_artifact_id=a['artifact_id'],extraction_request_sha256=a['request_sha256'],extraction_output_sha256=a['output_sha256'],
        payload_sha256=sha256(parts.payload_raw).hexdigest(),selection_sha256=sha256(parts.selection_raw).hexdigest(),
        provenance_sha256=sha256(parts.provenance_raw).hexdigest(),context_raw_sha256=sha256(parts.context_raw).hexdigest(),prepared_at=proof['prepared_at'])))


def _confirmed_extraction(extraction):
    if type(extraction) is not ReopenedPrivateExtractionResult:raise ValueError
    return parse_reopened_private_extraction(extraction.full_receipt,extraction.request,observed_at=extraction.observed_at)


def prepare_detached_proposal_custody(extraction,context_raw,*,operation_id,observed_at):
    """Pre-write stable intent, including exact original context bytes."""
    try:
        if not _uuid(operation_id) or not _utc(observed_at):raise ValueError
        extraction=_confirmed_extraction(extraction)
        proposal=prepare_private_extraction_held_proposal(extraction,context_raw,observed_at=observed_at)
        parts=DetachedProposalParts(proposal.payload_raw,proposal.selection_raw,proposal.provenance_raw,context_raw)
        part_bytes(parts);intent=_metadata(operation_id,parts);_match_parts(parts,intent)
        return PreparedDetachedProposal(intent,parts,extraction,observed_at)
    except Exception:
        raise DetachedProposalCustodyError('detached_proposal_preparation_unavailable') from None


def recheck_prepared_detached_proposal(prepared):
    try:
        if type(prepared) is not PreparedDetachedProposal:raise ValueError
        v=_match_parts(prepared.parts,prepared.intent)
        fresh=prepare_detached_proposal_custody(prepared.extraction,prepared.parts.context_raw,
            operation_id=v['operation_id'],observed_at=prepared.observed_at)
        if (part_bytes(fresh.parts)!=part_bytes(prepared.parts) or fresh.intent.canonical_metadata!=prepared.intent.canonical_metadata
                or prepared.evidence_state!=fresh.evidence_state):raise ValueError
        return fresh
    except Exception:
        raise DetachedProposalCustodyError('detached_proposal_preparation_unavailable') from None


def reobserve_detached_proposal(extraction,parts,intent,*,stored_at,observed_at):
    """Historical bytes + pre-write fingerprint, never a rewound fresh context.

    All original checks are repeated through the existing producer under the
    actual supplied fresh observation. Only its two observation-derived fields
    can differ; the old context must also satisfy its original time boundary.
    A later parse cannot invent an earlier actual observation or renew rights.
    """
    try:
        v=_match_parts(parts,intent)
        if type(extraction) is not ReopenedPrivateExtractionResult or not _utc(stored_at) or not _utc(observed_at):raise ValueError
        extraction=_confirmed_extraction(extraction)
        historical=strict_json(parts.provenance_raw);prepared_at=_instant(v['prepared_at'])
        old_observed=_instant(historical['artifact_observed_at'])
        if historical['prepared_at']!=v['prepared_at']:raise ValueError
        regenerated=prepare_private_extraction_held_proposal(extraction,parts.context_raw,observed_at=observed_at)
        current=strict_json(regenerated.provenance_raw);artifact_stored=_instant(current['artifact_stored_at']);fresh_observed=_instant(current['artifact_observed_at'])
        if not artifact_stored<=old_observed<=prepared_at<=stored_at<=fresh_observed<=observed_at:raise ValueError
        context=current['independent_context']
        if (_instant(context['held']['decided_at'])>prepared_at or _instant(context['issue']['observed_at'])>prepared_at
                or _date(context['content']['last_evidence_review_on'])>prepared_at.date()):raise ValueError
        if regenerated.payload_raw!=parts.payload_raw or regenerated.selection_raw!=parts.selection_raw:raise ValueError
        if set(historical)!=set(current):raise ValueError
        # JSON types are part of custody: Python would equate True with1.
        stable=lambda v:{k:value for k,value in v.items() if k not in ('prepared_at','artifact_observed_at')}
        if _json(stable(current))!=_json(stable(historical)):raise ValueError
        a=current['artifact']
        if (a['operation_id']!=v['extraction_operation_id'] or a['artifact_id']!=v['extraction_artifact_id']
                or a['request_sha256']!=v['extraction_request_sha256'] or a['output_sha256']!=v['extraction_output_sha256']):raise ValueError
        return ReobservedDetachedProposal(intent,parts,extraction,prepared_at,old_observed,stored_at,observed_at)
    except Exception:
        raise DetachedProposalCustodyError('detached_proposal_reobservation_unavailable') from None
