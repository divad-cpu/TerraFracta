"""Explicit independently retained intent, metadata member and full read agree.

No newest/only-row default, automatic refresh, write, capture or source/model
operation. The caller authenticates inventory and read transport/principal.
"""
from dataclasses import dataclass,field
from workers.bounded_worker_process import WorkerOutput
from workers.detached_proposal_custody import DetachedPreparationIntent,intent_metadata
from workers.detached_proposal_inventory import (DetachedProposalInventoryRequest,HistoricalDetachedProposalCandidate,
    DetachedProposalInventoryObservation,parse_detached_proposal_inventory)
from workers.detached_proposal_reader import DetachedProposalRead,read_detached_proposal
from workers.feed_postgres_contract import committed_pg_json,_utc


class DetachedProposalSelectionError(ValueError):pass


@dataclass(frozen=True)
class SelectedDetachedProposal:
    inventory: DetachedProposalInventoryObservation=field(repr=False)
    candidate: HistoricalDetachedProposalCandidate=field(repr=False)
    read: DetachedProposalRead=field(repr=False)
    evidence_state: str='invented_explicit_retained_intent_and_full_historical_parts_still_unverified'


def read_selected_detached_proposal(inventory_output,expected,*,intent,query,utc_now):
    try:
        if (type(inventory_output) is not WorkerOutput or type(expected) is not DetachedProposalInventoryRequest
                or type(intent) is not DetachedPreparationIntent or not callable(query) or not callable(utc_now)):raise ValueError
        metadata=intent_metadata(intent);last=None
        def tick():
            nonlocal last
            at=utc_now()
            if not _utc(at) or (last is not None and at<last):raise ValueError
            last=at;return at
        at=tick();raw=committed_pg_json(inventory_output.stdout,inventory_output.stderr,inventory_output.returncode)
        inventory=parse_detached_proposal_inventory(raw,expected,observed_at=at)
        candidate=next((row for row in inventory.candidates if row.operation_id==metadata['operation_id']),None)
        if (candidate is None or candidate.intent.canonical_metadata!=intent.canonical_metadata
                or candidate.stored_at>inventory.request.extraction.observed_at):raise ValueError
        read=read_detached_proposal(inventory.request.extraction,intent,query=query,utc_now=tick)
        stored=read.reopened.stored
        if stored.artifact_id!=candidate.artifact_id or stored.stored_at!=candidate.stored_at:raise ValueError
        return SelectedDetachedProposal(inventory,candidate,read)
    except Exception:raise DetachedProposalSelectionError('detached_proposal_selection_unavailable') from None
