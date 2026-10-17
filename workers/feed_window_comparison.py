"""Compare two private discovery windows without inferring disappearance.

Stable feed IDs join metadata only. No original document is fetched, no fact
is revised, and no checkpoint/history/publication is persisted or advanced.
"""

from __future__ import annotations

from dataclasses import dataclass

from workers.feed_discovery import (
    FeedDiscoveryError, FeedDiscoveryPage, FeedEntryLead, FeedReceipt, discover_feed_entries,
)


@dataclass(frozen=True)
class FeedMetadataChange:
    state: str
    current: FeedEntryLead
    previous: FeedEntryLead | None


@dataclass(frozen=True)
class FeedNotReobserved:
    previous: FeedEntryLead
    reason_code: str


@dataclass(frozen=True)
class FeedWindowComparison:
    current: FeedDiscoveryPage
    previous: FeedDiscoveryPage | None
    source_bytes_changed: bool | None
    changes: tuple[FeedMetadataChange, ...]
    not_reobserved: tuple[FeedNotReobserved, ...]
    review_state: str = "unverified_discovery_comparison"


def _metadata(lead: FeedEntryLead) -> tuple[object, ...]:
    # Feed order/locator and source-version provenance remain on both complete
    # objects. A new locator alone is not an original-document content change.
    return lead.entry_id, lead.title, lead.url, lead.published_text, lead.updated_text


def compare_feed_windows(
    current_raw: bytes, current_receipt: FeedReceipt, *, expected_format: str,
    previous_raw: bytes | None = None, previous_receipt: FeedReceipt | None = None,
) -> FeedWindowComparison:
    """Retain both exact vintages; a missing feed lead is never a retraction."""
    if (previous_raw is None) != (previous_receipt is None):
        raise FeedDiscoveryError("feed_comparison_baseline_missing")
    current = discover_feed_entries(current_raw, current_receipt, expected_format=expected_format)
    previous = None if previous_receipt is None else discover_feed_entries(previous_raw, previous_receipt, expected_format=expected_format)
    if previous is not None:
        if (current.source.source_key != previous.source.source_key
                or current.source.feed_url != previous.source.feed_url
                or current.source.retrieved_at < previous.source.retrieved_at):
            raise FeedDiscoveryError("feed_comparison_scope_or_time_mismatch")
        if (current.source.source_version_id == previous.source.source_version_id
                and current_raw != previous_raw):
            raise FeedDiscoveryError("feed_comparison_version_conflict")
        if current.source.content_sha256 == previous.source.content_sha256 and current_raw != previous_raw:
            raise FeedDiscoveryError("feed_comparison_hash_conflict")
    prior = {} if previous is None else {lead.entry_id: lead for lead in previous.entries}
    present = {lead.entry_id for lead in current.entries}
    uncertain_current = {held.entry_id for held in current.held if held.entry_id is not None}
    uncertain_prior = set() if previous is None else {held.entry_id for held in previous.held if held.entry_id is not None}
    changes = []
    for lead in current.entries:
        old = prior.get(lead.entry_id)
        state = ("held_current_entry" if lead.entry_id in uncertain_current else
                 "held_baseline_entry" if lead.entry_id in uncertain_prior else
                 "first_observed" if old is None else
                 "reobserved_metadata" if _metadata(lead) == _metadata(old) else "metadata_revised")
        changes.append(FeedMetadataChange(state, lead, old))
    missing = tuple(FeedNotReobserved(lead, "held_in_current_window" if lead.entry_id in uncertain_current
                                   else "not_in_current_feed_window") for key, lead in prior.items() if key not in present)
    return FeedWindowComparison(current, previous,
        None if previous is None else current_raw != previous_raw, tuple(changes), missing)
