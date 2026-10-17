"""One injected full read of an independently retained preparation intent.

Caller supplies a freshly reopened complete private extraction artifact and
qualifies target, principal, transport and clock. No backend, discovery, retry,
write, capture, source/model call, factual approval or publication is provided.
Separate original/artifact/preparation transactions are not one snapshot.
"""
from dataclasses import dataclass,field
from workers.bounded_worker_process import WorkerOutput
from workers.detached_proposal_custody import DetachedPreparationIntent,intent_metadata
from workers.detached_proposal_postgres import (ReopenedStoredDetachedProposal,detached_proposal_read_statement,parse_reopened_detached_proposal)
from workers.private_extraction_reopen import ReopenedPrivateExtractionResult,parse_reopened_private_extraction
from workers.feed_postgres_contract import committed_pg_json,_utc,_parse_time


class DetachedProposalReadError(ValueError):pass


@dataclass(frozen=True)
class DetachedProposalRead:
    reopened: ReopenedStoredDetachedProposal=field(repr=False)
    query_count: int=1
    evidence_state: str='invented_historical_preparation_read_not_current_qualification_or_held_capture'


def read_detached_proposal(extraction,intent,*,query,utc_now) -> DetachedProposalRead:
    """Preflight full artifact and retained intent before one fixed SQL read."""
    try:
        if (type(extraction) is not ReopenedPrivateExtractionResult or type(intent) is not DetachedPreparationIntent
                or not callable(query) or not callable(utc_now)):raise ValueError
        metadata=intent_metadata(intent)
        confirmed=parse_reopened_private_extraction(extraction.full_receipt,extraction.request,observed_at=extraction.observed_at)
        artifact=confirmed.stored
        if (metadata['extraction_operation_id']!=artifact.operation_id or metadata['extraction_artifact_id']!=artifact.artifact_id
                or metadata['extraction_request_sha256']!=artifact.request_sha256 or metadata['extraction_output_sha256']!=artifact.output_sha256):raise ValueError
        prepared_at=_parse_time(metadata['prepared_at'])
        if prepared_at>confirmed.observed_at:raise ValueError
        last=None
        def tick():
            nonlocal last
            at=utc_now()
            if (not _utc(at) or at<confirmed.observed_at or at<prepared_at or (last is not None and at<last)):raise ValueError
            last=at;return at
        tick();statement=detached_proposal_read_statement(intent);tick()
        output=query(statement);at=tick()
        if type(output) is not WorkerOutput:raise ValueError
        raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
        return DetachedProposalRead(parse_reopened_detached_proposal(raw,intent,confirmed,observed_at=at))
    except Exception:
        raise DetachedProposalReadError('detached_proposal_read_unavailable') from None
