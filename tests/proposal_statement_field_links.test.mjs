import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalScope, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";

const View = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)).ProposalComparisonView;
const render = (report, selection, browseQuery) => renderToStaticMarkup(createElement(View, { decision: { kind: "ok", report }, selection, browseQuery }));
function recorded(change = () => {}) {
  const r = proposalReport(), p = JSON.parse(r.capture.proposalJson), b = JSON.parse(r.base.publicationJson);
  b.snapshot = structuredClone(p.snapshot); change(p, b, r); Object.assign(r.capture, encodeProposalCapture(p));
  if (r.base !== null) { const publicationJson = JSON.stringify(b), publicationSha256 = createHash("sha256").update(publicationJson).digest("hex"); r.base = { publicationJson, publicationSha256 }; r.capture.baseContentSha256 = publicationSha256; }
  assert.equal(parseCapturedProposalEnvelope(r).status, "ok"); return r;
}
const fields = ["type", "assertion", "periodLabel", "evidence"];
const id = (side, claim, field) => "proposal-" + side + "-claim-" + claim + "-field-" + field;
const links = html => [...html.matchAll(/href="#(proposal-(?:base|proposed)-claim-[^"]+-field-(?:type|assertion|periodLabel|evidence))"/g)].map(m => m[1]);
function targets(html) {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]); assert.equal(ids.length, new Set(ids).size);
  for (const [, fragment] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(value => value === fragment).length, 1, fragment);
  return ids;
}

test("each changed recorded statement field links its exact two values and preserves the unverified comparison", () => {
  for (const field of fields) {
    const r = recorded(p => { const claim = p.snapshot.claims[0]; if (field === "type") claim.type = "delivery";
      else if (field === "assertion") claim.assertion = "Different literal wording"; else if (field === "periodLabel") claim.periodLabel = "Different recorded data period";
      else claim.evidence[1].locator = "Different recorded locator"; });
    const claim = JSON.parse(r.capture.proposalJson).snapshot.claims[0], html = render(r);
    assert.deepEqual(links(html), [id("base", claim.id, field), id("proposed", claim.id, field)]); targets(html);
    for (const text of ["Unverified proposal", "do not measure importance, correctness or publication eligibility", "Current public eligibility and source health were not checked", "Meaning of "]) assert.ok(html.includes(text), text);
  }
});

test("combined statement changes keep field order and exact reference differences while retaining prior page and statement targets", () => {
  const r = recorded(p => { p.snapshot.title = "Changed page title"; const claim = p.snapshot.claims[0]; claim.type = "delivery"; claim.assertion = "Changed wording"; claim.periodLabel = "Changed period"; claim.evidence[1].locator = "Changed location"; });
  const claim = JSON.parse(r.capture.proposalJson).snapshot.claims[0], html = render(r);
  assert.deepEqual(links(html), fields.flatMap(field => [id("base", claim.id, field), id("proposed", claim.id, field)]));
  assert.ok(html.includes("Changed statement: Statement type, Wording, Data period, Source references.")); assert.ok(html.includes("Reference records that differ"));
  assert.ok(html.includes('href="#proposal-base-page-title"')); assert.ok(html.includes('href="#proposal-proposed-page-title"'));
  const ids = targets(html); for (const side of ["base", "proposed"]) assert.ok(ids.includes("proposal-" + side + "-claim-" + claim.id));
  assert.ok(html.includes("Conflicting evidence")); assert.ok(html.includes("A metadata change appears on each side"));
});

test("added removed absent-base and unchanged statements invent no paired field differences", () => {
  for (const r of [recorded(), recorded(p => { p.snapshot.claims[0].id = proposalId(20); }), recorded((p, b, report) => { report.base = null; report.capture.basePublicationId = null; report.capture.baseContentSha256 = null; report.capture.baseHeadChangedAt = null; })]) {
    const html = render(r); assert.deepEqual(links(html), []); assert.ok(!html.includes('aria-label="Changed statement fields"')); targets(html);
  }
  const absent = render(recorded((p, b, r) => { r.base = null; r.capture.basePublicationId = null; r.capture.baseContentSha256 = null; r.capture.baseHeadChangedAt = null; }));
  assert.ok(absent.includes("This is a checked absence, not a failed read.")); assert.ok(absent.includes("All proposed statements are additions"));
  for (const field of fields) { assert.ok(absent.includes(id("proposed", proposalId(3), field))); assert.ok(!absent.includes(id("base", proposalId(3), field))); }
});

