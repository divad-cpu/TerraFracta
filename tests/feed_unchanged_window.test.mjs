import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { feedDiscoveryReport as parse } from "../src/feed-discovery-report.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { equalWindowReport, changedWindowReport } from "./helpers/feed_report_contract_fixture.mjs";
const View = loadTsx(new URL("../src/feed-discovery-view.tsx", import.meta.url)).FeedDiscoveryView;

for (const [field, replacement] of [["title", "CONTRADICTORY_PRIVATE_TITLE"], ["url", "https://example.org/contradictory"],
  ["published_text", "Different supplied publication"], ["updated_text", "Different supplied modification"]]) {
  test(`equal original bytes cannot change ${field} even with coherent comparison rows`, () => {
    const report = equalWindowReport(); report.current.entries[0][field] = replacement;
    report.changes[0].state = "metadata_revised";
    assert.equal(parse(report), null);
  });
}
test("equal bytes cannot change only the advertised next page", () => {
  const report = equalWindowReport(); report.current.next_url = "https://example.org/other-page";
  assert.equal(parse(report), null);
});
test("equal bytes cannot change a held reason or held identity", () => {
  for (const [field, replacement] of [["reason_code", "entry_title_invalid"], ["entry_id", "different-held-id"]]) {
    const report = equalWindowReport(); report.current.held[0][field] = replacement;
    assert.equal(parse(report), null, field);
  }
});
test("equal bytes cannot relocate or reorder entries with coherent row order", () => {
  const report = equalWindowReport();
  [report.current.entries[0].locator, report.current.entries[1].locator] = [report.current.entries[1].locator, report.current.entries[0].locator];
  assert.equal(parse(report), null, "locator-only relocation");
  const reordered = equalWindowReport(); reordered.current.entries.reverse(); reordered.changes.reverse();
  assert.equal(parse(reordered), null, "entry array order");
});
test("equal bytes cannot invent a new candidate and a rolled-off earlier lead", () => {
  const report = equalWindowReport(), previous = report.previous.entries[0];
  report.current.entries[0].entry_id = "invented-new-id";
  report.changes[0].state = "first_observed"; report.changes[0].previous = null;
  report.not_reobserved = [{ previous, reason_code: "not_in_current_feed_window" }];
  assert.equal(parse(report), null);
});
test("equal bytes permit distinct receipt versions and retrieval observations without rewriting metadata", () => {
  const report = equalWindowReport(), checked = parse(report);
  assert.ok(checked); assert.notEqual(checked.current.source.source_version_id, checked.previous.source.source_version_id);
  assert.notEqual(checked.current.source.retrieved_at, checked.previous.source.retrieved_at);
  assert.deepEqual(checked.current.entries.map(e => e.title), checked.previous.entries.map(e => e.title));
  assert.ok(checked.changes.every(row => row.state === "reobserved_metadata"));
  report.current.source.source_version_id = report.previous.source.source_version_id;
  for (const entry of report.current.entries) entry.source_version_id = report.current.source.source_version_id;
  assert.ok(parse(report), "same-version reobservation is still allowed");
});
test("changed bytes still permit a metadata revision and distinct next-page/held states", () => {
  const report = changedWindowReport(); report.current.entries[0].title = "Actual changed-byte candidate";
  report.changes[0].state = "metadata_revised"; report.current.next_url = null;
  report.current.held[0].reason_code = "entry_title_invalid";
  assert.ok(parse(report));
});
test("contradictory equal-byte report withholds all metadata in the real view", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source request"));
  const report = equalWindowReport(); report.current.entries[0].title = "CONTRADICTORY_PRIVATE_TITLE";
  report.changes[0].state = "metadata_revised";
  const html = renderToStaticMarkup(View({ input: report }));
  assert.match(html, /Discovery report unavailable/);
  assert.doesNotMatch(html, /CONTRADICTORY_PRIVATE_TITLE|Invented revised title|Source bytes:|href=|<form/);
});
