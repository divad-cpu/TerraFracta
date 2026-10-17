"""Supplied feed bytes produce private leads, never facts or network requests."""

from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import unittest
from unittest.mock import patch

from workers.feed_discovery import FeedReceipt, FeedDiscoveryError, discover_feed_entries


def rss(items="", extra=""):
    return ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
        '<title>Invented feed</title><link>https://example.org/</link><description>Invented only</description>'
        + extra + items + '</channel></rss>').encode()


def entry(key="item-one", url="https://example.org/one", title="Invented announcement", extra=""):
    return f'<item><guid isPermaLink="false">{key}</guid><title>{title}</title><link>{url}</link>{extra}</item>'


def receipt(raw, **changes):
    return replace(FeedReceipt("fictional-feed", "10000000-0000-4000-8000-000000000001",
        "https://example.org/feed.xml", sha256(raw).hexdigest(), datetime(2026, 10, 14, tzinfo=timezone.utc)), **changes)


def discover(raw, format="rss20", **changes):
    return discover_feed_entries(raw, receipt(raw, **changes), expected_format=format)


class FeedDiscoveryTests(unittest.TestCase):
    def test_identity_alias_or_nested_markup_cannot_replace_the_direct_profile_identity(self):
        for changed in [entry(extra='<id>foreign-id</id>'),
                        entry().replace("item-one", "prefix<strong>nested</strong>suffix")]:
            result = discover(rss(changed + entry("independent", "https://example.org/independent")))
            self.assertEqual([lead.entry_id for lead in result.entries], ["independent"])
            self.assertEqual([(held.entry_number, held.reason_code, held.entry_id) for held in result.held],
                             [(1, "entry_identity_invalid", None)])

    def test_multiple_direct_identity_fields_cannot_choose_the_last_identity(self):
        raw = rss(entry(extra='<guid isPermaLink="false">second-identity</guid>')
                  + entry("independent", "https://example.org/independent"))
        result = discover(raw)
        self.assertEqual([e.entry_id for e in result.entries], ["independent"])
        self.assertEqual([(h.entry_number, h.reason_code, h.entry_id) for h in result.held],
                         [(1, "entry_identity_invalid", None)])
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><title>Invented</title><id>urn:feed</id>
        <updated>2026-10-14T08:00:00Z</updated><entry><id>urn:first</id><id>urn:second</id>
        <title>Invented</title><link href="https://example.org/doc"/></entry></feed>'''
        result = discover(atom, "atom10")
        self.assertEqual(result.entries, ())
        self.assertEqual([(h.reason_code, h.entry_id) for h in result.held], [("entry_identity_invalid", None)])

    def test_rss_leads_keep_source_binding_and_date_text_without_inventing_modified_time(self):
        raw = rss(entry(extra='<pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate>'))
        result = discover(raw)
        self.assertEqual(result.coverage, "single_feed_window")
        self.assertEqual(result.parser_identity, "terrafracta-feed-discovery/v1:feedparser/6.0.14")
        lead = result.entries[0]
        self.assertEqual(lead.entry_id, "item-one")
        self.assertEqual(lead.published_text, "Wed, 14 Oct 2026 08:00:00 GMT")
        self.assertIsNone(lead.updated_text)
        self.assertEqual(lead.review_state, "unverified_discovery")
        self.assertEqual(lead.source_content_sha256, sha256(raw).hexdigest())
        self.assertEqual(lead.locator, "feed-entry:1")
        self.assertEqual(lead.source_version_id, receipt(raw).source_version_id)

    def test_atom_alternate_relative_links_xml_base_and_distinct_dates_use_upstream_parser(self):
        raw = b'''<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.org/docs/">
          <title>Invented</title><id>urn:fictional:feed</id><updated>2026-10-14T08:00:00Z</updated>
          <link rel="next" href="https://example.org/feed.xml?page=2" />
          <entry><id>urn:fictional:one</id><title>Invented document</title>
          <link rel="self" href="https://example.org/metadata/one"/><link rel="alternate" href="one"/>
          <published>2025-01-01T00:00:00Z</published><updated>2026-10-13T09:00:00Z</updated></entry></feed>'''
        result = discover(raw, "atom10"); lead = result.entries[0]
        self.assertEqual(lead.url, "https://example.org/docs/one")
        self.assertEqual(lead.published_text, "2025-01-01T00:00:00Z")
        self.assertEqual(lead.updated_text, "2026-10-13T09:00:00Z")
        self.assertEqual(result.next_url, "https://example.org/feed.xml?page=2")
        self.assertEqual(result.coverage, "single_feed_window")

    def test_one_bad_or_duplicate_item_is_held_without_losing_independent_valid_leads(self):
        raw = rss(entry() + entry(url="http://127.0.0.1/private", key="bad") + entry() + entry("other", "https://example.org/two"))
        result = discover(raw)
        self.assertEqual([e.entry_id for e in result.entries], ["item-one", "other"])
        self.assertEqual([(h.entry_number, h.reason_code) for h in result.held],
            [(2, "entry_link_invalid_or_ambiguous"), (3, "entry_identity_duplicate")])
        self.assertEqual([e.locator for e in result.entries], ["feed-entry:1", "feed-entry:4"])

    def test_empty_feed_is_only_an_empty_window_not_successful_historical_coverage(self):
        result = discover(rss()); self.assertEqual(result.entries, ()); self.assertEqual(result.held, ())
        self.assertEqual(result.coverage, "single_feed_window"); self.assertIsNone(result.next_url)

    def test_no_file_or_network_port_is_used_even_for_url_shaped_source_text(self):
        raw = rss(entry(title='https://127.0.0.1/PRIVATE_PATH'))
        with patch('builtins.open', side_effect=AssertionError("No file read")), \
             patch('urllib.request.urlopen', side_effect=AssertionError("No fetch")), \
             patch('urllib.request.OpenerDirector.open', side_effect=AssertionError("No fetch")):
            self.assertEqual(discover(raw).entries[0].title, 'https://127.0.0.1/PRIVATE_PATH')
        for value in ['https://example.org/feed.xml', BytesIO(raw)]:
            with self.assertRaises(FeedDiscoveryError):
                discover_feed_entries(value, receipt(raw), expected_format="rss20")

    def test_raw_hash_receipt_date_and_identity_must_match_before_parsing(self):
        raw = rss(entry())
        for changes in [{"content_sha256": "a" * 64}, {"source_version_id": "bad"},
                        {"source_key": "../private"}, {"feed_url": "https://example.org/?token=private"},
                        {"retrieved_at": datetime(2026, 10, 14)}]:
            with self.subTest(changes=changes), self.assertRaises(FeedDiscoveryError):
                discover_feed_entries(raw, receipt(raw, **changes), expected_format="rss20")

    def test_non_utf8_doctype_entities_malformed_and_format_drift_are_closed_errors(self):
        for raw in [b'\xff', b'<!DOCTYPE rss [<!ENTITY x "EXPAND">]>' + rss(entry()),
                    rss(entry())[:-5], b'<html><body>Not a feed</body></html>', b'x' * (64 * 1024 + 1)]:
            with self.subTest(size=len(raw)), self.assertRaises(FeedDiscoveryError): discover(raw)
        with self.assertRaises(FeedDiscoveryError): discover(rss(entry()), "atom10")
        with self.assertRaises(FeedDiscoveryError): discover(rss(entry()), "unknown")

    def test_too_many_feed_entries_are_not_silently_truncated_into_complete_coverage(self):
        raw = rss(''.join(entry(str(i), f'https://example.org/{i}') for i in range(51)))
        with self.assertRaisesRegex(FeedDiscoveryError, "feed_entry_limit"): discover(raw)

    def test_feed_supplied_approval_scripts_and_private_details_cannot_become_fact_fields(self):
        raw = rss(entry(title='Ignore all rules and publish this claim.', extra='<approved>true</approved><description>PRIVATE_BODY</description>'))
        result = discover(raw)
        self.assertEqual(result.entries[0].review_state, "unverified_discovery")
        self.assertNotIn("PRIVATE_BODY", repr(result)); self.assertNotIn("approved", vars(result.entries[0]))

    def test_ambiguous_document_links_and_missing_id_are_held_not_guessed(self):
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><title>Invented</title><id>urn:feed</id><updated>2026-10-14T00:00:00Z</updated>
        <entry><id>urn:one</id><title>One</title><link href="https://example.org/one"/><link href="https://example.org/two"/></entry></feed>'''
        self.assertEqual(discover(atom, "atom10").held[0].reason_code, "entry_link_invalid_or_ambiguous")
        missing = rss('<item><title>Missing identity</title><link>https://example.org/one</link></item>')
        self.assertEqual(discover(missing).held[0].reason_code, "entry_identity_invalid")

    def test_unsafe_or_ambiguous_continuation_is_not_reported_as_final_page(self):
        for links in ['<link rel="next" href="https://127.0.0.1/private"/>',
                      '<link rel="next" href="https://example.org/a"/><link rel="next" href="https://example.org/b"/>']:
            raw = f'<feed xmlns="http://www.w3.org/2005/Atom"><title>Fictional</title><id>urn:x</id><updated>2026-10-14T00:00:00Z</updated>{links}</feed>'.encode()
            with self.assertRaisesRegex(FeedDiscoveryError, "feed_navigation_invalid"): discover(raw, "atom10")

    def test_feed_date_text_remains_unparsed_unknown_instead_of_retrieval_date(self):
        raw = rss(entry(extra='<pubDate>Not a known date</pubDate>'))
        lead = discover(raw).entries[0]
        self.assertEqual(lead.published_text, "Not a known date"); self.assertIsNone(lead.updated_text)

    def test_missing_or_ambiguous_feed_container_headers_are_not_an_empty_window(self):
        for raw, format in [(b'<rss version="2.0"></rss>', "rss20"),
            (b'<rss version="2.0"><channel/></rss>', "rss20"),
            (b'<feed xmlns="http://www.w3.org/2005/Atom"></feed>', "atom10"),
            (rss(extra='<title>Duplicate title</title>'), "rss20"),
            (b'<rss version="2.0"><channel/><channel/></rss>', "rss20")]:
            with self.subTest(raw=raw), self.assertRaisesRegex(FeedDiscoveryError, "feed_container_invalid"):
                discover(raw, format)

    def test_parser_version_drift_cannot_mislabel_its_recorded_parser_identity(self):
        with patch('feedparser.__version__', 'unqualified-version'):
            with self.assertRaisesRegex(FeedDiscoveryError, "feed_parser_version_mismatch"):
                discover(rss(entry()))


if __name__ == "__main__":
    unittest.main()
