"""Offline selection from already parsed, independently qualified passages.

The caller supplies trusted source/mapping identities and exact parser output.
This module neither segments raw sources nor establishes qualification, rights,
support, translation, token counts, provider access or publication eligibility.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from re import fullmatch


MAX_PASSAGES = 128
MAX_PASSAGE_BYTES = 8 * 1024
MAX_CAPTURE_TEXT_BYTES = 64 * 1024
MAX_PAYLOAD_BYTES = 64 * 1024


class PassageSelectionError(ValueError):
    """The supplied private capture cannot support this bounded comparison."""


@dataclass(frozen=True)
class Passage:
    locator: str
    text: str
    text_sha256: str


@dataclass(frozen=True)
class PassageSnapshot:
    source_key: str
    item_key: str
    source_version_id: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    passages: tuple[Passage, ...]


@dataclass(frozen=True)
class PassageSelection:
    state: str
    reason_code: str
    unchanged_locators: tuple[str, ...] = ()
    removed_locators: tuple[str, ...] = ()
    payload: bytes | None = None
    payload_sha256: str | None = None


def _plain(value: object, maximum: int) -> bool:
    if not (type(value) is str and 1 <= len(value) <= maximum
            and value == value.strip() and all(ord(c) >= 32 for c in value)):
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def _digest(value: object) -> bool:
    return type(value) is str and fullmatch(r"[0-9a-f]{64}", value) is not None


def _validate(value: object) -> PassageSnapshot:
    if not isinstance(value, PassageSnapshot) or (
        not all(_plain(v, 120) for v in (value.source_key, value.item_key, value.source_version_id))
        or not _digest(value.content_sha256) or not _digest(value.mapping_sha256)
        or type(value.language_code) is not str
        or not fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?", value.language_code)
        or type(value.passages) is not tuple or len(value.passages) > MAX_PASSAGES
    ):
        raise PassageSelectionError("passage_snapshot_invalid")
    seen: set[str] = set()
    total = 0
    for passage in value.passages:
        if (not isinstance(passage, Passage) or not _plain(passage.locator, 200)
                or passage.locator in seen or type(passage.text) is not str
                or not passage.text.strip() or not _digest(passage.text_sha256)):
            raise PassageSelectionError("passage_invalid")
        try:
            body = passage.text.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise PassageSelectionError("passage_invalid") from exc
        if len(body) > MAX_PASSAGE_BYTES or sha256(body).hexdigest() != passage.text_sha256:
            raise PassageSelectionError("passage_invalid")
        seen.add(passage.locator)
        total += len(body)
        if total > MAX_CAPTURE_TEXT_BYTES:
            raise PassageSelectionError("passage_capture_limit")
    return value


def select_changed_passages(
    current: PassageSnapshot, previous: PassageSnapshot | None = None,
) -> PassageSelection:
    """Skip exact same-locator text; retain removals and every new occurrence.

    Duplicate changed texts share payload text only within this one source-item
    comparison. All their exact locators remain. No cross-source deduplication,
    semantic equality, whitespace normalization or automatic rebinding occurs.
    """
    current = _validate(current)
    if previous is not None:
        previous = _validate(previous)
        if any(getattr(previous, field) != getattr(current, field) for field in
               ("source_key", "item_key", "mapping_sha256", "language_code")):
            raise PassageSelectionError("passage_baseline_binding_mismatch")
        if previous.content_sha256 == current.content_sha256 and previous.passages != current.passages:
            raise PassageSelectionError("source_hash_conflict")
        if (previous.source_version_id == current.source_version_id
                and previous.content_sha256 != current.content_sha256):
            raise PassageSelectionError("source_version_conflict")
    prior = {} if previous is None else {p.locator: p for p in previous.passages}
    present = {p.locator for p in current.passages}
    removed = tuple(locator for locator in prior if locator not in present)
    if removed:
        return PassageSelection("held", "passage_removed_or_relocated", removed_locators=removed)
    if not current.passages:
        return PassageSelection("held", "no_passages_supplied")
    unchanged = tuple(p.locator for p in current.passages if prior.get(p.locator) == p)
    groups: dict[str, dict[str, object]] = {}
    for passage in current.passages:
        if passage.locator in unchanged:
            continue
        # Exact text is the key: even a hypothetical digest collision cannot
        # collapse distinct texts or their provenance occurrences.
        group = groups.setdefault(passage.text, {"text": passage.text,
            "text_sha256": passage.text_sha256, "locators": []})
        group["locators"].append(passage.locator)
    if not groups:
        reason = ("source_changed_passages_unchanged" if previous is not None
                  and previous.content_sha256 != current.content_sha256 else "passages_unchanged")
        return PassageSelection("no_model_work", reason, unchanged)
    payload = json.dumps({
        "schema_version": 1, "kind": "private_changed_passages",
        "source_key": current.source_key, "item_key": current.item_key,
        "source_version_id": current.source_version_id,
        "content_sha256": current.content_sha256,
        "mapping_sha256": current.mapping_sha256, "language_code": current.language_code,
        "passages": list(groups.values()),
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_PAYLOAD_BYTES:
        return PassageSelection("held", "passage_payload_limit", unchanged)
    return PassageSelection("ready", "changed_passages", unchanged,
                            payload=payload, payload_sha256=sha256(payload).hexdigest())
