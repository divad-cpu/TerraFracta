"""Compose seven fixed invented reads under separately supplied expectations.

The injected query transport must already authenticate the owned target and
principal and bound I/O and time before delivery. This helper checks complete
WorkerOutput/COMMIT framing, never connects, retries, scans pages, chooses a
baseline, fetches a source, calls a model, writes or grants trust. Seven separate
read transactions do not constitute one atomic database snapshot.
"""
from dataclasses import dataclass, field
from re import fullmatch
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import committed_pg_json, _utc, _uuid
from workers.feed_collection_inventory import InventoryRequest, parse_collection_inventory_page
from workers.feed_collection_reader import restricted_inventory_statement
from workers.feed_capture_reopen import prepare_capture_reopen, parse_reopened_capture, confirm_reopened_page
from workers.feed_postgres_processing import parse_invented_pg_item_history
from workers.feed_stream_reader import (stream_feed_original_statement, stream_page_statement,
    stream_history_statement, stream_document_original_statement, stream_result_statement)
from workers.stored_document_reference import (StoredDocumentReferenceObservation,
    stored_document_reference_statement, parse_stored_document_reference)
from workers.document_passage_binding import (DocumentPassageBinding, DocumentSpanMap,
    DocumentByteSpan, _plain, _digest)
from workers.document_result_contract import FeedDocumentAssociation, StoredInventedDocumentResult
from workers.document_result_reopen import (ReopenedDocumentResult, prepare_document_reopen,
    parse_reopened_document, confirm_reopened_document_result)
from workers.public_source_url import public_https_source_url
from workers.prose_passage_selection import MAX_PASSAGES


class RetainedDocumentReadError(ValueError):
    """Curated private refusal, without input, SQL or backend error details."""


class _OutsideSelectedPage(ValueError): pass


@dataclass(frozen=True)
class RetainedDocumentRead:
    status: str
    query_count: int
    reference: StoredDocumentReferenceObservation = field(repr=False)
    reopened: ReopenedDocumentResult | None = field(repr=False)
    full_receipt: bytes | None = field(repr=False)
    stored: StoredInventedDocumentResult | None = field(repr=False)
    evidence_state: str = 'invented_retained_document_read_only_not_current_trust'


def _inputs(inventory, binding, mapping, association):
    if (type(inventory) is not InventoryRequest or type(binding) is not DocumentPassageBinding
            or type(mapping) is not DocumentSpanMap or type(association) is not FeedDocumentAssociation):
        raise ValueError
    inventory.statement()  # Rebuild and compare the closed immutable request.
    if (not all(_plain(getattr(binding, k), 120) for k in ('source_key', 'item_key'))
            or fullmatch(r'fictional-[a-z0-9:-]{1,109}', binding.source_key) is None
            or not _uuid(binding.source_version_id) or not _digest(binding.content_sha256)
            or not _digest(binding.mapping_sha256) or not _plain(binding.source_url, 2048)
            or not public_https_source_url(binding.source_url) or not _utc(binding.retrieved_at)
            or type(binding.language_code) is not str
            or fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?', binding.language_code) is None
            or any(getattr(mapping, k) != getattr(binding, k) for k in
                ('source_version_id', 'content_sha256', 'mapping_sha256', 'language_code'))
            or type(mapping.spans) is not tuple or len(mapping.spans) > MAX_PASSAGES
            or any(type(span) is not DocumentByteSpan for span in mapping.spans)
            or not _uuid(association.feed_operation_id) or not _uuid(association.feed_item_id)
            or association != FeedDocumentAssociation(association.feed_operation_id, association.feed_item_id,
                binding.source_key, binding.item_key, binding.source_version_id,
                binding.content_sha256, binding.source_url)):
        raise ValueError
    # Exact byte-span semantics remain in the existing original-byte binder.


