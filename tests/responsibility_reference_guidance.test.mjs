import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { responsibilityDraftJson } from "../src/responsibility-draft.ts";
import { proposalReport, proposalId, proposalScope } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const field = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const click = (h, label) => h.nodes().find(node => node.type === "button" && node.props.children === label).props.onClick();
const change = (h, suffix, value) => field(h, suffix).props.onChange({ currentTarget: { value } });
const choose = (h, suffix, values) => field(h, suffix).props.onChange({ currentTarget: { selectedOptions: values.map(value => ({ value })) } });
const preview = h => h.nodes().find(node => node.props.readOnly)?.props.value;
const ready = () => { const c = capturedScopeDraftContext(proposalReport()), h = responsibilityDraftHarness(c); h.mount(); return { c, h }; };
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };

test("selected references remain inspectable before valid wording and outside search without changing reviewed JSON", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No request"));
  const { c, h } = ready(); try {
    click(h, "Add responsibility entry"); change(h, "-1-statement", c.claims[0].id);
    choose(h, "-1-institution-references", [`${c.claims[0].id}:2`]);
    assert.equal(preview(h), undefined); let html = renderToStaticMarkup(h.render());
    assert.ok(html.includes(`href="#proposal-proposed-reference-${c.claims[0].id}-2"`));
    assert.match(html, /conflicting with its recorded statement, not necessarily with this new wording/);
    change(h, "-reference-search", "NO_MATCH_PRIVATE_QUERY"); html = renderToStaticMarkup(h.render());
    assert.match(html, /0 of 2 recorded reference choices match/); assert.match(html, /Selected outside this filter/);
    assert.deepEqual(field(h, "-1-institution-references").props.value, [`${c.claims[0].id}:2`]);
    assert.doesNotMatch(html, /href="[^"]*NO_MATCH_PRIVATE_QUERY|<form/);
    change(h, "-1-institution-wording", "Invented authority awaiting factual review"); click(h, "Review responsibility draft"); const json = preview(h); assert.ok(json);
    change(h, "-reference-search", "ＣＯＮＴＲＡＤＩＣＴＳ"); assert.equal(preview(h), json);
    click(h, "Show all responsibility reference choices"); assert.equal(preview(h), json);
  } finally { h.unmount(); }
});
test("explicit held review links each affected statement wording and reference control using only fixed hints", () => {
  const { h } = ready(); try {
    click(h, "Add responsibility entry"); choose(h, "-1-institution-references", ["PRIVATE_FOREIGN_REFERENCE"]); click(h, "Review responsibility draft");
    for (const suffix of ["-1-statement", "-1-institution-wording", "-1-institution-references"]) {
      const control = field(h, suffix); assert.equal(control.props["aria-invalid"], true);
      const nodes = h.nodes(); for (const id of control.props["aria-describedby"].split(" ")) assert.equal(nodes.filter(node => node.props.id === id).length, 1);
      assert.ok(nodes.some(node => node.type === "a" && node.props.href === `#${control.props.id}`));
    }
    const html = renderToStaticMarkup(h.render()); assert.doesNotMatch(html, /PRIVATE_FOREIGN_REFERENCE/); assert.match(html, /one to twelve distinct reference/);
    assert.equal(field(h, "-1-role-wording").props["aria-invalid"], undefined);
    change(h, "-1-institution-wording", "New unreviewed wording"); assert.equal(field(h, "-1-institution-wording").props["aria-invalid"], undefined);
  } finally { h.unmount(); }
});
test("query-only edits preserve a pending physical File read and install the exact unchanged preparation", async t => {
  const { c, h } = ready(); let finish, aborts = 0;
  const nativeAbort = AbortController.prototype.abort;
  t.mock.method(AbortController.prototype, "abort", function (...args) { aborts++; return nativeAbort.apply(this, args); });
  const json = responsibilityDraftJson({ schemaVersion: 1, kind: "responsibility_preparation", binding: c.binding, entries: [] }, c), bytes = new TextEncoder().encode(json);
  try {
    field(h, "-file").props.onChange({ currentTarget: { files: [{ size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }; } }], value: "PRIVATE_FILENAME" } });
    const before = aborts; change(h, "-reference-search", "NO_MATCH"); assert.equal(aborts, before); assert.equal(field(h, "-file").props.disabled, true);
    finish(bytes.buffer); await tick(); assert.equal(preview(h), json); assert.equal(field(h, "-reference-search").props.value, "NO_MATCH");
    assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_FILENAME/);
  } finally { finish?.(bytes.buffer); h.unmount(); await tick(); }
});
test("old query clear input and context callbacks cannot clear a later search or inspect retired event fields", () => {
  const { c, h } = ready(); try {
    change(h, "-reference-search", "supports"); const oldClear = h.nodes().find(node => node.props.children === "Show all responsibility reference choices").props.onClick;
    change(h, "-reference-search", "contradicts"); oldClear(); assert.equal(field(h, "-reference-search").props.value, "contradicts");
    const oldInput = field(h, "-reference-search").props.onChange; click(h, "Show all responsibility reference choices");
    const forbidden = new Proxy({}, { get() { assert.fail("Retired query inspected event"); } }); oldInput(forbidden);
    const currentInput = field(h, "-reference-search").props.onChange;
    h.render({ ...c, binding: { ...c.binding, captureId: proposalId(99) } }); currentInput(forbidden); h.commit(); assert.equal(field(h, "-reference-search").props.value, "");
    const finalInput = field(h, "-reference-search").props.onChange; h.unmount(); finalInput(forbidden);
  } finally { h.unmount(); }
});
test("a query value getter cannot apply older text after a reentrant current clear retires that input epoch", () => {
  const { h } = ready(); try {
    change(h, "-reference-search", "supports"); const oldInput = field(h, "-reference-search").props.onChange;
    const clear = h.nodes().find(node => node.props.children === "Show all responsibility reference choices").props.onClick;
    let reads = 0; oldInput({ currentTarget: { get value() { reads++; clear(); return "contradicts"; } } });
    assert.equal(reads, 1); assert.equal(field(h, "-reference-search").props.value, "");
    assert.equal(preview(h), undefined);
  } finally { h.unmount(); }
});
test("duplicate entries have a separate exact fieldset target while another documented role permits distinct entries", () => {
  const { c, h } = ready(); try {
    click(h, "Add responsibility entry"); change(h, "-1-statement", c.claims[0].id);
    click(h, "Add responsibility entry"); change(h, "-2-statement", c.claims[0].id); click(h, "Review responsibility draft");
    assert.equal(preview(h), undefined); const target = field(h, "-2-entry"); assert.equal(target.props.tabIndex, -1);
    assert.ok(h.nodes().some(node => node.type === "a" && node.props.href === `#${target.props.id}`));
    change(h, "-2-role-wording", "Invented later delivery role"); choose(h, "-2-role-references", [`${c.claims[0].id}:1`]); click(h, "Review responsibility draft");
    assert.equal(JSON.parse(preview(h)).entries.length, 2); assert.doesNotMatch(renderToStaticMarkup(h.render()), /duplicates an earlier complete responsibility entry/);
  } finally { h.unmount(); }
});
test("complete UTF8 overflow is distinct from valid individual fields and preserves unknown values and editing", () => {
  const { c, h } = ready(); try {
    for (let i = 1; i <= 8; i++) {
      click(h, "Add responsibility entry"); change(h, `-${i}-statement`, c.claims[0].id);
      change(h, `-${i}-institution-wording`, String(i) + "😀".repeat(1199)); choose(h, `-${i}-institution-references`, [`${c.claims[0].id}:1`]);
    }
    click(h, "Review responsibility draft"); assert.equal(preview(h), undefined); assert.match(renderToStaticMarkup(h.render()), /complete preparation exceeds the 16 KiB UTF-8 limit/);
    assert.equal(field(h, "-1-institution-wording").props["aria-invalid"], undefined); assert.equal(field(h, "-1-role-wording").props.value, "");
  } finally { h.unmount(); }
});
test("copied-JSON refusal stays separate from field review and actual selected parent links resolve only inside the checked capture", () => {
  const { c, h } = ready(); let calls = 0;
  const View = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url), name => name === "./responsibility-draft-view.tsx" ? {
    ResponsibilityDraftView({ context }) { calls++; assert.deepEqual(context, c); return h.render(); },
  } : undefined).ProposalComparisonView;
  try {
    click(h, "Add responsibility entry"); choose(h, "-1-institution-references", [`${c.claims[0].id}:2`]); click(h, "Review responsibility draft");
    change(h, "-reopen-json", "{}"); click(h, "Reopen responsibility preparation");
    const html = renderToStaticMarkup(h.render()); assert.match(html, /Copied responsibility preparation could not be checked/); assert.doesNotMatch(html, /aria-invalid="true"/);
    const render = report => renderToStaticMarkup(View({ decision: { kind: "ok", report }, selection: proposalScope() }));
    const full = render(proposalReport()), anchor = `proposal-proposed-reference-${c.claims[0].id}-2`;
    assert.ok(full.includes(`href="#${anchor}"`)); assert.equal([...full.matchAll(new RegExp(`id="${anchor}"`, "g"))].length, 1);
    const corrupt = proposalReport(); corrupt.capture.proposalSha256 = "0".repeat(64); const withheld = render(corrupt); assert.equal(calls, 1); assert.doesNotMatch(withheld, /Inspect 1 selected reference|responsibility-preparation/);
  } finally { h.unmount(); }
});
