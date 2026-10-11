"""Offline routing for changed, already captured source items.

The caller must derive source status, rights and hashes from trusted records.
This plans work only; it does not fetch, call a model or publish.
"""

from __future__ import annotations

from dataclasses import dataclass
from re import fullmatch
from typing import Callable


@dataclass(frozen=True)
class CapturedWorkItem:
    item_key: str
    source_status: str
    fetch_enabled: bool
    current_sha256: str
    previous_sha256: str | None
    extraction_route: str
    model_processing_allowed: bool
    estimated_model_input_tokens: int


@dataclass(frozen=True)
class RoutingLimits:
    max_items: int | None
    max_model_items: int | None
    max_model_input_tokens: int | None


@dataclass(frozen=True)
class RoutedItem:
    item_key: str
    disposition: str
    reason_code: str


@dataclass(frozen=True)
class RoutingPlan:
    items: tuple[RoutedItem, ...]
    estimated_model_input_tokens: int
    model_items: int


def _hash_ok(value: str | None) -> bool:
    return value is None or (
        isinstance(value, str) and bool(fullmatch(r"[0-9a-f]{64}", value))
    )


def _positive_int(value: object) -> bool:
    return type(value) is int and value > 0


def route_captured_changes(
    items: tuple[CapturedWorkItem, ...], limits: RoutingLimits,
    *, model_admission: Callable[[CapturedWorkItem], str | None] | None = None,
) -> RoutingPlan:
    """Bound optional model work after an optional offline reservation screen.

    A rejection reason defers the candidate without consuming model capacity.
    Overall item limits and identities remain consumed. No screen can bypass
    source qualification, hashes or the configured model item/token limits.
    """

    outcomes: list[RoutedItem] = []
    seen: set[str] = set()
    model_items = 0
    model_tokens = 0
    for index, item in enumerate(items):
        if not isinstance(item.item_key, str) or not item.item_key or item.item_key in seen:
            outcomes.append(RoutedItem(item.item_key, "held", "item_identity_invalid"))
            continue
        seen.add(item.item_key)
        if not _positive_int(limits.max_items) or index >= limits.max_items:
            outcomes.append(RoutedItem(item.item_key, "deferred", "item_limit_reached"))
            continue
        if item.source_status != "approved" or item.fetch_enabled is not True:
            outcomes.append(RoutedItem(item.item_key, "held", "source_not_enabled"))
            continue
        if not _hash_ok(item.current_sha256) or item.current_sha256 is None or not _hash_ok(item.previous_sha256):
            outcomes.append(RoutedItem(item.item_key, "held", "hash_invalid"))
            continue
        if item.current_sha256 == item.previous_sha256:
            outcomes.append(RoutedItem(item.item_key, "unchanged", "content_hash_unchanged"))
            continue
        if item.extraction_route == "structured":
            outcomes.append(RoutedItem(item.item_key, "deterministic", "structured_change"))
            continue
        if item.extraction_route != "qualified_prose" or item.model_processing_allowed is not True:
            outcomes.append(RoutedItem(item.item_key, "held", "model_route_not_qualified"))
            continue
        if (
            not _positive_int(limits.max_model_items)
            or not _positive_int(limits.max_model_input_tokens)
            or not _positive_int(item.estimated_model_input_tokens)
            or model_items >= limits.max_model_items
            or model_tokens + item.estimated_model_input_tokens > limits.max_model_input_tokens
        ):
            outcomes.append(RoutedItem(item.item_key, "deferred", "model_limit_reached"))
            continue
        if model_admission is not None:
            rejection_reason = model_admission(item)
            if rejection_reason is not None:
                outcomes.append(RoutedItem(item.item_key, "deferred", rejection_reason))
                continue
        outcomes.append(RoutedItem(item.item_key, "model_candidate", "changed_qualified_prose"))
        model_items += 1
        model_tokens += item.estimated_model_input_tokens
    return RoutingPlan(tuple(outcomes), model_tokens, model_items)
