"""Explicit metadata choice must match the subsequently reopened full artifact.

The inventory and artifact transport must already authenticate the same target
and principal. Matching supplied bytes do not authenticate storage or renew
rights. No default candidate/transport, query retry, provider/source call, write,
SQL/grant, hold decision or publication. All returned proposal text is unverified.
"""
from dataclasses import dataclass,field
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import committed_pg_json,_uuid,_utc
from workers.private_extraction_inventory import (PrivateExtractionInventoryRequest,
    PrivateExtractionInventoryObservation,HistoricalPrivateExtractionCandidate,parse_private_extraction_inventory)
from workers.private_extraction_reader import PrivateExtractionRead,read_private_extraction


class PrivateExtractionSelectionError(ValueError):pass


@dataclass(frozen=True)
class SelectedPrivateExtraction:
    inventory: PrivateExtractionInventoryObservation=field(repr=False)
    candidate: HistoricalPrivateExtractionCandidate=field(repr=False)
    read: PrivateExtractionRead=field(repr=False)
    evidence_state: str='invented_explicit_metadata_choice_and_full_artifact_still_unverified'


def read_selected_private_extraction(inventory_output: WorkerOutput,expected: PrivateExtractionInventoryRequest,*,
        operation_id: str,query,utc_now) -> SelectedPrivateExtraction:
    """An explicit member only; compare metadata to actual full stored bytes."""
    try:
        if (type(inventory_output) is not WorkerOutput or type(expected) is not PrivateExtractionInventoryRequest
                or not _uuid(operation_id) or not callable(query) or not callable(utc_now)):raise ValueError
        previous=None
        def tick():
            nonlocal previous
            at=utc_now()
            if not _utc(at) or (previous is not None and at<previous):raise ValueError
            previous=at;return at
        at=tick()
        raw=committed_pg_json(inventory_output.stdout,inventory_output.stderr,inventory_output.returncode)
        inventory=parse_private_extraction_inventory(raw,expected,observed_at=at)
        candidate=next((row for row in inventory.candidates if row.operation_id==operation_id),None)
        if candidate is None:raise ValueError
        read=read_private_extraction(expected.current,expected.current_receipt,expected.previous,expected.previous_receipt,
            operation_id=operation_id,maximum_output_tokens=expected.maximum_output_tokens,query=query,utc_now=tick)
        result=read.reopened
        if (result.stored.operation_id!=candidate.operation_id or result.stored.artifact_id!=candidate.artifact_id
                or result.stored.output_sha256!=candidate.output_sha256 or result.result.prepared_at!=candidate.prepared_at
                or result.stored.stored_at!=candidate.stored_at):raise ValueError
        return SelectedPrivateExtraction(inventory,candidate,read)
    except Exception:
        raise PrivateExtractionSelectionError('private_extraction_selection_unavailable') from None
