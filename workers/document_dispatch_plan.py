"""Join full original-document comparisons to the existing offline batch plan.

A bad comparison withholds that item's passage input. Existing source/rights,
route/hash/item/token/budget rules decide actual dispositions independently.
No fallback to whole-source paid work, provider request, storage or publication.
"""
from workers.dispatch_input_snapshot import scalar_record, scalar_records, freeze_input, thaw_input
from workers.document_passage_binding import PlainDocumentReceipt, DocumentPassageBinding, DocumentSpanMap, DocumentByteSpan
from dataclasses import dataclass
from datetime import datetime

from workers.change_work_router import CapturedWorkItem,RoutingLimits
from workers.document_passage_comparison import (
    DocumentPassageCapture,DocumentPassageComparison,DocumentComparisonError,compare_document_passages,
)
from workers.model_cost_budget import BudgetSnapshot,ModelPrice
from workers.passage_model_plan import (
    PassageDispatchPlan,PassageSourceBinding,PassageTokenLimit,plan_passage_model_dispatch,
)
from workers.update_request_identity import MAX_ITEMS


class DocumentDispatchError(ValueError):pass


@dataclass(frozen=True)
class DocumentChangeRequest:
    item_key: str
    current: DocumentPassageCapture
    previous: DocumentPassageCapture | None = None


@dataclass(frozen=True)
class ItemDocumentComparison:
    item_key: str
    comparison: DocumentPassageComparison


@dataclass(frozen=True)
class DocumentComparisonRefusal:
    item_key: str
    reason_code: str = 'document_comparison_unavailable'


@dataclass(frozen=True)
class DocumentDispatchPlan:
    passages: PassageDispatchPlan
    comparisons: tuple[ItemDocumentComparison,...]
    comparison_refusals: tuple[DocumentComparisonRefusal,...]
    evidence_state: str = 'offline_document_dispatch_plan_only'


def plan_document_dispatch(items: tuple[CapturedWorkItem,...],routing_limits: RoutingLimits,*,
        documents: tuple[DocumentChangeRequest,...],source_bindings: tuple[PassageSourceBinding,...],
        token_limits: tuple[PassageTokenLimit,...],output_token_limit_per_call: int | None,
        price: ModelPrice,budget: BudgetSnapshot,observed_at: datetime):
    """Do not let one invalid document silently erase another item's work.

    Outer item identities scope requests, never infer source identity from equal
    text/hashes. Successful comparisons retain both complete bound receipts;
    failures expose only the outer work identity and a fixed private reason.
    Missing comparisons deliberately use the existing no-fallback passage hold.
    Comparison refusals describe supplied envelopes; they do not overwrite an
    existing unchanged/structured/source-denied/duplicate/over-limit decision.
    """
    if (type(items) is not tuple or len(items)>MAX_ITEMS
            or any(type(item) is not CapturedWorkItem or type(item.item_key) is not str for item in items)
            or type(documents) is not tuple or len(documents)>MAX_ITEMS):
        raise DocumentDispatchError('document_dispatch_scope_invalid')
    try:
        items = scalar_records(items, CapturedWorkItem)
        routing_limits = scalar_record(routing_limits, RoutingLimits)
        source_bindings = scalar_records(source_bindings, PassageSourceBinding)
        token_limits = scalar_records(token_limits, PassageTokenLimit)
        price = scalar_record(price, ModelPrice); budget = scalar_record(budget, BudgetSnapshot)
        if not any(type(output_token_limit_per_call) is kind for kind in (type(None), int, bool)): raise ValueError
    except Exception:
        raise DocumentDispatchError('document_dispatch_scope_invalid') from None
    keys={item.item_key for item in items};seen=set()
    for document in documents:
        if (type(document) is not DocumentChangeRequest or type(document.item_key) is not str
                or document.item_key not in keys or document.item_key in seen):
            raise DocumentDispatchError('document_dispatch_scope_invalid')
        seen.add(document.item_key)
    frozen = []
    for document in documents:
        key = document.item_key
        try: node = freeze_input(document, (DocumentChangeRequest, DocumentPassageCapture, PlainDocumentReceipt, DocumentPassageBinding, DocumentSpanMap, DocumentByteSpan))
        except Exception: node = None
        frozen.append((key, node))
    try:
        if type(observed_at) is not datetime: raise ValueError
        observed_at = thaw_input(freeze_input(observed_at))
    except Exception: raise DocumentDispatchError('document_dispatch_scope_invalid') from None
    comparisons = []; refusals = []; changes = []
    for key, node in frozen:
        try:
            if node is None: raise DocumentComparisonError('comparison_unavailable')
            try: document = thaw_input(node)
            except Exception: raise DocumentComparisonError('comparison_unavailable') from None
            compared=compare_document_passages(document.current,document.previous,observed_at=observed_at)
            if compared.current.snapshot.item_key!=document.item_key:raise DocumentComparisonError('document_item_scope_mismatch')
        except DocumentComparisonError:
            refusals.append(DocumentComparisonRefusal(key));continue
        comparisons.append(ItemDocumentComparison(document.item_key,compared));changes.append(compared.change)
    # Reuse authoritative eligibility/hold/token/cost/item-position accounting.
    # Comparison does not grant approval and does not duplicate those decisions.
    passages=plan_passage_model_dispatch(items,routing_limits,changes=tuple(changes),token_limits=token_limits,
        source_bindings=source_bindings,output_token_limit_per_call=output_token_limit_per_call,price=price,budget=budget)
    return DocumentDispatchPlan(passages,tuple(comparisons),tuple(refusals))
