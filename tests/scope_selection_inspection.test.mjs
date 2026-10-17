import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { scopeReferenceKey } from "../src/issue-scope-draft.ts";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { proposalReport } from "./helpers/proposal_fixture.mjs";
import { proposalScope, proposalId } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { encodeProposalCapture } from "../src/server/proposal-capture.ts";

const input = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
test("an editor can inspect a selected exact reference before wording is complete or review can succeed", () => {
  const context = capturedScopeDraftContext(proposalReport()), h = scopeDraftHarness(context); h.mount();
  try {
    const value = scopeReferenceKey(context.claims[0].id, 2);
    input(h, "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value }] } });
    const html = renderToStaticMarkup(h.render());
    assert.ok(html.includes(`href="#proposal-proposed-reference-${context.claims[0].id}-2"`),
      "Selected evidence needs an inspection path while the new wording is still incomplete");
    assert.ok(!h.nodes().some(node => node.type === "textarea" && node.props.readOnly));
  } finally { h.unmount(); }
});

test("selected inspection survives reference filtering, discloses the recorded conflict and leaves review gates intact", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No request permitted"));
  const context = capturedScopeDraftContext(proposalReport()), h = scopeDraftHarness(context); h.mount();
  const click = label => h.nodes().find(node => node.type === "button" && node.props.children === label).props.onClick();
  try {
    const values = [1, 2].map(number => scopeReferenceKey(context.claims[0].id, number));
    input(h, "-population-references").props.onChange({ currentTarget: { selectedOptions: values.map(value => ({ value })) } });
    input(h, "-reference-search").props.onChange({ currentTarget: { value: "NO_MATCH_IN_CHOICES" } });
    const html = renderToStaticMarkup(h.render());
    assert.match(html, /Inspect 2 selected references for Affected population/);
    assert.match(html, /labelled as conflicting with its recorded statement/);
    assert.match(html, /do not establish support for your new wording/);
    for (const number of [1, 2]) assert.ok(html.includes(`href="#proposal-proposed-reference-${context.claims[0].id}-${number}"`));
    assert.deepEqual(input(h, "-population-references").props.value, values);
    click("Review scope draft"); assert.ok(!h.nodes().some(node => node.props.readOnly));
    input(h, "-population-wording").props.onChange({ currentTarget: { value: "Invented scope awaiting factual review" } });
    click("Review scope draft"); const preview = h.nodes().find(node => node.props.readOnly);
    assert.ok(preview); assert.equal(JSON.parse(preview.props.value).fields.population.references.length, 2);
    click("Clear scope draft"); assert.doesNotMatch(renderToStaticMarkup(h.render()), /Inspect [12] selected reference/);
  } finally { h.unmount(); }
});

test("foreign and repeated selections cannot become new targets or bypass canonical review, and labels stay escaped", () => {
  const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson);
  payload.snapshot.claims[0].evidence[0].title = '<img src=x onerror="PRIVATE_SOURCE_EVENT">';
  Object.assign(report.capture, encodeProposalCapture(payload));
  const context = capturedScopeDraftContext(report), h = scopeDraftHarness(context); h.mount();
  try {
    const value = scopeReferenceKey(context.claims[0].id, 1);
    input(h, "-population-references").props.onChange({ currentTarget: { selectedOptions: [value, value, "PRIVATE_FOREIGN_REFERENCE"].map(value => ({ value })) } });
    const html = renderToStaticMarkup(h.render());
    assert.match(html, /Some selections could not be located as distinct references/);
    assert.doesNotMatch(html, /<img|href="[^\"]*PRIVATE_FOREIGN_REFERENCE|PRIVATE_FOREIGN_REFERENCE/);
    assert.match(html, /&lt;img/);
    assert.equal([...html.matchAll(new RegExp(`href="#proposal-proposed-reference-${context.claims[0].id}-1"`, "g"))].length, 1);
    input(h, "-population-wording").props.onChange({ currentTarget: { value: "Invented scope wording" } });
    h.nodes().find(node => node.type === "button" && node.props.children === "Review scope draft").props.onClick();
    assert.ok(!h.nodes().some(node => node.props.readOnly));
  } finally { h.unmount(); }
});

test("replacement capture admission and committed unmount withhold earlier selections before stale event access", () => {
  const context = capturedScopeDraftContext(proposalReport()), h = scopeDraftHarness(context); h.mount();
  const change = input(h, "-population-references").props.onChange;
  change({ currentTarget: { selectedOptions: [{ value: scopeReferenceKey(context.claims[0].id, 1) }] } });
  assert.match(renderToStaticMarkup(h.render()), /Inspect 1 selected reference/);
  const next = { ...context, binding: { ...context.binding, captureId: proposalId(99) } };
  assert.doesNotMatch(renderToStaticMarkup(h.render(next)), /Inspect 1 selected reference/);
  const forbidden = new Proxy({}, { get() { assert.fail("Retired handler observed an event"); } });
  change(forbidden); h.commit(); assert.doesNotMatch(renderToStaticMarkup(h.render()), /Inspect 1 selected reference/);
  h.unmount(); change(forbidden);
});

test("selected links resolve to the actual checked parent occurrence and a changed report withholds the whole preparation", () => {
  const report = proposalReport(), context = capturedScopeDraftContext(report), h = scopeDraftHarness(context); h.mount();
  let calls = 0;
  const View = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url), name => name === "./issue-scope-draft-view.tsx" ? {
    IssueScopeDraftView({ context: observed }) { calls++; assert.deepEqual(observed, context); return h.render(); },
  } : undefined).ProposalComparisonView;
  try {
    input(h, "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value: scopeReferenceKey(context.claims[0].id, 2) }] } });
    const render = value => renderToStaticMarkup(View({ decision: { kind: "ok", report: value }, selection: proposalScope() }));
    const html = render(report); assert.equal(calls, 1);
    const target = `proposal-proposed-reference-${context.claims[0].id}-2`;
    assert.ok(html.includes(`href="#${target}"`)); assert.equal([...html.matchAll(new RegExp(`id="${target}"`, "g"))].length, 1);
    assert.match(html, /Inspect 1 selected reference for Affected population/);
    const changed = structuredClone(report); changed.capture.proposalSha256 = "0".repeat(64);
    const withheld = render(changed); assert.equal(calls, 1); assert.doesNotMatch(withheld, /Inspect 1 selected reference|proposal-proposed-reference/);
  } finally { h.unmount(); }
});
