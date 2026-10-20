"""One injected read from two confirmed originals to private review evidence.

No connection/default transport, baseline choice, retries, SQL write, grants,
provider, source call or publication. Current source/principal/transport/clock
qualification stays with the caller. Separate input/read transactions are not
one atomic database snapshot. All returned candidate text remains unverified.
"""
from dataclasses import dataclass,field
from workers.bounded_worker_process import WorkerOutput
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.private_extraction_result import _snapshot_private_values
from workers.feed_postgres_contract import committed_pg_json,_utc,_uuid
from workers.document_result_reopen import ReopenedDocumentResult
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request
from workers.private_extraction_reopen import (ReopenedPrivateExtractionResult,
    prepare_private_extraction_reopen,parse_reopened_private_extraction)
from workers.private_extraction_report import private_extraction_review_report


class PrivateExtractionReadError(ValueError):pass


@dataclass(frozen=True)
class PrivateExtractionRead:
    reopened: ReopenedPrivateExtractionResult=field(repr=False)
    report_raw: bytes=field(repr=False)
    query_count: int=1
    evidence_state: str='invented_private_extraction_read_not_factual_acceptance'


def read_private_extraction(current,current_receipt,previous,previous_receipt,*,
        operation_id: str,maximum_output_tokens: int,query,utc_now) -> PrivateExtractionRead:
    """No supplied output object; regenerate the full request before one read."""
    try:
        (current, current_receipt, previous, previous_receipt, operation_id,
            maximum_output_tokens) = _snapshot_private_values(current, current_receipt,
                previous, previous_receipt, operation_id, maximum_output_tokens)
        if (not callable(query) or not callable(utc_now) or not _uuid(operation_id)
                or any(type(doc) is not ReopenedDocumentResult for doc in (current,previous))):
            raise ValueError
        last=None
        def tick():
            nonlocal last
            at=thaw_input(freeze_input(utc_now()))
            if (not _utc(at) or (last is not None and at<last)
                    or any(at<doc.observed_at for doc in (current,previous))):raise ValueError
            last=at;return at
        at=tick()
        pair=prepare_reopened_document_change(current,current_receipt,
            previous,previous_receipt,observed_at=at)
        request=compile_extraction_request(pair.current,pair.previous,observed_at=at,maximum_output_tokens=maximum_output_tokens)
        expected=prepare_private_extraction_reopen(current,current_receipt,
            previous,previous_receipt,request=request,operation_id=operation_id,
            maximum_output_tokens=maximum_output_tokens,observed_at=at)
        statement=expected.statement();tick()
        output=query(statement)
        output=thaw_input(freeze_input(output, (WorkerOutput,)))
        at=tick()
        if type(output) is not WorkerOutput:raise ValueError
        raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
        reopened=parse_reopened_private_extraction(raw,expected,observed_at=at)
        return PrivateExtractionRead(reopened,private_extraction_review_report(reopened))
    except Exception:
        raise PrivateExtractionReadError('private_extraction_read_unavailable') from None
