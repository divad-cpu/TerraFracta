"""Bind a private unverified output to exact offline request and two originals.

Both retained versions and full receipts are mandatory and reconfirmed on use.
The explicit original preparation time is immutable intent, not provider time;
current observation may advance when the same originals are reopened later.
No provider execution, measured usage, spending settlement, factual acceptance,
source/right/recipe trust, queue completion or publication follows from this.
"""
from dataclasses import dataclass, asdict, field
from datetime import datetime
from hashlib import sha256
import base64
import json
from workers.feed_postgres_contract import _uuid, _utc, _time
from workers.document_result_reopen import ReopenedDocumentResult, DocumentReopenRequest
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.feed_capture_reopen import ReopenedCapture, ReopenRequest
from workers.feed_collection_inventory import InventoryRequest, InventoryCut, InventoryCursor, InventoryItem
from workers.feed_window_lineage import InventedCollectionScope
from workers.feed_postgres_contract import InventedPgCapture
from workers.feed_postgres_processing import InventedPgOutcomeReceipt
from workers.feed_discovery import FeedReceipt
from workers.document_result_contract import InventedDocumentResult, FeedDocumentAssociation
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import OfflineExtractionRequest, parse_extraction_request_proposal, _REQUEST_RECORDS
from workers.model_proposal import ModelProposal

MAX_PRIVATE_RESULT_INPUT = 256 * 1024


class PrivateExtractionResultError(ValueError):
    """Fixed private refusal, without request/output/backend details."""


@dataclass(frozen=True)
class PrivateExtractionResult:
    operation_id: str
    current: ReopenedDocumentResult = field(repr=False)
    current_receipt: bytes = field(repr=False)
    previous: ReopenedDocumentResult = field(repr=False)
    previous_receipt: bytes = field(repr=False)
    request: OfflineExtractionRequest = field(repr=False)
    output_raw: bytes = field(repr=False)
    proposal: ModelProposal = field(repr=False)
    maximum_output_tokens: int
    prepared_at: datetime
    observed_at: datetime
    canonical_input: bytes = field(repr=False)
    evidence_state: str = 'offline_exact_request_output_unverified_proposal_only'


_PRIVATE_RESULT_RECORDS = _REQUEST_RECORDS + (PrivateExtractionResult,
    ReopenedDocumentResult, DocumentReopenRequest, ReopenedCapture, ReopenRequest,
    InventoryRequest, InventoryCut, InventoryCursor, InventoryItem,
    InventedCollectionScope, InventedPgCapture, InventedPgOutcomeReceipt,
    FeedReceipt, InventedDocumentResult, FeedDocumentAssociation, ModelProposal)


def _snapshot_private_values(*values):
    return thaw_input(freeze_input(values, _PRIVATE_RESULT_RECORDS))


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf8')


def _document_ref(reopened):
    expected = reopened.result_request
    return dict(operation_id=expected.operation_id, artifact_id=reopened.artifact_id,
        source_version_id=expected.binding.source_version_id, content_sha256=expected.binding.content_sha256)


def prepare_private_extraction_result(current, current_receipt, previous, previous_receipt, *,
        request, output_raw, operation_id, prepared_at, observed_at, maximum_output_tokens):
    """Reconfirm complete original evidence; never adopt a supplied proposal."""
    try:
        try:
            (current, current_receipt, previous, previous_receipt, request,
             output_raw, operation_id, prepared_at, observed_at,
             maximum_output_tokens) = _snapshot_private_values(current,
                current_receipt, previous, previous_receipt, request, output_raw,
                operation_id, prepared_at, observed_at, maximum_output_tokens)
        except Exception:
            raise PrivateExtractionResultError('private_extraction_result_unavailable') from None
        if (not _uuid(operation_id) or not _utc(observed_at) or not _utc(prepared_at)
                or prepared_at > observed_at): raise ValueError
        pair = prepare_reopened_document_change(current, current_receipt, previous, previous_receipt,
            observed_at=observed_at)
        if (prepared_at < max(current.stored_at, previous.stored_at)
                or current.result_request.operation_id == previous.result_request.operation_id
                or current.artifact_id == previous.artifact_id): raise ValueError
        proposal = parse_extraction_request_proposal(output_raw, request, current=pair.current,
            previous=pair.previous, observed_at=observed_at, maximum_output_tokens=maximum_output_tokens)
        # PostgreSQL text/JSON cannot represent U+0000. The ordinary parser still
        # owns all other source/locator/claim/Unicode/size semantics.
        if b'\x00' in request.body or proposal.review_state != 'unverified': raise ValueError
        body = _canonical(dict(schema_version=1, kind='invented_private_extraction_result',
            operation_id=operation_id, prepared_at=_time(prepared_at), current_document=_document_ref(current), previous_document=_document_ref(previous),
            request_sha256=request.request_sha256, selected_payload_sha256=request.selected_payload_sha256,
            maximum_output_tokens=maximum_output_tokens, request_base64=base64.b64encode(request.body).decode('ascii'),
            output_sha256=sha256(output_raw).hexdigest(), output_base64=base64.b64encode(output_raw).decode('ascii'),
            proposal=asdict(proposal)))
        if len(body) > MAX_PRIVATE_RESULT_INPUT: raise ValueError
        return PrivateExtractionResult(operation_id, current, current_receipt, previous, previous_receipt,
            request, output_raw, proposal, maximum_output_tokens, prepared_at, observed_at, body)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise PrivateExtractionResultError('private_extraction_result_unavailable') from None


def recheck_private_extraction_result(expected):
    try:
        if type(expected) is not PrivateExtractionResult or type(expected.canonical_input) is not bytes:
            raise ValueError
        try:
            expected, = _snapshot_private_values(expected)
        except Exception:
            raise PrivateExtractionResultError('private_extraction_result_unavailable') from None
        checked = prepare_private_extraction_result(expected.current, expected.current_receipt,
            expected.previous, expected.previous_receipt, request=expected.request, output_raw=expected.output_raw,
            operation_id=expected.operation_id, prepared_at=expected.prepared_at, observed_at=expected.observed_at,
            maximum_output_tokens=expected.maximum_output_tokens)
        if checked != expected: raise ValueError
        return checked
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise PrivateExtractionResultError('private_extraction_result_unavailable') from None
