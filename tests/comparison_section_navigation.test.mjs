import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalScope, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { createHash } from "node:crypto";

const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url));
const render = (report, selection = proposalScope(), kind = "ok") => renderToStaticMarkup(createElement(ProposalComparisonView, { decision: { kind, report }, selection }));
const sections = html => /<nav[^>]*aria-label="Sections of this captured comparison"[\s\S]*?<\/nav>/.exec(html)?.[0];
const expectedSections = ["proposal-hold-reasons", "proposal-coverage", "proposal-reference-finder", "proposal-source-versions",
  "proposal-statement-types", "proposal-scope-preparation", "proposal-responsibility-preparation", "proposal-policy-event-preparation", "proposal-funding-preparation", "proposal-indicator-preparation", "proposal-delivery-preparation", "proposal-preparation-packet",
  "proposal-changes-heading", "proposal-base-snapshot", "proposal-proposed-snapshot"];

test("a checked captured comparison offers native links to its long inspection sections", () => {
  const html = render(proposalReport()), nav = sections(html);
  assert.ok(nav, "The comparison needs a section outline distinct from the workspace routes");
  const targets = [...nav.matchAll(/href="#([^"\s]+)"/g)].map(match => match[1]);
  assert.deepEqual(targets, expectedSections);
  assert.equal(new Set(targets).size, targets.length);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  for (const target of targets) assert.equal(ids.filter(id => id === target).length, 1, target);
  for (const target of targets) assert.match(html, new RegExp(`id="${target}"[^>]*tabindex="-1"`), target);
  assert.doesNotMatch(nav, /<form|<button|https:|\?/);
});

test("a witnessed absent base remains a reachable absence panel without implying a current publication", () => {
  const report = proposalReport(); report.base = null;
  Object.assign(report.capture, { basePublicationId: null, baseContentSha256: null, baseHeadChangedAt: null });
  assert.equal(parseCapturedProposalEnvelope(report).status, "ok");
  const html = render(report);
  assert.ok(sections(html)?.includes('href="#proposal-base-snapshot"'));
  assert.match(html, /witnessed issue head had no publication/);
  assert.match(html, /id="proposal-base-snapshot" tabindex="-1"/);
  assert.doesNotMatch(html, /The invented share was 7.5%/);
});

test("withheld corrupt and foreign captures expose no content section outline or stale anchors", () => {
  const report = proposalReport(), corrupt = structuredClone(report); corrupt.capture.proposalSha256 = "0".repeat(64);
  for (const html of [render(corrupt), render(report, { runId: proposalId(99), decisionId: proposalId(2) }),
    ...["invalid_scope", "unconfigured", "unavailable", "not_found", "capture_missing", "changed"].map(kind => render(report, proposalScope(), kind))]) {
    assert.equal(sections(html), undefined);
    assert.doesNotMatch(html, /id="proposal-(?:coverage|reference-finder|scope-preparation|responsibility-preparation|policy-event-preparation|funding-preparation|indicator-preparation|delivery-preparation|preparation-packet|base-snapshot|proposed-snapshot)"|The invented share/);
  }
});

test("outline destinations and return stay unique with all thirty statements in each byte-bounded panel", () => {
  const report = proposalReport(), proposed = JSON.parse(report.capture.proposalJson), base = JSON.parse(report.base.publicationJson);
  for (const snapshot of [proposed.snapshot, base.snapshot]) {
    const claim = snapshot.claims[0];
    snapshot.claims = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(claim), id: proposalId(100 + index),
      evidence: structuredClone(index === 0 ? claim.evidence : [claim.evidence[0]]) }));
  }
  const publicationJson = JSON.stringify(base), publicationSha256 = createHash("sha256").update(publicationJson).digest("hex");
  report.base = { publicationJson, publicationSha256 }; report.capture.baseContentSha256 = publicationSha256;
  Object.assign(report.capture, encodeProposalCapture(proposed));
  assert.equal(parseCapturedProposalEnvelope(report).status, "ok");
  const html = render(report), nav = sections(html);
  assert.ok(nav); assert.deepEqual([...nav.matchAll(/href="#([^"\s]+)"/g)].map(match => match[1]), expectedSections);
  assert.equal([...html.matchAll(/id="proposal-(?:base|proposed)-reference-/g)].length, 62);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /href="#proposal-comparison-sections">Back to comparison sections/);
  assert.match(nav, /id="proposal-comparison-sections" tabindex="-1"/);
});
