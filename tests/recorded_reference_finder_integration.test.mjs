import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalScope } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture } from "../src/server/proposal-capture.ts";
import { elements } from "./helpers/correction_draft_harness.mjs";

const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url));
test("checked captured comparison offers a local cross-panel reference finder without hiding original panels", () => {
  const html = renderToStaticMarkup(createElement(ProposalComparisonView, { decision: { kind: "ok", report: proposalReport() }, selection: proposalScope() }));
  assert.ok(html.includes("Find a reference in this comparison"), "the captured source comparison needs a cross-panel locator");
  assert.ok(html.includes('id="proposal-base-snapshot"'));
  assert.ok(html.includes('id="proposal-proposed-snapshot"'));
  assert.ok(html.includes("Source versions across this comparison"));
  assert.ok(!html.includes('<form'), "finder is in-memory navigation, never a query submission");
});

test("only a checked matching captured report can pass minimal labels to the finder", () => {
  const received = [];
  const Local = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url), name => name === "./recorded-reference-finder-view.tsx" ? {
    RecordedReferenceFinder(props) { received.push(props); return createElement("span", null, "finder-boundary"); },
  } : undefined).ProposalComparisonView;
  const report = proposalReport();
  const valid = renderToStaticMarkup(createElement(Local, { decision: { kind: "ok", report }, selection: proposalScope() }));
  assert.ok(valid.includes("finder-boundary")); assert.equal(received.length, 1); assert.equal(received[0].entries.length, 4);
  for (const row of received[0].entries) for (const key of ["url", "publisher", "assertion", "contentSha256", "rawArchivePath", "retrievedAt"])
    assert.equal(Object.hasOwn(row, key), false);
  const corrupt = structuredClone(report); corrupt.capture.proposalSha256 = "0".repeat(64);
  for (const decision of [{ kind: "ok", report: corrupt }, ...["invalid_scope", "unconfigured", "unavailable", "not_found", "capture_missing", "changed"].map(kind => ({ kind, report }))]) {
    const html = renderToStaticMarkup(createElement(Local, { decision, selection: proposalScope() }));
    assert.ok(!html.includes("finder-boundary")); assert.equal(received.length, 1);
  }
  renderToStaticMarkup(createElement(Local, { decision: { kind: "ok", report }, selection: { ...proposalScope(), runId: "87000000-0000-4000-8000-000000000099" } }));
  assert.equal(received.length, 1);
});

test("finder React key binds the complete comparison and ignores only a fresh identical observation time", () => {
  const key = report => {
    const tree = ProposalComparisonView({ decision: { kind: "ok", report }, selection: proposalScope() });
    return elements(tree).find(n => n.type?.name === "RecordedReferenceFinder")?.key ?? assert.fail("missing finder");
  };
  const original = proposalReport(), same = structuredClone(original);
  same.observedAt = "2026-09-28T09:00:00.000000Z";
  assert.equal(key(original), key(same));
  const changed = structuredClone(original), payload = JSON.parse(changed.capture.proposalJson);
  payload.snapshot.claims[0].evidence[0].title = "Different captured title";
  Object.assign(changed.capture, encodeProposalCapture(payload));
  assert.notEqual(key(original), key(changed));
  const receipt = structuredClone(original); receipt.sourceReceipts[0].languageCode = "en";
  assert.notEqual(key(original), key(receipt));
});
