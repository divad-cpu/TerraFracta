"""Actual Python producer and retained, wholly invented editorial fixture."""

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import unittest

from tests.test_feed_discovery import entry, rss
from workers.feed_discovery import FeedReceipt, FeedDiscoveryError
from workers.feed_discovery_report import feed_discovery_report


def invented_report():
    old = rss(entry("revised", title="Invented earlier title")
              + entry("rolled-off") + entry("held"))
    current = rss(entry("revised", title="Invented revised title")
                  + entry("held", url="http://127.0.0.1/private")
                  + entry("first", title="Invented first observation",
                          extra="<pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate>"),
                  '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="https://example.org/feed.xml?page=2"/>')
    def receipt(raw, number, hour):
        return FeedReceipt("fictional-feed", f"10000000-0000-4000-8000-{number:012d}",
            "https://example.org/feed.xml", sha256(raw).hexdigest(),
            datetime(2026, 10, 14, hour, tzinfo=timezone.utc))
    return feed_discovery_report(current, receipt(current, 2, 12), expected_format="rss20",
        previous_raw=old, previous_receipt=receipt(old, 1, 11))


class FeedDiscoveryReportTests(unittest.TestCase):
    def test_checked_in_invented_fixture_equals_actual_parser_and_comparer_output(self):
        stored = json.loads((Path(__file__).parent.parent / "fixtures/fictional-feed-discovery.json").read_text())
        self.assertEqual(stored, invented_report())

    def test_json_roundtrip_preserves_both_vintages_and_independent_holds(self):
        report = json.loads(json.dumps(invented_report(), ensure_ascii=False, allow_nan=False))
        self.assertEqual(report["kind"], "private_feed_discovery_report")
        self.assertEqual(report["review_state"], "unverified_discovery_comparison")
        self.assertEqual(report["current"]["source"]["retrieved_at"], "2026-10-14T12:00:00.000000Z")
        self.assertNotEqual(report["current"]["source"]["content_sha256"], report["previous"]["source"]["content_sha256"])
        self.assertEqual(report["changes"][0]["previous"]["title"], "Invented earlier title")
        self.assertEqual(report["changes"][1]["state"], "first_observed")
        self.assertEqual([row["reason_code"] for row in report["not_reobserved"]],
                         ["not_in_current_feed_window", "held_in_current_window"])
        self.assertEqual(report["current"]["held"][0]["entry_id"], "held")
        self.assertNotIn("127.0.0.1", json.dumps(report))
        self.assertFalse(any(key in json.dumps(report) for key in ["<item>", "is_published", "api_key"]))

    def test_report_cannot_bypass_original_parser_or_scope_guards(self):
        with self.assertRaises(FeedDiscoveryError):
            feed_discovery_report(b"<rss/>", None, expected_format="rss20")


if __name__ == "__main__":
    unittest.main()
