import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { recordedProposalSourceIndex } from "../src/recorded-proposal-source-index.ts";
const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url));
const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef";
function fixture(distinct = false) {
  const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson), base = JSON.parse(report.base.publicationJson);
  const first = proposalId(4), baseId = distinct ? "abcdefab-cdef-4abc-8def-abcdefabcdee" : lower.toUpperCase();
  for (const [snapshot, manifest, id] of [[payload.snapshot, payload.dependencyManifest, lower], [base.snapshot, base.dependencyManifest, baseId]]) {
    for (const claim of snapshot.claims) for (const evidence of claim.evidence) if (evidence.sourceVersionId === first) evidence.sourceVersionId = id;
    manifest.sourceVersionIds = manifest.sourceVersionIds.map(value => value === first ? id : value);
  }
  base.snapshot.claims[0].evidence[0].title = "Base <literal> title";
  report.decision.sourceVersionId = lower; report.sourceReceipts[0].sourceVersionId = lower;
  Object.assign(report.capture, encodeProposalCapture(payload));
  const publicationJson = JSON.stringify(base), publicationSha256 = createHash("sha256").update(publicationJson).digest("hex");
  report.base = { publicationJson, publicationSha256 }; report.capture.baseContentSha256 = publicationSha256;
  assert.equal(parseCapturedProposalEnvelope(report).status, "ok");
  return { report, payload, base };
}
function render(report) { return renderToStaticMarkup(createElement(ProposalComparisonView, { decision: { kind: "ok", report } })); }
function verifyTargets(html) {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(id => id === target).length, 1, target);
}
test("captured panels group a single source UUID across case spellings while preserving exact side references and counts", () => {
  const { base, payload } = fixture(), before = structuredClone([base.snapshot, payload.snapshot]);
  const index = recordedProposalSourceIndex(base.snapshot, payload.snapshot);
  assert.equal(index.groups.length, 2); assert.equal(index.referenceCount, 4);
  assert.equal(index.groups[0].sourceVersionId, lower.toUpperCase());
  assert.deepEqual(index.groups[0].occurrences.map(item => [item.side, item.statementIndex, item.referenceIndex, item.source.sourceVersionId]),
    [["base", 0, 0, lower.toUpperCase()], ["proposed", 0, 0, lower]]);
  assert.deepEqual(index.groups[0].base, { references: 1, statements: 1 });
  assert.deepEqual(index.groups[0].proposed, { references: 1, statements: 1 });
  assert.deepEqual([base.snapshot, payload.snapshot], before);
});
test("actual captured comparison links both spellings and proposal receipt to one existing group without losing recorded metadata", () => {
  const { report } = fixture(), before = structuredClone(report), html = render(report);
  assert.ok(html.includes("4 reference occurrences across 2 recorded source versions"));
  assert.ok(html.includes("Base &lt;literal&gt; title")); assert.ok(html.includes(lower.toUpperCase())); assert.ok(html.includes(lower));
  const index = /<details class="proposal-source-index">([\s\S]*?)<\/details>/.exec(html)[1];
  assert.equal((index.match(/href="#proposal-source-receipt-1"/g) ?? []).length, 1);
  const languageLocations = /<ol aria-label="Matching source receipt locations">([\s\S]*?)<\/ol>/.exec(html)?.[1];
  assert.ok(languageLocations, "The captured-language locator retains its recorded receipt list");
  assert.equal((languageLocations.match(/href="#proposal-source-version-1"/g) ?? []).length, 1);
  assert.equal((html.replace(languageLocations, "").match(/href="#proposal-source-version-1"/g) ?? []).length, 3);
  assert.equal((html.match(/href="#proposal-source-version-1"/g) ?? []).length, 4);
  assert.ok(html.includes("Its language and retrieval record belong to this captured proposal"));
  assert.ok(html.includes("not independent confirmation")); assert.ok(html.includes("Current public eligibility and source health were not checked"));
  assert.deepEqual(report, before); verifyTargets(html);
});
test("different UUIDs at the same source address stay distinct and a base-only version has no proposal receipt", () => {
  const { report, base, payload } = fixture(true), index = recordedProposalSourceIndex(base.snapshot, payload.snapshot), html = render(report);
  assert.equal(index.groups.length, 3); assert.ok(html.includes("4 reference occurrences across 3 recorded source versions"));
  assert.ok(html.includes("No proposal source receipt for this version. Its language and current source state were not checked.")); verifyTargets(html);
});
test("corrupt captured bytes and foreign selections withhold aliases and every recorded receipt target", () => {
  const { report } = fixture(); report.capture.proposalSha256 = "0".repeat(64);
  const html = render(report); assert.doesNotMatch(html, /abcdefab|Base &lt;literal&gt;|id="proposal-source-/i);
  const valid = fixture().report, foreign = renderToStaticMarkup(createElement(ProposalComparisonView, { decision: { kind: "ok", report: valid },
    selection: { runId: proposalId(99), decisionId: proposalId(2) } }));
  assert.doesNotMatch(foreign, /abcdefab|Base &lt;literal&gt;|id="proposal-source-/i);
});
