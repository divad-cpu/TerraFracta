import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalScope, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
import { statementLabels } from "../src/issue-display-labels.ts";

const View = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)).ProposalComparisonView;
const sha = body => createHash("sha256").update(body).digest("hex");
function record({ absent = false } = {}) {
  const report = proposalReport(), proposal = JSON.parse(report.capture.proposalJson);
  const original = proposal.snapshot.claims[0];
  proposal.snapshot.claims = ["evaluation", "condition", "funding"].map((type, index) => ({
    ...structuredClone(original), id: proposalId(30 + index), type,
    assertion: `INVENTED_PRIVATE_TARGET_${index + 1}`, periodLabel: `Invented period ${index + 1}`,
  }));
  const base = JSON.parse(report.base.publicationJson);
  base.snapshot = structuredClone(proposal.snapshot); base.snapshot.claims.reverse();
  base.snapshot.claims[0].evidence.reverse();
  Object.assign(report.capture, encodeProposalCapture(proposal));
  if (absent) {
    report.base = null; report.capture.basePublicationId = null;
    report.capture.baseHeadChangedAt = null; report.capture.baseContentSha256 = null;
  } else {
    const publicationJson = JSON.stringify(base), publicationSha256 = sha(publicationJson);
    report.base = { publicationJson, publicationSha256 }; report.capture.baseContentSha256 = publicationSha256;
  }
  const checked = parseCapturedProposalEnvelope(report); assert.equal(checked.status, "ok");
  return { report, proposal, base };
}
const render = report => renderToStaticMarkup(View({ decision: { kind: "ok", report }, selection: proposalScope() }));
function target(html, side, claim, index) {
  const id = `proposal-${side}-claim-${claim.id}-field-type`;
  const heading = new RegExp(`<h4 id="${id}">([^<]+)</h4>`).exec(html)?.[1];
  assert.equal(heading, `${side === "base" ? "Recorded" : "Proposed"} statement ${index + 1} · ${statementLabels[claim.type]}`);
  for (const [position, source] of claim.evidence.entries()) {
    const reference = new RegExp(`<li id="proposal-${side}-reference-${claim.id}-${position + 1}"><strong>([^<]+)</strong>`).exec(html)?.[1];
    const role = source.relation === "supports" ? "Supporting evidence" : source.relation === "contradicts" ? "Conflicting evidence" : "Context";
    assert.equal(reference, `Reference ${position + 1} · ${role}`);
  }
}
test("captured panel targets display their own original statement and reference positions after independent reordering", () => {
  const { report, proposal, base } = record(), before = structuredClone(report), html = render(report);
  for (const [side, snapshot] of [["base", base.snapshot], ["proposed", proposal.snapshot]]) {
    snapshot.claims.forEach((claim, index) => target(html, side, claim, index));
  }
  assert.match(html, /Statement numbers follow the record order of each panel/);
  assert.match(html, /do not establish chronology or importance/);
  assert.deepEqual(report, before);
});
test("numbered source-index returns retain a single exact target and do not add outward or publication controls", () => {
  const { report } = record(), html = render(report);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of html.matchAll(/href="#(proposal-(?:base|proposed)-(?:claim|reference)-[^"]+)"/g)) {
    assert.equal(ids.filter(value => value === id).length, 1, id);
  }
  assert.doesNotMatch(html, /<form|href="https:|Approve proposal|Publish proposal/);
  assert.match(html, /Nothing is submitted, saved to the archive or published/);
  assert.match(html, /Current public eligibility and source health were not checked/);
});
test("absent and withheld captured panels cannot inherit numbered content from an earlier comparison", () => {
  const absent = record({ absent: true }), html = render(absent.report);
  assert.doesNotMatch(html, /Recorded statement [123] ·|id="proposal-base-claim-/);
  absent.proposal.snapshot.claims.forEach((claim, index) => target(html, "proposed", claim, index));
  const good = record().report, bad = structuredClone(good); bad.capture.proposalSha256 = "0".repeat(64);
  for (const output of [render(bad), ...["unavailable", "changed", "capture_missing"].map(kind => renderToStaticMarkup(View({ decision: { kind, report: good }, selection: proposalScope() })))]) {
    assert.doesNotMatch(output, /INVENTED_PRIVATE_TARGET_|(?:Recorded|Proposed) statement [123] ·|id="proposal-(?:base|proposed)-reference-/);
  }
});
test("actual finite-byte proposal page exposes escaped numbered targets only for the currently checked capture", async () => {
  const { report } = record(); const calls = [];
  const reader = createProposalReader(async (scope, signal) => {
    calls.push({ scope, signal });
    return new TextEncoder().encode(JSON.stringify(calls.length === 1 ? report : { schemaVersion: 1, status: "changed", requested: scope }));
  }, () => 0, () => assert.fail("Unexpected diagnostic"));
  const Page = loadTsx(new URL("../app/editorial-preview/held/proposal/page.tsx", import.meta.url), name => name === "next/navigation" ? { unstable_rethrow() {}, notFound() { assert.fail("Refused route"); } } : name.endsWith("operator-proposal-reader.ts") ? { readCapturedProposal: reader } : undefined).default;
  const first = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(proposalScope()) }));
  assert.match(first, /Proposed statement 1 · Evaluation/); assert.match(first, /Reference 2 · Conflicting evidence/);
  const changed = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(proposalScope()) }));
  assert.match(changed, /Comparison changed/); assert.doesNotMatch(changed, /INVENTED_PRIVATE_TARGET_|statement [123] ·|Reference 2 ·/);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.signal.aborted));
});
