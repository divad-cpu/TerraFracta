"""Opt-in offline passage selection before the existing routing/cost plan.

No tokenizer or provider is selected here. A trusted caller must supply a
maximum input-token bound for the exact complete selected payload, including
its framing/locators. This is not an actual usage record or a durable ledger.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from re import fullmatch

from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.model_cost_budget import BudgetSnapshot, ModelPrice, MAX_TOKEN_LIMIT
from workers.model_dispatch_plan import ModelDispatchPlan, plan_model_dispatch
from workers.prose_passage_selection import (
    PassageSelection, PassageSelectionError, PassageSnapshot, select_changed_passages,
)
from workers.update_request_identity import MAX_ITEMS


@dataclass(frozen=True)
class PassageChange:
    current: PassageSnapshot
    previous: PassageSnapshot | None = None


@dataclass(frozen=True)
class PassageTokenLimit:
    item_key: str
    payload_sha256: str
    maximum_input_tokens: int


@dataclass(frozen=True)
class PassageSourceBinding:
    # Supplied independently from the trusted source/whole-item record, never
    # inferred from the passage capture or an untrusted model response.
    item_key: str
    source_key: str


@dataclass(frozen=True)
class ItemPassageSelection:
    item_key: str
    selection: PassageSelection


@dataclass(frozen=True)
class PassageDispatchPlan:
    dispatch: ModelDispatchPlan
    selections: tuple[ItemPassageSelection, ...]


def _hash(value: object) -> bool:
    # Match the existing router's admitted hash types so a stricter pre-screen
    # cannot accidentally leave an otherwise admitted whole-item model route.
    return isinstance(value, str) and fullmatch(r"[0-9a-f]{64}", value) is not None


def _source_key(value: object) -> bool:
    if type(value) is not str or not 1 <= len(value) <= 120 or value != value.strip() or any(ord(c) < 32 for c in value):
        return False
    try:
        value.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def plan_passage_model_dispatch(
    items: tuple[CapturedWorkItem, ...], routing_limits: RoutingLimits, *,
    changes: tuple[PassageChange, ...], token_limits: tuple[PassageTokenLimit, ...],
    source_bindings: tuple[PassageSourceBinding, ...] = (),
    output_token_limit_per_call: int | None, price: ModelPrice, budget: BudgetSnapshot,
) -> PassageDispatchPlan:
    """Never fall back to whole-document model work when passage proof is absent.

    Original source/hash/identity/item/token/cost gates remain authoritative.
    A changed prose candidate also requires an independent item/source binding;
    copied equal bytes cannot establish that its passages belong to that row.
    The caller still authenticates the source record and accepted qualification.
    No-model-work describes selected prose only, not unchanged source bytes or
    current claims. Removed passages require review; independent items continue.
    """
    if (type(items) is not tuple or len(items) > MAX_ITEMS
            or any(not isinstance(item, CapturedWorkItem) or type(item.item_key) is not str for item in items)
            or type(changes) is not tuple or len(changes) > MAX_ITEMS
            or type(token_limits) is not tuple or len(token_limits) > MAX_ITEMS
            or type(source_bindings) is not tuple or len(source_bindings) > MAX_ITEMS):
        raise ValueError("passage_plan_scope_invalid")
    keys = {item.item_key for item in items}
    captures: dict[str, PassageChange] = {}
    proofs: dict[str, PassageTokenLimit] = {}
    sources: dict[str, PassageSourceBinding] = {}
    for binding in source_bindings:
        if (not isinstance(binding, PassageSourceBinding) or type(binding.item_key) is not str
                or binding.item_key not in keys or binding.item_key in sources):
            raise ValueError("passage_plan_source_scope_invalid")
        sources[binding.item_key] = binding
    for change in changes:
        if (not isinstance(change, PassageChange) or not isinstance(change.current, PassageSnapshot)
                or type(change.current.item_key) is not str or change.current.item_key not in keys
                or change.current.item_key in captures):
            raise ValueError("passage_plan_capture_scope_invalid")
        captures[change.current.item_key] = change
    for proof in token_limits:
        if (not isinstance(proof, PassageTokenLimit) or type(proof.item_key) is not str
                or proof.item_key not in keys or proof.item_key in proofs):
            raise ValueError("passage_plan_token_scope_invalid")
        proofs[proof.item_key] = proof
    prepared = []
    selections = []
    overrides: dict[int, tuple[str, str]] = {}
    seen: set[str] = set()
    for index, item in enumerate(items):
        # Leave pre-existing refusals, duplicate positions and deterministic or
        # whole-source-unchanged paths untouched and do not expose their text.
        eligible = (item.item_key not in seen and bool(item.item_key)
            and type(routing_limits.max_items) is int and index < routing_limits.max_items
            and item.source_status == "approved" and item.fetch_enabled is True
            and item.model_processing_allowed is True and item.extraction_route == "qualified_prose"
            and _hash(item.current_sha256) and (item.previous_sha256 is None or _hash(item.previous_sha256))
            and item.current_sha256 != item.previous_sha256)
        seen.add(item.item_key)
        if not eligible:
            prepared.append(item)
            continue
        change = captures.get(item.item_key)
        source = sources.get(item.item_key)
        selected = None
        reason, disposition = "passage_capture_missing", "held"
        if source is None or not _source_key(source.source_key):
            reason = "passage_source_binding_missing_or_invalid"
        elif change is not None:
            try:
                if change.current.source_key != source.source_key:
                    raise PassageSelectionError("passage_source_binding_mismatch")
                if (change.current.content_sha256 != item.current_sha256
                        or (change.previous is None) != (item.previous_sha256 is None)
                        or (change.previous is not None and
                            (not isinstance(change.previous, PassageSnapshot)
                             or change.previous.content_sha256 != item.previous_sha256))):
                    raise PassageSelectionError("passage_capture_binding_mismatch")
                selected = select_changed_passages(change.current, change.previous)
            except PassageSelectionError as error:
                reason = str(error)
        if selected is not None:
            selections.append(ItemPassageSelection(item.item_key, selected))
            reason, disposition = selected.reason_code, selected.state
            if selected.state == "ready":
                proof = proofs.get(item.item_key)
                if (proof is None or not _hash(proof.payload_sha256)
                        or type(proof.maximum_input_tokens) is not int
                        or not 1 <= proof.maximum_input_tokens <= MAX_TOKEN_LIMIT):
                    reason, disposition = "passage_token_limit_missing_or_invalid", "deferred"
                elif proof.payload_sha256 != selected.payload_sha256:
                    reason, disposition = "passage_token_binding_mismatch", "deferred"
                else:
                    prepared.append(replace(item, estimated_model_input_tokens=proof.maximum_input_tokens))
                    continue
        # A non-model extraction route causes the existing planner to reserve
        # nothing. Replace only that exact refusal with its more precise cause.
        prepared.append(replace(item, extraction_route="passage_selection_withheld"))
        overrides[index] = (disposition, reason)
    dispatch = plan_model_dispatch(tuple(prepared), routing_limits,
        output_token_limit_per_call=output_token_limit_per_call, price=price, budget=budget)
    results = tuple(replace(result, disposition=overrides[index][0], reason_code=overrides[index][1],
                            maximum_call_usd=Decimal(0))
                    if index in overrides and result.reason_code == "model_route_not_qualified" else result
                    for index, result in enumerate(dispatch.items))
    return PassageDispatchPlan(replace(dispatch, items=results), tuple(selections))
