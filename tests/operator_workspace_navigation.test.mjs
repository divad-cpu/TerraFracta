import assert from "node:assert/strict";
import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { operatorWorkspaceLinks } from "../src/operator-workspace-navigation.ts";
import { createHeldDecisionsReader } from "../src/server/operator-held-decisions-reader.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
import { heldReport, heldScope, bytes } from "./helpers/operator_held_fixture.mjs";
import { proposalReport, proposalScope, proposalBytes } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const Nav = loadTsx(new URL("../src/operator-workspace-navigation-view.tsx", import.meta.url)).OperatorWorkspaceNavigation;
const Held = loadTsx(new URL("../src/operator-held-decisions-view.tsx", import.meta.url)).HeldDecisionsView;
const Proposal = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)).ProposalComparisonView;
const render = (View, props) => renderToStaticMarkup(createElement(View, props));
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("closed workspace navigation exposes only witnessed scope and never invents an issue for a hold", () => {
  const held = operatorWorkspaceLinks({ runId: id(1), decisionId: id(2) });
  assert.ok(held.links.find(link => link.key === "comparison").href.includes(`decisionId=${id(2)}`));
  assert.ok(held.links.filter(link => link.key === "audit").every(link => link.href === null));
  const complete = operatorWorkspaceLinks({ runId: id(1), decisionId: id(2), issueId: id(3) });
  for (const link of complete.links.filter(link => link.key === "audit")) {
    const url = new URL(link.href, "https://example.org");
    assert.equal(url.searchParams.get("runId"), id(1)); assert.equal(url.searchParams.get("issueId"), id(3));
    assert.deepEqual([...url.searchParams.keys()], ["runId", "issueId"]);
  }
  for (const input of [null, [], { issueId: id(3) }, { runId: id(1), path: "/tmp/private" }, { runId: "private-canary" }, { runId: [id(1)] }])
    assert.deepEqual(operatorWorkspaceLinks(input).context, {});
});
test("workspace navigation marks one location, disabled choices remain explanatory text and no mutation control appears", () => {
  for (const active of ["overview", "runs", "holds", "comparison", "audit"]) {
    const html = render(Nav, { active, context: { runId: id(1), decisionId: id(2), issueId: id(3) } });
    assert.equal((html.match(/aria-current="location"/g) ?? []).length, 1);
    assert.ok(html.includes("own dated read") && html.includes("common atomic snapshot"));
    assert.ok(!html.includes("<button") && !html.includes('method="post"'));
  }
  const empty = render(Nav, { active: "overview" });
  assert.ok(empty.includes("choose a run and issue"));
  assert.ok(!empty.includes('href="/editorial-preview/held?'));
});
test("actual checked held and proposal presenters keep exact decision navigation, separate reads and target-derived audit links", async () => {
  const p = proposalReport(), scope = proposalScope();
  const holds = heldReport({ runId: scope.runId, cursor: null });
  holds.run.runId = scope.runId;
  holds.decisions = [holds.decisions[0]];
  holds.decisions[0].decisionId = scope.decisionId;
  // The held list knows this exact decision only. The separately checked
  // proposal supplies its target; its payload and hash remain untouched.
  const held = await createHeldDecisionsReader(async () => bytes(holds), () => 0, async () => "saved")({ runId: scope.runId, cursor: null });
  assert.equal(held.kind, "ok");
  const list = render(Held, { decision: held, selection: held.report.requested });
  assert.ok(list.includes("Proposal details are read separately"));
  assert.ok(!list.includes("Proposal comparison unavailable"));
  assert.ok(list.includes(`runId=${scope.runId}&amp;decisionId=${scope.decisionId}`));
  assert.ok(!list.includes(`#audit-sources-heading`));
  const comparison = await createProposalReader(async () => proposalBytes(p), () => 0, async () => "saved")(scope);
  assert.equal(comparison.kind, "ok");
  const html = render(Proposal, { decision: comparison, selection: scope });
  assert.ok(html.includes(`runId=${scope.runId}&amp;issueId=${p.target.issueId}#audit-sources-heading`));
  assert.ok(html.includes(`issueId=${p.target.issueId}#audit-history-heading`));
  for (const text of ["Unverified proposal", "Recorded current publication", "Proposed content", "Translation", "Conflicting evidence"])
    assert.ok(html.includes(text), text);
  assertUnsentProposalControls(html); assert.ok(!html.includes('href="https:'));
});
test("withheld comparison navigation never borrows an unchecked target or cross-run report", () => {
  const report = proposalReport(), selection = { ...proposalScope(), runId: id(55) };
  const html = render(Proposal, { decision: { kind: "ok", report }, selection });
  assert.ok(!html.includes(report.target.issueId)); assert.ok(!html.includes(report.capture.captureId));
  assert.ok(html.includes(`runId=${selection.runId}`));
  assert.ok(!html.includes("#audit-sources-heading"));
  for (const kind of ["unconfigured", "capture_missing", "changed", "not_found", "unavailable"])
    assert.ok(!render(Proposal, { decision: { kind }, selection }).includes("#audit-sources-heading"));
});
test("workspace overview refuses production before query access and rejects selectors without any private read", async () => {
  const marker = new Error("not-found"), file = new URL("../app/editorial-preview/exceptions/page.tsx", import.meta.url);
  const intercept = name => name === "next/navigation" ? { notFound() { throw marker; } } : undefined;
  const production = loadTsx(file, intercept, { env: { NODE_ENV: "production" } }).default;
  let accessed = 0;
  await assert.rejects(production(Object.defineProperty({}, "searchParams", { get() { accessed++; throw new Error("private-canary"); } })), error => error === marker);
  assert.equal(accessed, 0);
  const page = loadTsx(file, intercept).default;
  const valid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
  assert.equal((valid.match(/<h1>/g) ?? []).length, 1); assert.ok(valid.includes("Current source health is unavailable"));
  const invalid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ runId: id(1), provider: "private-canary" }) }));
  assert.ok(invalid.includes("Check the workspace link")); assert.ok(!invalid.includes("private-canary"));
});
