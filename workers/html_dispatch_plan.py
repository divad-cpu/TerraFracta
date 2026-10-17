"""Original-bound supplied HTML comparisons into the established batch planner.

A malformed original or missing chosen element holds that item only. The existing
source/rights/route/item/hash/token/position/budget rules decide reservations;
this format adapter neither duplicates those rules nor invokes a provider.
"""
from workers.dispatch_input_snapshot import scalar_record, scalar_records, freeze_input, thaw_input
from workers.html_passage_binding import HtmlDocumentReceipt, HtmlPassageBinding, HtmlSelectionMap, HtmlElementSelection
from dataclasses import dataclass
from datetime import datetime

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.html_passage_comparison import (
    HtmlPassageCapture, HtmlPassageComparison, HtmlComparisonError, compare_html_passages,
)
from workers.model_cost_budget import BudgetSnapshot, ModelPrice
from workers.passage_model_plan import (
    PassageDispatchPlan, PassageSourceBinding, PassageTokenLimit, plan_passage_model_dispatch,
)
from workers.update_request_identity import MAX_ITEMS


class HtmlDispatchError(ValueError):
    """Outer batch scope is invalid; no supplied source text is disclosed."""


@dataclass(frozen=True)
class HtmlChangeRequest:
    item_key: str
    current: HtmlPassageCapture
    previous: HtmlPassageCapture | None = None


@dataclass(frozen=True)
class ItemHtmlComparison:
    item_key: str
    comparison: HtmlPassageComparison


@dataclass(frozen=True)
class HtmlComparisonRefusal:
    item_key: str
    reason_code: str = 'html_comparison_unavailable'


@dataclass(frozen=True)
class HtmlDispatchPlan:
    passages: PassageDispatchPlan
    comparisons: tuple[ItemHtmlComparison, ...]
    comparison_refusals: tuple[HtmlComparisonRefusal, ...]
    evidence_state: str = 'offline_html_dispatch_plan_only'


def plan_html_dispatch(items: tuple[CapturedWorkItem, ...], routing_limits: RoutingLimits, *,
        documents: tuple[HtmlChangeRequest, ...], source_bindings: tuple[PassageSourceBinding, ...],
        token_limits: tuple[PassageTokenLimit, ...], output_token_limit_per_call: int | None,
        price: ModelPrice, budget: BudgetSnapshot, observed_at: datetime) -> HtmlDispatchPlan:
    """Rebind each pair, preserving independent updates and existing refusals.

    Outer work identities cannot borrow another item's captured passages. Failed
    comparisons supply no passage change, so there is no whole-document fallback.
    A comparison does not overwrite a source-denied, structured, duplicate,
    unchanged-source or over-limit disposition chosen by the shared planner.
    """
    if (type(items) is not tuple or len(items) > MAX_ITEMS
            or any(type(item) is not CapturedWorkItem or type(item.item_key) is not str for item in items)
            or type(documents) is not tuple or len(documents) > MAX_ITEMS):
        raise HtmlDispatchError('html_dispatch_scope_invalid')
    try:
        items = scalar_records(items, CapturedWorkItem)
        routing_limits = scalar_record(routing_limits, RoutingLimits)
        source_bindings = scalar_records(source_bindings, PassageSourceBinding)
        token_limits = scalar_records(token_limits, PassageTokenLimit)
        price = scalar_record(price, ModelPrice); budget = scalar_record(budget, BudgetSnapshot)
        if not any(type(output_token_limit_per_call) is kind for kind in (type(None), int, bool)): raise ValueError
    except Exception:
        raise HtmlDispatchError('html_dispatch_scope_invalid') from None
    keys = {item.item_key for item in items}; seen = set()
    for document in documents:
        if (type(document) is not HtmlChangeRequest or type(document.item_key) is not str
                or document.item_key not in keys or document.item_key in seen):
            raise HtmlDispatchError('html_dispatch_scope_invalid')
        seen.add(document.item_key)
    frozen = []
    for document in documents:
        key = document.item_key
        try: node = freeze_input(document, (HtmlChangeRequest, HtmlPassageCapture, HtmlDocumentReceipt, HtmlPassageBinding, HtmlSelectionMap, HtmlElementSelection))
        except Exception: node = None
        frozen.append((key, node))
    try:
        if type(observed_at) is not datetime: raise ValueError
        observed_at = thaw_input(freeze_input(observed_at))
    except Exception: raise HtmlDispatchError('html_dispatch_scope_invalid') from None
    comparisons = []; refusals = []; changes = []
    for key, node in frozen:
        try:
            if node is None: raise HtmlComparisonError('comparison_unavailable')
            try: document = thaw_input(node)
            except Exception: raise HtmlComparisonError('comparison_unavailable') from None
            compared = compare_html_passages(document.current, document.previous, observed_at=observed_at)
            if compared.current.snapshot.item_key != document.item_key:
                raise HtmlComparisonError('html_item_scope_mismatch')
        except HtmlComparisonError:
            refusals.append(HtmlComparisonRefusal(key)); continue
        comparisons.append(ItemHtmlComparison(document.item_key, compared)); changes.append(compared.change)
    passages = plan_passage_model_dispatch(items, routing_limits, changes=tuple(changes), token_limits=token_limits,
        source_bindings=source_bindings, output_token_limit_per_call=output_token_limit_per_call, price=price, budget=budget)
    return HtmlDispatchPlan(passages, tuple(comparisons), tuple(refusals))
