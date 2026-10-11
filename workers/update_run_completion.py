"""Reconcile an independently supplied work manifest with private receipts.

This pure function neither authenticates receipts nor fetches, commits or
verifies a website. A future trusted driver supplies the stored manifest and
the database/reader receipts separately; counts in a worker message are not
inputs. Missing work remains visible even when another item was committed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from re import fullmatch
from uuid import UUID, RFC_4122

from workers.update_request_identity import MAX_ITEMS


SURFACES = frozenset({"issue", "overview", "sources", "search"})
KEY = r"[a-z0-9][a-z0-9:-]{0,119}"
HASH = r"[0-9a-f]{64}"


@dataclass(frozen=True)
class PlannedSource:
    source_key: str
    registration_id: str
    source_version_id: str | None
    content_sha256: str | None = None


@dataclass(frozen=True)
class PlannedItem:
    item_key: str
    source_key: str
    source_version_id: str


@dataclass(frozen=True)
class RunManifest:
    run_id: str
    request_fingerprint: str
    mode: str
    sources: tuple[PlannedSource, ...]
    items: tuple[PlannedItem, ...]


@dataclass(frozen=True)
class DecisionReceipt:
    decision_id: str
    item_key: str
    source_version_id: str
    disposition: str


@dataclass(frozen=True)
class ActivationReceipt:
    publication_id: str
    decision_id: str
    publication_sha256: str
    activated_at: datetime


@dataclass(frozen=True)
class VisibilityReceipt:
    publication_id: str
    publication_sha256: str
    surface: str
    outcome: str
    checked_at: datetime


@dataclass(frozen=True)
class CompletionSummary:
    manifest_sha256: str
    run_state: str
    commit_state: str
    visibility_state: str
    due_source_keys: tuple[str, ...]
    covered_source_keys: tuple[str, ...]
    missing_source_keys: tuple[str, ...]
    invalid_source_keys: tuple[str, ...]
    expected_items: int
    decided_items: int
    held_items: int
    pending_item_keys: tuple[str, ...]
    committed_publication_ids: tuple[str, ...]
    visible_publication_ids: tuple[str, ...]
    pending_visibility_publication_ids: tuple[str, ...]
    failed_visibility_publication_ids: tuple[str, ...]


def _uuid(value: object) -> bool:
    if type(value) is not str:
        return False
    try:
        parsed = UUID(value)
        return str(parsed) == value and parsed.variant == RFC_4122 and parsed.version in {4, 5}
    except ValueError:
        return False


def _instant(value: object) -> bool:
    return isinstance(value, datetime) and value.tzinfo is not None and value.utcoffset() == timezone.utc.utcoffset(value)


def canonical_run_manifest(manifest: RunManifest) -> str:
    """Validate a closed, bounded captured-work plan and give it one identity."""

    if not isinstance(manifest, RunManifest) or not _uuid(manifest.run_id) or \
       type(manifest.request_fingerprint) is not str or not fullmatch(HASH, manifest.request_fingerprint) or \
       type(manifest.mode) is not str or manifest.mode not in {"shadow", "publish_eligible"} or \
       type(manifest.sources) is not tuple or not 1 <= len(manifest.sources) <= MAX_ITEMS or \
       type(manifest.items) is not tuple or len(manifest.items) > MAX_ITEMS:
        raise ValueError("Run manifest is invalid")
    source_keys = set()
    registrations = set()
    sources = {}
    for source in manifest.sources:
        if not isinstance(source, PlannedSource) or type(source.source_key) is not str or \
           not fullmatch(KEY, source.source_key) or not _uuid(source.registration_id) or \
           (source.source_version_id is not None and not _uuid(source.source_version_id)) or \
           ((source.source_version_id is None) != (source.content_sha256 is None)) or \
           (source.content_sha256 is not None and (type(source.content_sha256) is not str or not fullmatch(HASH, source.content_sha256))) or \
           source.source_key in source_keys or source.registration_id in registrations:
            raise ValueError("Run manifest is invalid")
        source_keys.add(source.source_key)
        registrations.add(source.registration_id)
        sources[source.source_key] = source
    item_keys = set()
    for item in manifest.items:
        if not isinstance(item, PlannedItem) or type(item.item_key) is not str or \
           not fullmatch(KEY, item.item_key) or type(item.source_key) is not str or \
           item.source_key not in sources or not _uuid(item.source_version_id) or \
           sources[item.source_key].source_version_id != item.source_version_id or item.item_key in item_keys:
            raise ValueError("Run manifest is invalid")
        item_keys.add(item.item_key)
    payload = {
        "schemaVersion": 1, "runId": manifest.run_id,
        "requestFingerprint": manifest.request_fingerprint, "mode": manifest.mode,
        "sources": [{"sourceKey": entry.source_key, "registrationId": entry.registration_id,
                     "contentSha256": entry.content_sha256,
                     "sourceVersionId": entry.source_version_id}
                    for entry in sorted(manifest.sources, key=lambda entry: entry.source_key)],
        "items": [{"itemKey": entry.item_key, "sourceKey": entry.source_key,
                   "sourceVersionId": entry.source_version_id}
                  for entry in sorted(manifest.items, key=lambda entry: entry.item_key)],
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def parse_canonical_run_manifest(data: bytes) -> RunManifest:
    """Consume exact stored manifest bytes without accepting a rewritten plan."""
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('Run manifest is invalid')
            result[key] = value
        return result
    if type(data) is not bytes or not 2 <= len(data) <= 40960:
        raise ValueError('Run manifest is invalid')
    try:
        text = data.decode('ascii')
        p = json.loads(text, object_pairs_hook=unique)
        if type(p) is not dict or set(p) != {'schemaVersion','runId','requestFingerprint','mode','sources','items'} or \
           type(p['schemaVersion']) is not int or p['schemaVersion'] != 1 or \
           type(p['sources']) is not list or not 1 <= len(p['sources']) <= MAX_ITEMS or \
           type(p['items']) is not list or len(p['items']) > MAX_ITEMS:
            raise ValueError
        if any(type(s) is not dict or set(s) != {'sourceKey','registrationId','sourceVersionId','contentSha256'} for s in p['sources']) or \
           any(type(i) is not dict or set(i) != {'itemKey','sourceKey','sourceVersionId'} for i in p['items']):
            raise ValueError
        manifest = RunManifest(p['runId'],p['requestFingerprint'],p['mode'],
            tuple(PlannedSource(s['sourceKey'],s['registrationId'],s['sourceVersionId'],s['contentSha256']) for s in p['sources']),
            tuple(PlannedItem(i['itemKey'],i['sourceKey'],i['sourceVersionId']) for i in p['items']))
        if canonical_run_manifest(manifest) != text:
            raise ValueError
        return manifest
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError) as exc:
        raise ValueError('Run manifest is invalid') from exc


def reconcile_run_completion(
    manifest: RunManifest, decisions: tuple[DecisionReceipt, ...],
    activations: tuple[ActivationReceipt, ...], visibility: tuple[VisibilityReceipt, ...],
    *, now: datetime, invalid_source_keys: tuple[str, ...] = (),
) -> CompletionSummary:
    """Derive stages from exact sets; a hold is resolved, an absent item is not.

    A source version in the trusted manifest represents a successful checked
    capture, including a capture containing no material changes. A missing
    capture uses None. The caller must establish retrieval/registration and
    run/decision/activation binding before constructing these private records.
    One successful check cannot override a failed check on another surface.
    Duplicate evidence is rejected; the caller selects a single stored check
    per surface independently before reconciliation.
    """

    canonical = canonical_run_manifest(manifest)
    if not _instant(now) or any(type(entries) is not tuple for entries in (decisions, activations, visibility)) or \
       len(decisions) > MAX_ITEMS or len(activations) > MAX_ITEMS or len(visibility) > MAX_ITEMS * len(SURFACES):
        raise ValueError("Completion receipts are invalid")
    due_keys = {entry.source_key for entry in manifest.sources}
    if type(invalid_source_keys) is not tuple or any(type(key) is not str or key not in due_keys for key in invalid_source_keys) or \
       len(invalid_source_keys) != len(set(invalid_source_keys)):
        raise ValueError("Completion source checks are invalid")
    invalid_sources = set(invalid_source_keys)
    planned = {entry.item_key: entry for entry in manifest.items}
    decision_by_item = {}
    decisions_by_id = {}
    for receipt in decisions:
        if not isinstance(receipt, DecisionReceipt) or not _uuid(receipt.decision_id) or \
           type(receipt.item_key) is not str or receipt.item_key not in planned or \
           planned[receipt.item_key].source_version_id != receipt.source_version_id or \
           type(receipt.disposition) is not str or receipt.disposition not in {"eligible", "held", "rejected", "unchanged"} or \
           (manifest.mode == "shadow" and receipt.disposition == "eligible") or \
           receipt.item_key in decision_by_item or receipt.decision_id in decisions_by_id:
            raise ValueError("Completion receipts are invalid")
        decision_by_item[receipt.item_key] = receipt
        decisions_by_id[receipt.decision_id] = receipt
    activation_by_decision = {}
    activation_by_publication = {}
    for receipt in activations:
        if not isinstance(receipt, ActivationReceipt) or not _uuid(receipt.publication_id) or \
           type(receipt.decision_id) is not str or receipt.decision_id not in decisions_by_id or \
           decisions_by_id[receipt.decision_id].disposition != "eligible" or \
           type(receipt.publication_sha256) is not str or not fullmatch(HASH, receipt.publication_sha256) or \
           not _instant(receipt.activated_at) or receipt.activated_at > now or \
           receipt.decision_id in activation_by_decision or receipt.publication_id in activation_by_publication:
            raise ValueError("Completion receipts are invalid")
        activation_by_decision[receipt.decision_id] = receipt
        activation_by_publication[receipt.publication_id] = receipt
    checks = {}
    for receipt in visibility:
        if not isinstance(receipt, VisibilityReceipt) or type(receipt.publication_id) is not str or \
           receipt.publication_id not in activation_by_publication or type(receipt.surface) is not str or receipt.surface not in SURFACES or \
           type(receipt.outcome) is not str or receipt.outcome not in {"matched", "missing", "error", "superseded"} or \
           receipt.publication_sha256 != activation_by_publication[receipt.publication_id].publication_sha256 or \
           not _instant(receipt.checked_at) or not activation_by_publication[receipt.publication_id].activated_at <= receipt.checked_at <= now or \
           (receipt.publication_id, receipt.surface) in checks:
            raise ValueError("Completion receipts are invalid")
        checks[receipt.publication_id, receipt.surface] = receipt.outcome
    missing_sources = tuple(sorted(entry.source_key for entry in manifest.sources if entry.source_version_id is None or entry.source_key in invalid_sources))
    covered_sources = tuple(sorted(entry.source_key for entry in manifest.sources if entry.source_version_id is not None and entry.source_key not in invalid_sources))
    pending_items = tuple(sorted(key for key in planned if key not in decision_by_item or
        planned[key].source_key in invalid_sources or
        (decision_by_item[key].disposition == "eligible" and decision_by_item[key].decision_id not in activation_by_decision)))
    visible = []
    pending_visibility = []
    failed_visibility = []
    for publication in sorted(activation_by_publication):
        outcomes = [checks.get((publication, surface)) for surface in SURFACES]
        if all(outcome == "matched" for outcome in outcomes):
            visible.append(publication)
        elif any(outcome in {"missing", "error", "superseded"} for outcome in outcomes):
            failed_visibility.append(publication)
        else:
            pending_visibility.append(publication)
    committed = tuple(sorted(activation_by_publication))
    if not committed:
        visibility_state = "not_required"
    elif len(visible) == len(committed):
        visibility_state = "verified"
    elif failed_visibility:
        visibility_state = "mixed" if visible or pending_visibility else "failed"
    else:
        visibility_state = "pending"
    pending_eligible = any(entry.disposition == "eligible" and entry.decision_id not in activation_by_decision
                           for entry in decisions)
    commit_state = "none" if not committed else "partial" if pending_eligible or pending_items or missing_sources else "committed"
    run_state = "partial" if missing_sources or pending_items or pending_visibility or failed_visibility else "completed"
    return CompletionSummary(
        sha256(canonical.encode("ascii")).hexdigest(), run_state, commit_state, visibility_state,
        tuple(sorted(entry.source_key for entry in manifest.sources)), covered_sources, missing_sources, tuple(sorted(invalid_sources)),
        len(planned), len(decision_by_item), sum(entry.disposition == "held" for entry in decisions),
        pending_items, committed, tuple(visible), tuple(pending_visibility), tuple(failed_visibility),
    )
