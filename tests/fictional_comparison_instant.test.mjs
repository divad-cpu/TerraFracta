import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { compareFictionalObservations, exportFictionalComparison } from "../src/fictional-observation-comparison.ts";
import { compareFictionalSavedRuns } from "../src/fictional-saved-run-comparison.ts";
import { fictionalPublicationDraftSchema } from "../src/fictional-publication-draft.ts";
import { fictionalUpdateResultSchema } from "../src/fictional-update-result.ts";
import { handleFictionalHistoryPageRequest } from "../src/server/fictional-receipt-page.ts";
import { fictionalReceiptPageSchema } from "../src/fictional-receipt-page.ts";

const standard = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const revised = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url)));
function drafts(first, second, unchanged = false) {
  const before = structuredClone(standard.fictionalCandidate), after = structuredClone(unchanged ? standard.fictionalCandidate : revised.fictionalCandidate);
  before.publication.snapshot.claims[0].evidence[0].retrievedAt = first;
  after.publication.snapshot.claims[0].evidence[0].retrievedAt = second;
  assert.equal(fictionalPublicationDraftSchema.safeParse(before).success, true);
  assert.equal(fictionalPublicationDraftSchema.safeParse(after).success, true);
  return [before, after];
}
function receipts(first, second) {
  const pair = [standard, revised].map((report, index) => ({
    execution: { id: index ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "local_fictional", scenario: index ? "revised_value" : "standard", executedAt: index ? second : first, durationMs: 1 },
    report: structuredClone(report),
  }));
  for (const row of pair) assert.equal(fictionalUpdateResultSchema.safeParse(row).success, true);
  return pair;
}

for (const [label, first, second] of [
  ["microsecond", "2026-09-28T06:00:00.000001Z", "2026-09-28T06:00:00.000002Z"],
  ["nanosecond", "2026-09-28T06:00:00.000000001Z", "2026-09-28T06:00:00.000000002Z"],
  ["long decimal", "2026-09-28T06:00:00.123456789012345678901Z", "2026-09-28T06:00:00.123456789012345678902Z"],
  ["offset", "2026-09-28T08:00:00.000001+02:00", "2026-09-28T07:00:00.000002+01:00"],
]) {
  test(`an admitted ${label} source revision retains its exact chronological difference`, () => {
    const [before, after] = drafts(first, second);
    const compared = compareFictionalObservations(before, after);
    assert.equal(compared.kind, "changed"); assert.equal(compared.deltaPercentagePoints, "+0.7");
    const artifact = JSON.parse(exportFictionalComparison(before, after));
    assert.equal(artifact.before.retrievedAt, first); assert.equal(artifact.after.retrievedAt, second);
    assert.equal(artifact.state, "draft"); assert.equal(artifact.publicChanges, 0);
  });
}

test("reversed submillisecond source retrieval withholds unchanged and changed observations", () => {
  for (const unchanged of [false, true]) {
    const [before, after] = drafts("2026-09-28T06:00:00.000002Z", "2026-09-28T06:00:00.000001Z", unchanged);
    assert.deepEqual(compareFictionalObservations(before, after), { kind: "held" });
    assert.throws(() => exportFictionalComparison(before, after), /cannot be exported/);
  }
});

test("equivalent offset/fraction spellings remain one instant, without an invented source revision", () => {
  for (const [first, second] of [
    ["2026-09-28T06:00:00.123Z", "2026-09-28T07:00:00.123000+01:00"],
    ["2026-09-28T06:00:00Z", "2026-09-28T06:00:00.000000Z"],
  ]) {
    assert.deepEqual(compareFictionalObservations(...drafts(first, second)), { kind: "held" });
    assert.equal(compareFictionalObservations(...drafts(first, second, true)).kind, "unchanged");
  }
});

