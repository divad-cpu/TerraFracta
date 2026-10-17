"""Explicit native-PDF page comparisons into the unchanged offline batch planner.

All supplied authority/cost assertions and complete original envelopes are
copied before any owned PDF child. Invalid pairs hold their item only. This
module fetches, calls, stores and publishes nothing and authenticates no input.
"""
from dataclasses import dataclass
from workers.dispatch_input_snapshot import scalar_record as _record, scalar_records as _records, freeze_input, thaw_input
from datetime import datetime
from decimal import Decimal

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.model_cost_budget import BudgetSnapshot, ModelPrice
from workers.pdf_passage_binding import (capture_pdf_passage_inputs, PdfDocumentReceipt, PdfPassageBinding,
    PdfPageSelectionMap, PdfPageSelection)
from workers.pdf_passage_comparison import (
    PdfPassageCapture, PdfPassageComparison, PdfComparisonError, compare_pdf_passages,
)
from workers.passage_model_plan import (
    PassageDispatchPlan, PassageSourceBinding, PassageTokenLimit, plan_passage_model_dispatch,
)
from workers.update_request_identity import MAX_ITEMS


class PdfDispatchError(ValueError):
    """Invalid outer scope; no original/source/cost/private-text diagnostics."""


@dataclass(frozen=True)
class PdfChangeRequest:
    item_key: str
    current: PdfPassageCapture
    previous: PdfPassageCapture | None = None


@dataclass(frozen=True)
class ItemPdfComparison:
    item_key: str
    comparison: PdfPassageComparison


@dataclass(frozen=True)
class PdfComparisonRefusal:
    item_key: str
    reason_code: str = 'pdf_comparison_unavailable'


@dataclass(frozen=True)
class PdfDispatchPlan:
    passages: PassageDispatchPlan
    comparisons: tuple[ItemPdfComparison, ...]
    comparison_refusals: tuple[PdfComparisonRefusal, ...]
    evidence_state: str = 'offline_native_pdf_dispatch_plan_only'


def _capture(value, at):
    if type(value) is not PdfPassageCapture:
        raise ValueError
    copied = capture_pdf_passage_inputs(value.raw, value.document, binding=value.binding,
                                        mapping=value.mapping, observed_at=at)
    return PdfPassageCapture(copied.raw, copied.document, copied.binding, copied.mapping)


def plan_pdf_dispatch(items: tuple[CapturedWorkItem, ...], routing_limits: RoutingLimits, *,
        documents: tuple[PdfChangeRequest, ...], source_bindings: tuple[PassageSourceBinding, ...],
        token_limits: tuple[PassageTokenLimit, ...], output_token_limit_per_call: int | None,
        price: ModelPrice, budget: BudgetSnapshot, observed_at: datetime) -> PdfDispatchPlan:
    """No whole-PDF fallback or implicit baseline, source or permission inference.

    Per-original worker limits are independent; there is no shared three-second
    batch deadline. Existing routing bounds/reservations decide model candidates
    only after the complete selected-page comparison has succeeded.
    """
    try:
        items = _records(items, CapturedWorkItem)
        routing_limits = _record(routing_limits, RoutingLimits)
        source_bindings = _records(source_bindings, PassageSourceBinding)
        token_limits = _records(token_limits, PassageTokenLimit)
        price = _record(price, ModelPrice); budget = _record(budget, BudgetSnapshot)
        if not any(type(output_token_limit_per_call) is kind for kind in (type(None), int, bool)):
            raise ValueError
        if (any(type(item.item_key) is not str for item in items)
                or type(documents) is not tuple or len(documents) > MAX_ITEMS):
            raise ValueError
        keys = {item.item_key for item in items}; seen = set(); rows = []
        # Capture outer identities first, including all later rows, before any
        # callback-capable native inspection of an earlier row.
        for document in documents:
            if type(document) is not PdfChangeRequest:
                raise ValueError
            key, now, before = document.item_key, document.current, document.previous
            if type(key) is not str or key not in keys or key in seen:
                raise ValueError
            seen.add(key); rows.append((key, now, before))
    except Exception:
        raise PdfDispatchError('pdf_dispatch_scope_invalid') from None
    frozen = []
    for key, now, before in rows:
        try: node = freeze_input((now, before), (PdfPassageCapture, PdfDocumentReceipt, PdfPassageBinding,
                                                PdfPageSelectionMap, PdfPageSelection))
        except Exception: node = None
        frozen.append((key, node))
    try:
        if type(observed_at) is not datetime: raise ValueError
        at = thaw_input(freeze_input(observed_at))
    except Exception: raise PdfDispatchError('pdf_dispatch_scope_invalid') from None
    copied = []; refusals = []
    for key, node in frozen:
        try:
            if node is None: raise ValueError
            try: now, before = thaw_input(node)
            except Exception: raise ValueError from None
            copied.append(PdfChangeRequest(key, _capture(now, at),
                None if before is None else _capture(before, at)))
        except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
            refusals.append(PdfComparisonRefusal(key))
    comparisons = []; changes = []
    for document in copied:
        try:
            compared = compare_pdf_passages(document.current, document.previous, observed_at=at)
            if compared.current.snapshot.item_key != document.item_key:
                raise PdfComparisonError('pdf_item_scope_mismatch')
        except PdfComparisonError:
            refusals.append(PdfComparisonRefusal(document.item_key)); continue
        comparisons.append(ItemPdfComparison(document.item_key, compared)); changes.append(compared.change)
    # Preserve the requested document order even when pre-capture and later
    # inspection refusals occurred in different phases.
    order = {row[0]: index for index, row in enumerate(rows)}
    refusals.sort(key=lambda row: order[row.item_key])
    try:
        passages = plan_passage_model_dispatch(items, routing_limits, changes=tuple(changes),
            token_limits=token_limits, source_bindings=source_bindings,
            output_token_limit_per_call=output_token_limit_per_call, price=price, budget=budget)
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise PdfDispatchError('pdf_dispatch_scope_invalid') from None
    return PdfDispatchPlan(passages, tuple(comparisons), tuple(refusals))
