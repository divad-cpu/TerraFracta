"""Discovery-window revisions preserve provenance, uncertainty and old vintages."""

from datetime import timedelta
import unittest

from tests.test_feed_discovery import entry, receipt, rss
from workers.feed_discovery import FeedDiscoveryError
from workers.feed_window_comparison import compare_feed_windows


def compare(current, old=None, **changes):
    params = dict(expected_format="rss20")
    if old is not None:
        params.update(previous_raw=old, previous_receipt=receipt(old, source_version_id="10000000-0000-4000-8000-000000000002"))
    params.update(changes)
    return compare_feed_windows(current, receipt(current), **params)


class FeedWindowComparisonTests(unittest.TestCase):
    def test_first_observed_is_not_a_claim_of_newly_published_document_or_coverage(self):
        raw = rss(entry(extra='<pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate>'))
        result = compare(raw)
        self.assertIsNone(result.source_bytes_changed)
        self.assertEqual(result.changes[0].state, "first_observed")
        self.assertEqual(result.review_state, "unverified_discovery_comparison")
        self.assertEqual(result.current.coverage, "single_feed_window")

    def test_raw_byte_change_and_reobserved_metadata_are_separate(self):
        old = rss(entry())
        current = old.replace(b'<item>', b'\n<item>')
        result = compare(current, old)
        self.assertTrue(result.source_bytes_changed)
        self.assertEqual(result.changes[0].state, "reobserved_metadata")
        self.assertNotEqual(result.changes[0].current.source_content_sha256, result.changes[0].previous.source_content_sha256)

    def test_same_identity_revision_keeps_both_complete_metadata_vintages(self):
        result = compare(rss(entry(title="Revised invented title")), rss(entry()))
        row = result.changes[0]
        self.assertEqual(row.state, "metadata_revised")
        self.assertEqual(row.previous.title, "Invented announcement")
        self.assertEqual(row.current.title, "Revised invented title")
        self.assertNotEqual(row.previous.source_version_id, row.current.source_version_id)
        self.assertEqual(row.current.review_state, "unverified_discovery")

    def test_feed_rolloff_does_not_withdraw_a_prior_document(self):
        old = rss(entry() + entry("two", "https://example.org/two"))
        result = compare(rss(entry("two", "https://example.org/two")), old)
        self.assertEqual(result.not_reobserved[0].previous.entry_id, "item-one")
        self.assertEqual(result.not_reobserved[0].reason_code, "not_in_current_feed_window")
        self.assertEqual(result.changes[0].state, "reobserved_metadata")
        self.assertEqual(result.changes[0].previous.locator, "feed-entry:2")
        self.assertEqual(result.changes[0].current.locator, "feed-entry:1")

    def test_changed_source_endpoint_identity_time_or_reused_version_refuses_baseline(self):
        old, current = rss(entry()), rss(entry(title="Changed"))
        for changes in [{"source_key": "other"}, {"feed_url": "https://example.org/other"},
                        {"retrieved_at": receipt(old).retrieved_at + timedelta(seconds=1)},
                        {"source_version_id": receipt(current).source_version_id}]:
            prior = receipt(old, source_version_id="10000000-0000-4000-8000-000000000002", **changes) if "source_version_id" not in changes else receipt(old, **changes)
            with self.subTest(changes=changes), self.assertRaises(FeedDiscoveryError):
                compare_feed_windows(current, receipt(current), expected_format="rss20", previous_raw=old, previous_receipt=prior)

    def test_duplicate_or_invalid_identity_affects_only_its_correlated_comparison(self):
        old = rss(entry() + entry("two", "https://example.org/two"))
        current = rss(entry() + entry(title="Conflicting duplicate") + entry("two", "https://example.org/two"))
        result = compare(current, old)
        self.assertEqual([row.state for row in result.changes], ["held_current_entry", "reobserved_metadata"])
        result = compare(rss(entry(url="http://127.0.0.1/") + entry("two", "https://example.org/two")), old)
        self.assertEqual(result.not_reobserved[0].reason_code, "held_in_current_window")
        self.assertEqual(result.changes[0].state, "reobserved_metadata")

    def test_ambiguous_prior_identity_is_not_a_trusted_unchanged_baseline(self):
        result = compare(rss(entry()), rss(entry() + entry(title="Duplicate")))
        self.assertEqual(result.changes[0].state, "held_baseline_entry")

    def test_missing_baseline_half_and_malformed_current_window_cannot_mint_empty_success(self):
        raw = rss(entry())
        with self.assertRaises(FeedDiscoveryError): compare(raw, previous_raw=raw)
        with self.assertRaises(FeedDiscoveryError): compare(b'<rss version="2.0"/>', raw)


if __name__ == "__main__":
    unittest.main()