test("distinct saved executions within one millisecond are comparable in their exact order", () => {
  for (const [first, second] of [
    ["2026-10-02T15:00:00.000001Z", "2026-10-02T15:00:00.000002Z"],
    ["2026-10-02T15:00:00.000000001Z", "2026-10-02T15:00:00.000000002Z"],
  ]) {
    const [before, after] = receipts(first, second);
    const result = compareFictionalSavedRuns(before, after);
    assert.equal(result.kind, "comparable"); assert.equal(result.earlier.execution.executedAt, first);
    assert.equal(result.later.execution.executedAt, second);
    const reversed = receipts(second, first);
    assert.deepEqual(compareFictionalSavedRuns(...reversed), { kind: "held", reason: "execution_order" });
  }
});

test("equal saved execution instants cannot become ordered through UUID or decimal spelling", () => {
  for (const [first, second] of [
    ["2026-10-02T15:00:00.123Z", "2026-10-02T15:00:00.123000Z"],
    ["2026-10-02T15:00:00Z", "2026-10-02T15:00:00Z"],
  ]) assert.deepEqual(compareFictionalSavedRuns(...receipts(first, second)), { kind: "held", reason: "execution_order" });
});

test("the actual paged read and saved comparison present exact short chronology or withhold reversed source evidence", async () => {
  const compile = (relative, imports = {}) => {
    const source = new URL(relative, import.meta.url), nativeRequire = createRequire(source), exports = {};
    const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", compiled)(name => imports[name] ?? nativeRequire(name), exports);
    return exports;
  };
  const comparison = compile("../app/update-preview/comparison.tsx", {
    "../../src/fictional-observation-comparison": { compareFictionalObservations, exportFictionalComparison },
  });
  const { SavedRunComparison } = compile("../app/editorial-preview/saved-run-comparison.tsx", { "../update-preview/comparison": comparison });
  const rows = receipts("2026-10-02T15:00:00.000001Z", "2026-10-02T15:00:00.000002Z");
  const [before, after] = drafts("2026-09-28T08:00:00.000001+02:00", "2026-09-28T07:00:00.000002+01:00");
  rows[0].report.fictionalCandidate = before; rows[1].report.fictionalCandidate = after;
  const input = { entries: rows, totalReceipts: 2, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true };
  const original = structuredClone(input);
  const response = await handleFictionalHistoryPageRequest(new Request("http://127.0.0.1:3000/api/dev/update-rehearsal/history/page", {
    headers: { "sec-fetch-site": "same-origin" },
  }), "development", async () => structuredClone(input));
  assert.equal(response.status, 200);
  const page = fictionalReceiptPageSchema.parse(await response.json());
  assert.deepEqual(page.entries.map(row => row.execution.id), [rows[1].execution.id, rows[0].execution.id]);
  const earlier = page.entries[1], later = page.entries[0];
  const html = renderToStaticMarkup(createElement(SavedRunComparison, { earlier, later }));
  for (const value of [earlier.execution.executedAt, later.execution.executedAt,
    before.publication.snapshot.claims[0].evidence[0].retrievedAt, after.publication.snapshot.claims[0].evidence[0].retrievedAt,
    "27.4%", "28.1%", "+0.7 percentage points", "Download fictional comparison"]) assert.ok(html.includes(value), value);
  assert.ok(!html.includes("Saved-run comparison held"));
  const artifact = JSON.parse(exportFictionalComparison(earlier.report.fictionalCandidate, later.report.fictionalCandidate));
  assert.equal(artifact.deltaPercentagePoints, "+0.7"); assert.equal(artifact.publicChanges, 0);
  const reversed = structuredClone(later);
  reversed.report.fictionalCandidate.publication.snapshot.claims[0].evidence[0].retrievedAt = "2026-09-28T06:00:00Z";
  const held = renderToStaticMarkup(createElement(SavedRunComparison, { earlier, later: reversed }));
  assert.ok(held.includes("Saved-run comparison held")); assert.ok(!held.includes("percentage points"));
  assert.ok(!held.includes("Download fictional comparison")); assert.deepEqual(input, original);
});
