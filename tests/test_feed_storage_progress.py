"""Conditional receipt matching, never actual durable/checkpoint acceptance."""

from dataclasses import replace
from datetime import timedelta
import unittest

from tests.test_feed_discovery import entry, receipt, rss
from workers.feed_discovery import FeedDiscoveryError, discover_feed_entries
from workers.feed_storage_progress import FeedPageStoredReceipt, FeedItemStoredReceipt, plan_stored_feed_window


def uid(number):
    return f"20000000-0000-4000-8000-{number:012d}"


def fixtures(raw=None):
    raw = rss(entry() + entry("bad", "http://127.0.0.1/private") + entry("second", "https://example.org/two")) if raw is None else raw
    source = receipt(raw); at = source.retrieved_at + timedelta(seconds=1)
    page = discover_feed_entries(raw, source, expected_format="rss20")
    stored = FeedPageStoredReceipt(source, page.parser_identity, uid(1), uid(2), at)
    refs = [FeedItemStoredReceipt(source.source_key, source.source_version_id, source.content_sha256,
        uid(1), uid(2), uid(index + 3), lead.locator, lead.entry_id, None, "failed" if index == 0 else "processed", at)
        for index, lead in enumerate(page.entries)]
    refs += [FeedItemStoredReceipt(source.source_key, source.source_version_id, source.content_sha256,
        uid(1), uid(2), uid(index + 20), f"feed-entry:{held.entry_number}", held.entry_id, held.reason_code, "parse_held", at)
        for index, held in enumerate(page.held)]
    return raw, source, at, stored, tuple(refs)


def plan(values=None, **changes):
    raw, source, at, stored, refs = fixtures() if values is None else values
    params = dict(expected_format="rss20", observed_at=at, page_receipt=stored, item_receipts=refs)
    params.update(changes)
    return plan_stored_feed_window(raw, source, **params)


class FeedStorageProgressTests(unittest.TestCase):
    def test_matching_page_and_all_references_preserve_failed_and_parse_held_work(self):
        result = plan()
        self.assertEqual(result.state, "proposed_stored_window")
        self.assertEqual(result.pending_locators, ("feed-entry:1",))
        self.assertEqual(result.held_locators, ("feed-entry:2",))
        self.assertEqual(result.evidence_state, "supplied_storage_assertions_only")
        self.assertIsNone(result.proposed_next_url)

    def test_missing_page_or_reference_cannot_propose_progress(self):
        values = fixtures()
        for changes in [{"page_receipt": None}, {"item_receipts": values[-1][:-1]},
                        {"item_receipts": (*values[-1], values[-1][0])}, {"item_receipts": list(values[-1])}]:
            result = plan(values, **changes); self.assertEqual(result.state, "held")
            self.assertIsNone(result.proposed_next_url)

    def test_page_binding_checks_exact_retrieval_not_equal_source_bytes_alone(self):
        values = fixtures(); raw, source, at, stored, refs = values
        for changes in [{"source": replace(source, retrieved_at=source.retrieved_at - timedelta(seconds=1))},
                        {"source": replace(source, source_key="foreign")}, {"source": replace(source, feed_url="https://example.org/other")},
                        {"parser_identity": "latest"}, {"storage_batch_id": "bad"}, {"page_record_id": "bad"},
                        {"stored_at": source.retrieved_at - timedelta(microseconds=1)}, {"stored_at": at + timedelta(microseconds=1)}]:
            with self.subTest(changes=changes):
                self.assertEqual(plan(values, page_receipt=replace(stored, **changes)).state, "held")

    def test_foreign_stale_duplicate_or_extra_element_references_refuse_whole_page(self):
        values = fixtures(); raw, source, at, stored, refs = values
        for changes in [{"source_key": "foreign"}, {"source_version_id": uid(99)}, {"source_content_sha256": "f" * 64},
                        {"storage_batch_id": uid(99)}, {"page_record_id": uid(99)}, {"locator": "feed-entry:50"},
                        {"entry_id": "foreign"}, {"held_reason": "entry_identity_invalid"},
                        {"item_state_record_id": refs[1].item_state_record_id}, {"stored_at": at + timedelta(microseconds=1)}]:
            with self.subTest(changes=changes):
                self.assertEqual(plan(values, item_receipts=(replace(refs[0], **changes), *refs[1:])).state, "held")
        self.assertEqual(plan(values, item_receipts=(refs[0], refs[0], refs[2])).state, "held")

    def test_known_held_identity_and_exact_reason_cannot_be_dropped_or_mislabelled_as_processed(self):
        values = fixtures(); refs = values[-1]
        for changes in [{"entry_id": None}, {"held_reason": "entry_identity_invalid"}, {"processing_state": "processed"}]:
            self.assertEqual(plan(values, item_receipts=(*refs[:-1], replace(refs[-1], **changes))).state, "held")
        self.assertEqual(plan(values, item_receipts=(replace(refs[0], processing_state="parse_held"), *refs[1:])).state, "held")

    def test_advertised_next_page_never_grants_its_own_permission(self):
        raw = rss(entry(), '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="https://example.org/feed.xml?page=2"/>')
        values = fixtures(raw)
        unresolved = plan(values)
        self.assertEqual(unresolved.state, "proposed_stored_window_next_permission_unresolved")
        self.assertIsNone(unresolved.proposed_next_url); self.assertEqual(unresolved.pending_locators, ("feed-entry:1",))
        self.assertEqual(plan(values, allowed_next_url="https://example.org/feed.xml?page=2").proposed_next_url,
                         "https://example.org/feed.xml?page=2")
        for url in ["https://example.org/other", "https://example.org/?token=PRIVATE", "http://127.0.0.1/"]:
            self.assertEqual(plan(values, allowed_next_url=url).state, "held")

    def test_empty_single_window_is_not_complete_history_or_an_unavailable_page(self):
        result = plan(fixtures(rss()))
        self.assertEqual(result.state, "proposed_stored_window")
        self.assertEqual(result.pending_locators, ()); self.assertIsNone(result.proposed_next_url)
        self.assertNotIn("complete", result.state)

    def test_next_permission_mismatch_preserves_already_matched_pending_and_held_work(self):
        raw = rss(entry() + entry("bad", "http://127.0.0.1/private"),
            '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="https://example.org/feed.xml?page=2"/>')
        result = plan(fixtures(raw), allowed_next_url="https://example.org/other")
        self.assertEqual(result.state, "held")
        self.assertIsNone(result.proposed_next_url)
        self.assertEqual(result.pending_locators, ("feed-entry:1",))
        self.assertEqual(result.held_locators, ("feed-entry:2",))

    def test_receipt_order_does_not_change_locator_results_or_mutate_independent_states(self):
        values = fixtures(); self.assertEqual(plan(values), plan(values, item_receipts=tuple(reversed(values[-1]))))

    def test_invalid_raw_or_observation_cannot_mint_an_empty_success(self):
        values = fixtures()
        for at in [None, values[1].retrieved_at.replace(tzinfo=None), values[1].retrieved_at - timedelta(microseconds=1)]:
            self.assertEqual(plan(values, observed_at=at).state, "held")
        with self.assertRaises(FeedDiscoveryError):
            plan_stored_feed_window(b'<rss/>', values[1], expected_format="rss20", observed_at=values[2], page_receipt=values[3], item_receipts=())


if __name__ == "__main__":
    unittest.main()
