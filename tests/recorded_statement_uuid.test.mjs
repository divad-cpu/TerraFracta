import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { compareRecordedProposalSnapshots as compare } from "../src/recorded-proposal-changes.ts";
const { ProposalComparisonView: View } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url));
const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef";
function fixture(change = () => {}) {
  const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson), base = JSON.parse(report.base.publicationJson);
  payload.snapshot.claims[0].id = lower; base.snapshot = structuredClone(payload.snapshot); base.snapshot.claims[0].id = lower.toUpperCase();
  change(payload.snapshot, base.snapshot); Object.assign(report.capture, encodeProposalCapture(payload));
  report.decision.evidenceLocator = payload.snapshot.claims.find(claim => claim.evidence.some(e => e.sourceVersionId === report.decision.sourceVersionId))
    .evidence.find(e => e.sourceVersionId === report.decision.sourceVersionId).locator;
  const publicationJson = JSON.stringify(base), publicationSha256 = createHash("sha256").update(publicationJson).digest("hex");
  report.base = { publicationJson, publicationSha256 }; report.capture.baseContentSha256 = publicationSha256;
  assert.equal(parseCapturedProposalEnvelope(report).status, "ok"); return { report, proposed: payload.snapshot, base: base.snapshot };
}
function render(report) { return renderToStaticMarkup(createElement(View, { decision: { kind: "ok", report } })); }
function targets(html) {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(target => target === id).length, 1, id);
}
test("one statement UUID with different panel spelling is unchanged and retains both original objects", () => {
  const { base, proposed } = fixture(), before = structuredClone([base, proposed]), result = compare(base, proposed);
  assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 0, unchanged: 1 });
  assert.deepEqual(result.statements, []); assert.equal(result.statementOrderChanged, false); assert.deepEqual([base, proposed], before);
});
test("case spelling cannot turn actual field changes into a fabricated addition and removal", () => {
  const { base, proposed } = fixture(p => { p.claims[0].type = "funding"; p.claims[0].assertion = "Literal changed statement";
    p.claims[0].periodLabel = "2025"; p.claims[0].evidence[0].locator = "Changed literal locator"; });
  const result = compare(base, proposed); assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 1, unchanged: 0 });
  assert.deepEqual(result.statements[0].fields, ["type", "assertion", "periodLabel", "evidence"]);
  assert.equal(result.statements[0].before, base.claims[0]); assert.equal(result.statements[0].after, proposed.claims[0]);
  assert.equal(result.statements[0].id, lower);
});
test("reordered equivalent UUIDs remain an order change while each panel spelling and position is retained", () => {
  const { base, proposed } = fixture((p, b) => {
    const id = "abcdefab-cdef-4abc-8def-abcdefabcdee", claim = structuredClone(p.claims[0]); claim.id = id;
    p.claims.push(claim); b.claims.push({ ...structuredClone(claim), id: id.toUpperCase() }); p.claims.reverse();
  });
  const result = compare(base, proposed); assert.equal(result.statementOrderChanged, true);
  assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 0, unchanged: 2 }); assert.deepEqual(result.statements, []);
});
test("actual comparison links changed fields and exact differing references to their original panel UUID spelling", () => {
  const { report } = fixture(p => { p.claims[0].assertion = "Changed <literal> wording"; p.claims[0].evidence[0].locator = "Changed reference"; });
  const before = structuredClone(report), html = render(report); assert.ok(html.includes("Statements: 0 added; 0 removed; 1 changed; 0 unchanged."));
  for (const field of ["assertion", "evidence"]) for (const [side, id] of [["base", lower.toUpperCase()], ["proposed", lower]])
    assert.ok(html.includes(`href="#proposal-${side}-claim-${id}-field-${field}"`));
  assert.ok(html.includes(`href="#proposal-base-reference-${lower.toUpperCase()}-1"`));
  assert.ok(html.includes(`href="#proposal-proposed-reference-${lower}-1"`));
  assert.ok(html.includes("Changed &lt;literal&gt; wording")); assert.ok(html.includes("Unverified proposal"));
  targets(html); assert.deepEqual(report, before);
});
test("equal wording under a different UUID remains an addition and removal", () => {
  const { base, proposed } = fixture(p => { p.claims[0].id = proposalId(99); });
  assert.deepEqual(compare(base, proposed).counts, { added: 1, removed: 1, changed: 0, unchanged: 0 });
});
test("corrupt or foreign captures never expose earlier case-spelled statement targets", () => {
  const { report } = fixture(); report.base.publicationSha256 = "0".repeat(64);
  assert.doesNotMatch(render(report), /abcdefab|proposal-base-claim-/i);
  const valid = fixture().report, html = renderToStaticMarkup(createElement(View, { decision: { kind: "ok", report: valid },
    selection: { runId: proposalId(99), decisionId: proposalId(2) } })); assert.doesNotMatch(html, /abcdefab|proposal-base-claim-/i);
});