test("reference order alone links both complete reference lists without fabricating added or removed values", () => {
  const html = render(recorded(p => { p.snapshot.claims[0].evidence.reverse(); }));
  assert.deepEqual(links(html), [id("base", proposalId(3), "evidence"), id("proposed", proposalId(3), "evidence")]);
  assert.ok(html.includes("The same recorded reference values appear in a different order. No reference value was added or removed."));
  assert.ok(html.includes("2 identical reference occurrences; 0 only in the recorded panel; 0 only in the proposed panel."));
  assert.ok(!html.includes('aria-label="Reference values present on one side"')); targets(html);
});

test("corrupt foreign changed or otherwise withheld captures expose no new field target or old literal claim", () => {
  const r = recorded(p => { p.snapshot.claims[0].assertion = "PRIVATE_STATEMENT_FIELD_CANARY"; }), bad = structuredClone(r); bad.capture.proposalSha256 = "0".repeat(64);
  const outputs = [render(bad), render(r, { runId: proposalId(99), decisionId: proposalId(2) }), ...["invalid_scope", "unconfigured", "unavailable", "not_found", "capture_missing", "changed"].map(kind => renderToStaticMarkup(createElement(View, { decision: { kind, report: r }, selection: proposalScope() })))];
  for (const html of outputs) { assert.deepEqual(links(html), []); assert.ok(!html.includes("PRIVATE_STATEMENT_FIELD_CANARY")); assert.ok(!html.includes('aria-label="Changed statement fields"'));
    for (const side of ["base", "proposed"]) for (const field of fields) assert.ok(!html.includes(id(side, proposalId(3), field))); }
});

test("literal field values stay escaped and exact date coverage source conflicts and checked held navigation remain distinct", () => {
  const html = render(recorded(p => { p.snapshot.claims[0].assertion = 'Literal <a href="/private">wording</a>'; p.snapshot.claims[0].periodLabel = "Period <script>canary</script>"; }), proposalScope(), { ...proposalScope(), beforeDecidedAt: "2026-09-28T07:00:00.000001Z", beforeDecisionId: proposalId(90), reason: "material_conflict" });
  assert.ok(html.includes("&lt;a href=&quot;/private&quot;&gt;")); assert.ok(html.includes("&lt;script&gt;canary"));
  assert.ok(html.includes("Captured (UTC)")); assert.ok(html.includes("Records observed (UTC)")); assert.ok(html.includes("Recorded last evidence review")); assert.ok(html.includes("source published:"));
  for (const text of ["Unreviewed.", "Conflicting evidence", "Return to the selected held page (new read)", "navigation only", "reason=material_conflict"]) assert.ok(html.includes(text));
  assertUnsentProposalControls(html);for (const unsafe of ["<script>", '<a href="/private">', 'href="https:', "rawArchivePath"]) assert.ok(!html.includes(unsafe)); targets(html);
});

test("distinct claim IDs with repeated wording and evidence retain unique side and field targets in recorded order", () => {
  const r = recorded((p, b) => { const claim = structuredClone(p.snapshot.claims[0]); b.snapshot.claims = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(claim), id: proposalId(100 + index), periodLabel: "Recorded period " + index }));
    p.snapshot.claims = b.snapshot.claims.map((row, index) => ({ ...structuredClone(row), periodLabel: "Proposed period " + index })); });
  const html = render(r), claims = JSON.parse(r.capture.proposalJson).snapshot.claims;
  assert.deepEqual(links(html), claims.flatMap(claim => [id("base", claim.id, "periodLabel"), id("proposed", claim.id, "periodLabel")]));
  assert.ok(html.includes("Statements: 0 added; 0 removed; 12 changed; 0 unchanged.")); targets(html);
});
