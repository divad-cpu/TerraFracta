"""Network-free rehearsal of the shared manual/scheduled update decision path.

All inputs are caller-supplied synthetic or trusted in-memory records. This is
not a runtime collector, a policy loader, a model caller or a public writer.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from re import fullmatch
from urllib.parse import urlsplit

from workers.automatic_publication_gate import (
    MachineDecisionInput,
    MachineDecisionProposal,
    propose_machine_disposition,
)
from workers.public_source_url import public_https_source_url
from workers.change_work_router import (
    CapturedWorkItem,
    RoutedItem,
    RoutingLimits,
    route_captured_changes,
)
from workers.update_request_identity import MAX_ITEMS, UpdateRequest, identify_update_request
from workers.structured_observation import StructuredObservation


@dataclass(frozen=True)
class OfflineSourceRef:
    source_version_id: str
    publisher: str
    title: str
    url: str
    retrieval_url: str
    locator: str
    content_sha256: str
    source_key: str


@dataclass(frozen=True)
class OfflineUpdateItem:
    captured: CapturedWorkItem
    source: OfflineSourceRef
    structured_candidate: MachineDecisionInput | None
    observation: StructuredObservation | None = None


@dataclass(frozen=True)
class OfflineRunRequest:
    invocation: UpdateRequest
    run_id: str
    started_at: datetime
    finished_at: datetime
    items: tuple[OfflineUpdateItem, ...]
    due_source_keys: tuple[str, ...]
    routing_limits: RoutingLimits


@dataclass(frozen=True)
class OfflineItemResult:
    item_key: str
    outcome: str
    reason_codes: tuple[str, ...]
    source: OfflineSourceRef
    decision: MachineDecisionProposal | None
    source_binding_valid: bool = True
    observation: StructuredObservation | None = None


@dataclass(frozen=True)
class OfflineRunReport:
    request_key: str
    request_fingerprint: str
    run_id: str
    started_at: datetime
    finished_at: datetime
    trigger: str
    scheduled_due_at: datetime | None
    scope: str
    mode: str
    state: str
    due_source_keys: tuple[str, ...]
    covered_source_keys: tuple[str, ...]
    items: tuple[OfflineItemResult, ...]
    model_items: int
    estimated_model_input_tokens: int
    public_changes: int = 0


def _source_valid(source: OfflineSourceRef, content_sha256: str) -> bool:
    if not all(isinstance(value, str) for value in (
        source.source_version_id, source.publisher, source.title, source.url,
        source.retrieval_url, source.locator, source.content_sha256, source.source_key,
    )):
        return False
    if not public_https_source_url(source.url):
        return False
    parsed = urlsplit(source.url)
    return (
        bool(source.source_version_id and source.publisher and source.title and source.locator)
        and bool(fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            source.source_version_id,
        ))
        and len(source.publisher) <= 160 and len(source.title) <= 240
        and len(source.retrieval_url) <= 2048
        and len(source.locator) <= 300
        and bool(fullmatch(r"[a-z0-9][a-z0-9:-]{0,119}", source.source_key))
        and parsed.hostname == "example.org"
        and bool(fullmatch(r"[0-9a-f]{64}", source.content_sha256))
        and source.content_sha256 == content_sha256
    )


def _from_route(route: RoutedItem, source: OfflineSourceRef) -> OfflineItemResult:
    return OfflineItemResult(
        route.item_key, route.disposition, (route.reason_code,), source, None
    )


def rehearse_update_run(request: OfflineRunRequest) -> OfflineRunReport:
    """Route changed items, then propose decisions only for structured changes."""

    identity = identify_update_request(request.invocation)
    if not isinstance(request.run_id, str) or not fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        request.run_id,
    ):
        raise ValueError("Run ID is invalid")
    if (
        not isinstance(request.started_at, datetime)
        or not isinstance(request.finished_at, datetime)
        or request.started_at.tzinfo is None
        or request.finished_at.tzinfo is None
        or request.started_at.utcoffset() != timezone.utc.utcoffset(request.started_at)
        or request.finished_at.utcoffset() != timezone.utc.utcoffset(request.finished_at)
        or request.finished_at < request.started_at
    ):
        raise ValueError("Run times are invalid")
    if (
        request.invocation.scheduled_due_at is not None
        and request.started_at < request.invocation.scheduled_due_at
    ):
        raise ValueError("Scheduled run started before its due window")
    admitted_limits = request.invocation.limits
    if (
        request.finished_at - request.started_at
        > timedelta(seconds=admitted_limits.max_duration_seconds)
        or len(request.items) > MAX_ITEMS
    ):
        raise ValueError("Run duration or report item count exceeds the admitted boundary")
    if (
        not isinstance(request.due_source_keys, tuple)
        or not 1 <= len(request.due_source_keys) <= MAX_ITEMS
        or any(not isinstance(key, str) or not fullmatch(
            r"[a-z0-9][a-z0-9:-]{0,119}", key
        ) for key in request.due_source_keys)
        or len(set(request.due_source_keys)) != len(request.due_source_keys)
        or any(not isinstance(item.source.source_key, str)
               or item.source.source_key not in request.due_source_keys
               for item in request.items)
    ):
        raise ValueError("Due source coverage is invalid")
    routing_limits = request.routing_limits
    if (
        not isinstance(routing_limits, RoutingLimits)
        or type(routing_limits.max_items) is not int
        or routing_limits.max_items < 1
        or routing_limits.max_items > admitted_limits.max_items
        or type(routing_limits.max_model_items) is not int
        or routing_limits.max_model_items < 0
        or routing_limits.max_model_items > admitted_limits.max_model_calls
        or type(routing_limits.max_model_input_tokens) is not int
        or routing_limits.max_model_input_tokens < 0
        or routing_limits.max_model_input_tokens > admitted_limits.max_model_input_tokens
    ):
        raise ValueError("Routing limits exceed the admitted run limits")

    source_bindings = tuple(
        _source_valid(item.source, item.captured.current_sha256)
        for item in request.items
    )
    # A refused source still consumes its original item/identity position, but
    # cannot claim model capacity before its source-reference hold is reported.
    routed = route_captured_changes(
        tuple(item.captured if valid else replace(item.captured, source_status="unqualified")
              for item, valid in zip(request.items, source_bindings, strict=True)),
        routing_limits,
    )
    outcomes: list[OfflineItemResult] = []
    for item, route, source_valid in zip(request.items, routed.items, source_bindings, strict=True):
        if not source_valid:
            outcomes.append(OfflineItemResult(
                item.captured.item_key, "held", ("source_reference_invalid",),
                item.source, None, False,
            ))
            continue
        candidate = item.structured_candidate
        check_unchanged = (
            route.disposition == "unchanged"
            and item.captured.extraction_route == "structured"
            and candidate is not None
        )
        if route.disposition != "deterministic" and not check_unchanged:
            outcomes.append(_from_route(route, item.source))
            continue
        if (
            candidate is None
            or candidate.candidate_id != item.captured.item_key
            or candidate.mode != request.invocation.mode
            or candidate.policy_id != request.invocation.policy_version
            or candidate.evidence.content_sha256 != item.captured.current_sha256
            or candidate.evidence.source_version_id != item.source.source_version_id
            or candidate.evidence.source_url != item.source.retrieval_url
            or candidate.qualification.public_citation_url != item.source.url
            or candidate.evidence.locator != item.source.locator
            or candidate.candidate_source_id != candidate.evidence.source_id
            or candidate.evidence.source_id != item.source.source_key
            # A current source receipt cannot lend this run an earlier or
            # future decision. Source retrieval may legitimately predate it.
            or not isinstance(candidate.evaluated_at, datetime)
            or candidate.evaluated_at.tzinfo is None
            or candidate.evaluated_at.utcoffset() != timezone.utc.utcoffset(candidate.evaluated_at)
            or not request.started_at <= candidate.evaluated_at <= request.finished_at
        ):
            outcomes.append(OfflineItemResult(
                item.captured.item_key, "held", ("candidate_binding_invalid",),
                item.source, None, False,
            ))
            continue
        decision = propose_machine_disposition(candidate)
        # Supplied new qualification/binding evidence can invalidate a skip.
        # Passing checks never turn identical content into a new activation.
        if check_unchanged and decision.disposition != "held":
            outcomes.append(_from_route(route, item.source))
            continue
        outcomes.append(OfflineItemResult(
            item.captured.item_key, decision.disposition,
            decision.reason_codes, item.source, decision,
            observation=item.observation,
        ))

    # A valid item cannot hide a second unverified item from the same source.
    # Coverage is complete only when every attempted binding for that source
    # was checked. A semantic conflict can still be checked-and-held.
    blocked_sources = {item.source.source_key for item in outcomes
                       if not item.source_binding_valid}
    covered_source_keys = tuple(sorted({
        item.source.source_key for item in outcomes if item.source_binding_valid
    } - blocked_sources))
    unresolved = {
        "deferred", "visibility_unverified", "model_candidate",
        "eligible_for_activation_check",
    }
    state = "partial" if (
        set(request.due_source_keys) != set(covered_source_keys)
        or any(item.outcome in unresolved for item in outcomes)
    ) else "completed"
    return OfflineRunReport(
        request_key=identity.request_key,
        request_fingerprint=identity.request_fingerprint,
        run_id=request.run_id,
        started_at=request.started_at,
        finished_at=request.finished_at,
        trigger=request.invocation.trigger,
        scheduled_due_at=request.invocation.scheduled_due_at,
        scope=request.invocation.scope,
        mode=request.invocation.mode,
        state=state,
        due_source_keys=request.due_source_keys,
        covered_source_keys=covered_source_keys,
        items=tuple(outcomes),
        model_items=routed.model_items,
        estimated_model_input_tokens=routed.estimated_model_input_tokens,
    )
