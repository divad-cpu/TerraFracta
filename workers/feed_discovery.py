"""Bounded offline RSS2/Atom1 document leads from already supplied bytes.

Feed metadata is untrusted discovery, not source approval, factual support,
historical coverage, a durable checkpoint or permission to fetch/retain/reuse.
The parser receives BytesIO only, never a source-controlled URL or filename.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from re import fullmatch
from xml.etree import ElementTree

import feedparser

from workers.public_source_url import public_https_source_url


MAX_FEED_BYTES = 64 * 1024
MAX_FEED_ENTRIES = 50
PARSER_IDENTITY = "terrafracta-feed-discovery/v1:feedparser/6.0.14"


class FeedDiscoveryError(ValueError):
    """A supplied feed cannot produce a bounded discovery page."""


@dataclass(frozen=True)
class FeedReceipt:
    source_key: str
    source_version_id: str
    feed_url: str
    content_sha256: str
    retrieved_at: datetime


@dataclass(frozen=True)
class FeedEntryLead:
    source_key: str
    source_version_id: str
    source_content_sha256: str
    entry_id: str
    title: str
    url: str
    locator: str
    published_text: str | None
    updated_text: str | None
    review_state: str = "unverified_discovery"


@dataclass(frozen=True)
class HeldFeedEntry:
    entry_number: int
    reason_code: str
    # Only an already bounded valid identity, never an invalid raw value. This
    # lets later comparisons hold just the affected duplicate/invalid entry.
    entry_id: str | None = None


@dataclass(frozen=True)
class FeedDiscoveryPage:
    source: FeedReceipt
    format: str
    entries: tuple[FeedEntryLead, ...]
    held: tuple[HeldFeedEntry, ...]
    next_url: str | None
    parser_identity: str = PARSER_IDENTITY
    coverage: str = "single_feed_window"


def _plain(value: object, maximum: int) -> bool:
    return (type(value) is str and 1 <= len(value) <= maximum
            and bool(value.strip()) and all(ord(c) >= 32 for c in value))


def _links(value: object, relation: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise FeedDiscoveryError("feed_links_invalid")
    result = []
    for link in value:
        if not isinstance(link, dict):
            raise FeedDiscoveryError("feed_links_invalid")
        if link.get("rel", "alternate") == relation:
            href = link.get("href")
            if not public_https_source_url(href):
                raise FeedDiscoveryError("feed_links_invalid")
            if href not in result:
                result.append(href)
    return tuple(result)


def _container_identities(text: str, format: str) -> tuple[str | None, ...]:
    """Check the selected container profile, not a full source qualification.

    feedparser is intentionally tolerant and can report a known format with
    no channel/headers. Bound well-formed bytes and forbidden declarations
    precede this standard-library shape check; field extraction stays upstream.
    """
    try:
        root = ElementTree.fromstring(text)
    except (ElementTree.ParseError, ValueError) as exc:
        raise FeedDiscoveryError("feed_container_invalid") from exc
    if format == "rss20":
        channels = root.findall("channel")
        if root.tag != "rss" or root.get("version") != "2.0" or len(channels) != 1:
            raise FeedDiscoveryError("feed_container_invalid")
        container, prefix, fields, entry_name = channels[0], "", ("title", "link", "description"), "item"
    else:
        prefix = "{http://www.w3.org/2005/Atom}"
        if root.tag != prefix + "feed":
            raise FeedDiscoveryError("feed_container_invalid")
        container, fields, entry_name = root, ("title", "id", "updated"), "entry"
    if any(len(container.findall(prefix + field)) != 1
           or not "".join(container.find(prefix + field).itertext()).strip() for field in fields):
        raise FeedDiscoveryError("feed_container_invalid")
    identity_name = "guid" if format == "rss20" else "id"
    # A tolerant parser can pick an alias or silently strip nested markup from
    # an identifier. Check its result against one direct, text-only profile ID;
    # upstream still performs field extraction and link/date handling.
    identities = []
    for item in container.findall(prefix + entry_name):
        fields = item.findall(prefix + identity_name)
        identities.append(fields[0].text if len(fields) == 1 and len(fields[0]) == 0 else None)
    return tuple(identities)


def discover_feed_entries(
    raw: bytes, receipt: FeedReceipt, *, expected_format: str,
) -> FeedDiscoveryPage:
    """Parse a single supplied window; retain independent valid item proposals.

    Actual origin/redirect/network policy belongs to a separately authorized
    fetcher. Public URL shape is not an SSRF guarantee or a source-rights grant.
    All page-level problems refuse the page without a partial coverage claim.
    """
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_FEED_BYTES:
        raise FeedDiscoveryError("feed_bytes_invalid")
    if (not isinstance(receipt, FeedReceipt)
            or type(receipt.source_key) is not str or not fullmatch(r"[a-z0-9][a-z0-9:-]{0,119}", receipt.source_key)
            or type(receipt.source_version_id) is not str
            or not fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", receipt.source_version_id)
            or not public_https_source_url(receipt.feed_url)
            or type(receipt.content_sha256) is not str or receipt.content_sha256 != sha256(raw).hexdigest()
            or not isinstance(receipt.retrieved_at, datetime) or receipt.retrieved_at.tzinfo is None
            or receipt.retrieved_at.utcoffset() != timezone.utc.utcoffset(receipt.retrieved_at)):
        raise FeedDiscoveryError("feed_receipt_invalid")
    if expected_format not in ("rss20", "atom10"):
        raise FeedDiscoveryError("feed_format_unselected")
    if feedparser.__version__ != "6.0.14":
        raise FeedDiscoveryError("feed_parser_version_mismatch")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise FeedDiscoveryError("feed_encoding_invalid") from exc
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        raise FeedDiscoveryError("feed_declaration_refused")
    identities = _container_identities(text, expected_format)
    expected_entries = len(identities)
    if expected_entries > MAX_FEED_ENTRIES:
        raise FeedDiscoveryError("feed_entry_limit")
    try:
        media_type = "application/rss+xml" if expected_format == "rss20" else "application/atom+xml"
        parsed = feedparser.parse(BytesIO(raw), response_headers={"content-location": receipt.feed_url,
                                  "content-type": f"{media_type}; charset=utf-8"},
                                  resolve_relative_uris=False, sanitize_html=True)
    except Exception as exc:
        raise FeedDiscoveryError("feed_parser_unavailable") from exc
    if (parsed.get("bozo") not in (False, 0) or parsed.get("version") != expected_format
            or parsed.get("encoding", "").lower().replace("_", "-") != "utf-8"):
        raise FeedDiscoveryError("feed_format_or_xml_invalid")
    entries = parsed.get("entries")
    if not isinstance(entries, list) or len(entries) > MAX_FEED_ENTRIES:
        raise FeedDiscoveryError("feed_entry_limit")
    if len(entries) != expected_entries:
        raise FeedDiscoveryError("feed_container_entries_mismatch")
    try:
        next_links = _links(dict(parsed.get("feed", {})).get("links", []), "next")
        if len(next_links) > 1:
            raise FeedDiscoveryError("feed_navigation_invalid")
    except FeedDiscoveryError as exc:
        raise FeedDiscoveryError("feed_navigation_invalid") from exc
    leads, held, seen = [], [], set()
    for number, value in enumerate(entries, 1):
        item = dict(value)
        entry_id, title = item.get("id"), item.get("title")
        reason = None
        if not _plain(entry_id, 300) or entry_id != identities[number - 1]:
            reason = "entry_identity_invalid"
        elif entry_id in seen:
            reason = "entry_identity_duplicate"
        else:
            seen.add(entry_id)
        if reason is None and not _plain(title, 300):
            reason = "entry_title_invalid"
        try:
            links = _links(item.get("links", []), "alternate")
        except FeedDiscoveryError:
            links = ()
        if reason is None and len(links) != 1:
            reason = "entry_link_invalid_or_ambiguous"
        # Plain dict access avoids feedparser's compatibility fallback from a
        # missing updated field to published. Neither is a retrieval timestamp.
        published, updated = item.get("published"), item.get("updated")
        if reason is None and any(date is not None and not _plain(date, 160) for date in (published, updated)):
            reason = "entry_date_text_invalid"
        if reason is not None:
            held.append(HeldFeedEntry(number, reason, entry_id if reason != "entry_identity_invalid" else None))
            continue
        leads.append(FeedEntryLead(receipt.source_key, receipt.source_version_id, receipt.content_sha256,
                                   entry_id, title, links[0], f"feed-entry:{number}", published, updated))
    return FeedDiscoveryPage(receipt, expected_format, tuple(leads), tuple(held), next_links[0] if next_links else None)
