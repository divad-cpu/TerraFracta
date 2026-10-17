"""Keep a full offline request and its output ceiling together through planning.

This adds no dispatch, provider qualification, tokenizer or durable budget. It
reuses the existing document/passage/source/rights/position/budget decisions.
"""
from dataclasses import dataclass
from datetime import datetime

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.document_dispatch_plan import DocumentChangeRequest, DocumentDispatchPlan, plan_document_dispatch
from workers.model_cost_budget import BudgetSnapshot, ModelPrice, MAX_TOKEN_LIMIT
from workers.passage_extraction_request import (
    OfflineExtractionRequest, FullRequestTokenLimit, ExtractionRequestError, bind_full_request_token_limit,
)
from workers.passage_model_plan import PassageSourceBinding
from workers.update_request_identity import MAX_ITEMS


class ExtractionDispatchError(ValueError):
    """The batch cannot be scoped to independent work identities."""


@dataclass(frozen=True)
class ExtractionRequestRefusal:
    item_key: str
    reason_code: str


@dataclass(frozen=True)
class OfflineExtractionDispatchPlan:
    documents: DocumentDispatchPlan
    requests: tuple[OfflineExtractionRequest, ...]
    request_refusals: tuple[ExtractionRequestRefusal, ...]
    evidence_state: str = 'offline_full_request_dispatch_plan_only'


def _indexed(values, expected_type, keys):
    if type(values) is not tuple or len(values) > MAX_ITEMS:
        raise ExtractionDispatchError('extraction_dispatch_scope_invalid')
    indexed = {}
    for value in values:
        if (type(value) is not expected_type or type(value.item_key) is not str
                or value.item_key not in keys or value.item_key in indexed):
            raise ExtractionDispatchError('extraction_dispatch_scope_invalid')
        indexed[value.item_key] = value
    return indexed


def plan_extraction_request_dispatch(items: tuple[CapturedWorkItem, ...], routing_limits: RoutingLimits, *,
        documents: tuple[DocumentChangeRequest, ...], requests: tuple[OfflineExtractionRequest, ...],
        token_limits: tuple[FullRequestTokenLimit, ...], source_bindings: tuple[PassageSourceBinding, ...],
        maximum_output_tokens: int, price: ModelPrice, budget: BudgetSnapshot,
        observed_at: datetime) -> OfflineExtractionDispatchPlan:
    """A stale or missing envelope cannot gain whole-item input or a reservation.

    Scope errors fail the batch before planning; an invalid in-scope request or
    assertion withholds only its own token proof. Original unchanged/structured/
    source-denied/duplicate/over-limit decisions remain authoritative. Returned
    requests correspond only to actual offline reserved candidates. Their input
    bounds are caller assertions, not measurements of any provider request.
    """
    if (type(items) is not tuple or len(items) > MAX_ITEMS
            or any(type(item) is not CapturedWorkItem or type(item.item_key) is not str for item in items)
            or type(maximum_output_tokens) is not int or not 1 <= maximum_output_tokens <= MAX_TOKEN_LIMIT):
        raise ExtractionDispatchError('extraction_dispatch_scope_invalid')
    keys = {item.item_key for item in items}
    captured = _indexed(documents, DocumentChangeRequest, keys)
    compiled = _indexed(requests, OfflineExtractionRequest, keys)
    proofs = _indexed(token_limits, FullRequestTokenLimit, keys)
    adapted = []; accepted = {}; refusals = []
    # Envelope/proof rows without a document cannot secretly select different
    # bytes. They are in-scope but unavailable; the old document hold decides.
    for key in dict.fromkeys(item.item_key for item in items):
        document = captured.get(key); request = compiled.get(key); proof = proofs.get(key)
        if document is None or request is None or proof is None:
            if document is not None or request is not None or proof is not None:
                refusals.append(ExtractionRequestRefusal(key, 'extraction_request_or_proof_missing'))
            continue
        try:
            adapted.append(bind_full_request_token_limit(request, current=document.current,
                previous=document.previous, observed_at=observed_at,
                maximum_output_tokens=maximum_output_tokens, proof=proof))
        except ExtractionRequestError:
            refusals.append(ExtractionRequestRefusal(key, 'extraction_request_or_proof_mismatch'))
            continue
        accepted[key] = request
    planned = plan_document_dispatch(items, routing_limits, documents=documents,
        source_bindings=source_bindings, token_limits=tuple(adapted),
        output_token_limit_per_call=maximum_output_tokens, price=price, budget=budget, observed_at=observed_at)
    reserved = tuple(accepted[item.item_key] for item in planned.passages.dispatch.items
                     if item.disposition == 'reserved_model_candidate')
    return OfflineExtractionDispatchPlan(planned, reserved, tuple(refusals))