def read_retained_document(inventory: InventoryRequest, *, binding: DocumentPassageBinding,
        mapping: DocumentSpanMap, association: FeedDocumentAssociation, query, utc_now) -> RetainedDocumentRead:
    """Read one explicit page and occurrence; absent is not a baseline fallback.

    The candidate only checks the independent inputs; it never constructs them.
    A missing row is a bounded page miss, not a statement about global work.
    Confirmed results remain private and must be revalidated by later consumers.
    """
    try:
        _inputs(inventory, binding, mapping, association)
        if not callable(query) or not callable(utc_now): raise ValueError
        previous = None
        count = 0

        def tick():
            nonlocal previous
            at = utc_now()
            if not _utc(at) or at < binding.retrieved_at or (previous is not None and at < previous):
                raise ValueError
            previous = at
            return at

        def read(statement):
            nonlocal count
            tick()
            output = query(statement)
            count += 1
            at = tick()
            if type(output) is not WorkerOutput: raise ValueError
            raw = committed_pg_json(output.stdout, output.stderr, output.returncode)
            return raw, at

        raw, at = read(restricted_inventory_statement(inventory))
        page = parse_collection_inventory_page(raw, inventory, observed_at=at)
        selected = next((row for row in page.rows if row.item_id == association.feed_item_id), None)
        if selected is None: raise _OutsideSelectedPage
        if (selected.capture_operation_id != association.feed_operation_id
                or selected.source_version_id == binding.source_version_id
                or selected.source_retrieved_at > binding.retrieved_at):
            raise ValueError
        request = prepare_capture_reopen(inventory, raw, observed_at=at, item_id=association.feed_item_id)
        raw, at = read(stored_document_reference_statement(request))
        reference = parse_stored_document_reference(raw, request, observed_at=at)
        candidate = reference.reference
        if candidate is None:
            return RetainedDocumentRead('absent_for_selected_occurrence', count, reference, None, None, None)
        if (any(getattr(candidate, k) != getattr(binding, k) for k in
                ('source_key', 'item_key', 'source_version_id', 'source_url', 'content_sha256',
                    'mapping_sha256', 'language_code', 'retrieved_at'))
                or candidate.feed_capture_operation_id != association.feed_operation_id
                or candidate.feed_item_id != association.feed_item_id):
            raise ValueError
        raw, at = read(stream_feed_original_statement(request))
        feed = parse_reopened_capture(raw, request, observed_at=at)
        page_raw, at = read(stream_page_statement(feed.capture))
        confirm_reopened_page(page_raw, feed, observed_at=at)
        history_raw, at = read(stream_history_statement(feed.capture, association.feed_item_id))
        history = parse_invented_pg_item_history(history_raw, feed.capture,
            item_id=association.feed_item_id, observed_at=at)
        if (history.state != 'processed' or not history.outcomes
                or history.outcomes[-1].operation_id != candidate.operation_id
                or history.revision != candidate.outcome_revision):
            raise ValueError
        document_request = prepare_document_reopen(feed, page_raw, history_raw,
            binding=binding, mapping=mapping, association=association, observed_at=at)
        raw, at = read(stream_document_original_statement(document_request))
        reopened = parse_reopened_document(raw, document_request, observed_at=at)
        if reopened.artifact_id != candidate.artifact_id or reopened.stored_at != candidate.stored_at:
            raise ValueError
        receipt, at = read(stream_result_statement(reopened.result_request))
        stored = confirm_reopened_document_result(receipt, reopened, observed_at=at)
        if (stored.operation_id != candidate.operation_id or stored.outcome_operation_id != candidate.operation_id
                or stored.outcome_revision != candidate.outcome_revision or stored.artifact_id != candidate.artifact_id
                or stored.stored_at != candidate.stored_at):
            raise ValueError
        return RetainedDocumentRead('confirmed_original_and_complete_result', count, reference, reopened, receipt, stored)
    except _OutsideSelectedPage:
        raise RetainedDocumentReadError('retained_document_outside_selected_page') from None
    except Exception:
        raise RetainedDocumentReadError('retained_document_read_unavailable') from None
