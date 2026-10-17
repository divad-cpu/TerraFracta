import assert from "node:assert/strict";
import test from "node:test";
import { feedDiscoveryReport as parse } from "../src/feed-discovery-report.ts";
import { feedReport } from "./helpers/feed_discovery_fixture.mjs";

test("actual Python-generated report retains two independently bound vintages and scoped holds", () => {
  const report = parse(feedReport()); assert.ok(report);
  assert.equal(report.changes[0].state, "metadata_revised");
  assert.notEqual(report.changes[0].current.source_content_sha256, report.changes[0].previous.source_content_sha256);
  assert.deepEqual(report.not_reobserved.map(row => row.reason_code), ["not_in_current_feed_window", "held_in_current_window"]);
});
test("closed report refuses unknown fields, permissions and fabricated publication state", () => {
  for (const change of [value => value.apiKey = "PRIVATE", value => value.current.approved = true,
    value => value.current.entries[0].review_state = "verified", value => value.kind = "approved_discovery_report"]) {
    const value = feedReport(); change(value); assert.equal(parse(value), null);
  }
});
test("mismatched current and earlier source bindings refuse the complete report", () => {
  for (const change of [value => value.current.entries[0].source_content_sha256 = "f".repeat(64),
    value => value.changes[0].previous.source_version_id = value.current.source.source_version_id,
    value => value.previous.source.source_key = "foreign-feed",
    value => value.previous.source.feed_url = "https://example.org/foreign",
    value => value.current.source.source_version_id = value.previous.source.source_version_id]) {
    const value = feedReport(); change(value); assert.equal(parse(value), null);
  }
});
test("omitted, duplicate, reordered and contradictory comparison rows refuse rather than partially display", () => {
  for (const change of [value => value.changes.pop(), value => value.changes.reverse(),
    value => value.changes[0].state = "reobserved_metadata", value => value.not_reobserved.pop(),
    value => value.not_reobserved[1].reason_code = "not_in_current_feed_window",
    value => value.current.held[0].entry_number = 1, value => value.current.entries.push(value.current.entries[0])]) {
    const value = feedReport(); change(value); assert.equal(parse(value), null);
  }
});
test("unsafe addresses, excessive arrays and parser identity drift refuse", () => {
  for (const change of [value => value.current.next_url = "https://example.org/?token=PRIVATE",
    value => value.current.entries[0].url = "javascript:alert(1)", value => value.current.held = Array(51).fill(value.current.held[0]),
    value => value.current.parser_identity = "unlocked/latest"]) {
    const value = feedReport(); change(value); assert.equal(parse(value), null);
  }
});
test("no baseline is distinct from unchanged and missing history cannot support revised metadata", () => {
  const value = feedReport(); value.previous = null; value.source_bytes_changed = null; value.not_reobserved = [];
  value.changes = value.current.entries.map(current => ({ state: "first_observed", current, previous: null }));
  assert.ok(parse(value)); value.source_bytes_changed = false; assert.equal(parse(value), null);
});
test("empty valid windows remain bounded unknown history rather than an unavailable report", () => {
  const value = feedReport(); value.current.entries = []; value.current.held = []; value.previous.entries = [];
  value.changes = []; value.not_reobserved = []; assert.ok(parse(value));
  value.current.coverage = "complete_history"; assert.equal(parse(value), null);
});
test("exact supplied UTC chronology is checked without reading the current clock", () => {
  const value = feedReport(); value.previous.source.retrieved_at = "2026-10-14T12:00:00.000001Z";
  assert.equal(parse(value), null); value.previous.source.retrieved_at = "0000-10-14T11:00:00.000000Z";
  assert.equal(parse(value), null);
});
test("an invalid held identity cannot correlate a known earlier item", () => {
  const value = feedReport(); value.current.held[0].reason_code = "entry_identity_invalid";
  assert.equal(parse(value), null);
  value.current.held[0].entry_id = null;
  value.not_reobserved[1].reason_code = "not_in_current_feed_window";
  assert.ok(parse(value));
  value.current.held[0].reason_code = "entry_title_invalid";
  assert.equal(parse(value), null);
});
