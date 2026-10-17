"""Match supplied storage assertions before proposing a feed traversal step.

No storage backend is selected or called. A matching assertion is NOT durable
storage proof, source permission, a checkpoint write or complete feed coverage.
The future trusted writer must authenticate these receipts, recheck policy and
atomically store the actual cursor. Existing SSB checkpoint rules are untouched.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from re import fullmatch

from workers.feed_discovery import FeedReceipt, discover_feed_entries
from workers.public_source_url import public_https_source_url


@dataclass(frozen=True)
class FeedPageStoredReceipt:
    source: FeedReceipt  # Includes the exact retrieval observation, not hash alone.
    parser_identity: str
    storage_batch_id: str
    page_record_id: str
    stored_at: datetime


@dataclass(frozen=True)
class FeedItemStoredReceipt:
    source_key: str
    source_version_id: str
    source_content_sha256: str
    storage_batch_id: str
    page_record_id: str
    item_state_record_id: str
    locator: str
    entry_id: str | None
    held_reason: str | None
    processing_state: str
    stored_at: datetime


@dataclass(frozen=True)
class FeedStorageProgress:
    state: str
    reason_code: str
    proposed_next_url: str | None = None
    pending_locators: tuple[str, ...] = ()
    held_locators: tuple[str, ...] = ()
    # Every outcome remains conditional on independently authenticated storage.
    evidence_state: str = "supplied_storage_assertions_only"


def _uuid(value):
    return type(value) is str and fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", value) is not None


def _utc(value):
    return type(value) is datetime and value.tzinfo is not None and value.utcoffset() == timezone.utc.utcoffset(value)


def plan_stored_feed_window(
    raw: bytes, source: FeedReceipt, *, expected_format: str, observed_at: datetime,
    page_receipt: FeedPageStoredReceipt | None,
    item_receipts: tuple[FeedItemStoredReceipt, ...], allowed_next_url: str | None = None,
) -> FeedStorageProgress:
    """A bounded, conditional plan; extraction failures stay separately visible.

    allowed_next_url is an exact independently supplied permission assertion,
    never inferred from an advertised link or public URL shape. Even a matched
    next URL still needs the future fetcher's origin/redirect/network controls.
    """
    page = discover_feed_entries(raw, source, expected_format=expected_format)
    hold = lambda reason: FeedStorageProgress("held", reason)
    if not _utc(observed_at) or observed_at < source.retrieved_at:
        return hold("storage_observation_invalid")
    if not isinstance(page_receipt, FeedPageStoredReceipt):
        return hold("page_storage_unconfirmed")
    stored = page_receipt
    if (type(stored.source) is not FeedReceipt or stored.source != source
            or stored.parser_identity != page.parser_identity
            or not _uuid(stored.storage_batch_id) or not _uuid(stored.page_record_id)
            or not _utc(stored.stored_at) or not source.retrieved_at <= stored.stored_at <= observed_at):
        return hold("page_storage_binding_mismatch")
    expected = {lead.locator: (lead.entry_id, None) for lead in page.entries}
    expected.update({f"feed-entry:{held.entry_number}": (held.entry_id, held.reason_code) for held in page.held})
    if type(item_receipts) is not tuple or len(item_receipts) != len(expected):
        return hold("item_storage_coverage_mismatch")
    seen, records, pending, held_locators = set(), set(), [], []
    for receipt in item_receipts:
        if (not isinstance(receipt, FeedItemStoredReceipt) or type(receipt.locator) is not str
                or receipt.locator not in expected or receipt.locator in seen
                or not _uuid(receipt.item_state_record_id) or receipt.item_state_record_id in records
                or (receipt.source_key, receipt.source_version_id, receipt.source_content_sha256) !=
                   (source.source_key, source.source_version_id, source.content_sha256)
                or receipt.storage_batch_id != stored.storage_batch_id or receipt.page_record_id != stored.page_record_id
                or not _utc(receipt.stored_at) or not source.retrieved_at <= receipt.stored_at <= observed_at
                or (receipt.entry_id, receipt.held_reason) != expected[receipt.locator]):
            return hold("item_storage_binding_mismatch")
        _, reason = expected[receipt.locator]
        if reason is not None:
            if receipt.processing_state != "parse_held":
                return hold("item_storage_processing_mismatch")
            held_locators.append(receipt.locator)
        elif receipt.processing_state not in ("pending", "failed", "processed"):
            return hold("item_storage_processing_mismatch")
        elif receipt.processing_state != "processed":
            pending.append(receipt.locator)
        seen.add(receipt.locator); records.add(receipt.item_state_record_id)
    # Canonical source order, independent of storage acknowledgement order.
    position = lambda locator: int(locator.split(":")[1])
    pending_tuple, held_tuple = tuple(sorted(pending, key=position)), tuple(sorted(held_locators, key=position))
    if allowed_next_url is not None and (not public_https_source_url(allowed_next_url) or allowed_next_url != page.next_url):
        return FeedStorageProgress("held", "next_page_permission_mismatch",
                                   pending_locators=pending_tuple, held_locators=held_tuple)
    if page.next_url is not None and allowed_next_url is None:
        return FeedStorageProgress("proposed_stored_window_next_permission_unresolved", "next_page_permission_unresolved",
                                   pending_locators=pending_tuple, held_locators=held_tuple)
    return FeedStorageProgress("proposed_stored_window", "supplied_page_and_references_match",
                               page.next_url, pending_tuple, held_tuple)
