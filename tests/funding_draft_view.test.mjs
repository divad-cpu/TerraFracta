import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { fundingContext, fundingReport, fundingFormEntries, emptyFundingDraft, fundingEntry } from "./helpers/funding_draft_fixture.mjs";
import { fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { proposalReport, proposalScope, proposalId } from "./helpers/proposal_fixture.mjs";
import { fundingDraftJson } from "../src/funding-draft.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/funding-draft-view.tsx", import.meta.url), name: "FundingDraftView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === text) ?? assert.fail(text);
const click = (h, text) => button(h, text).props.onClick();
const controls = h => h.nodes().find(node => node.props["aria-label"] === "Unsent funding controls");
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const paste = h => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-paste"));
const changePaste = (h, value) => paste(h).props.onChange({ currentTarget: { value } });
const inspect = (h, values) => { controls(h).props.ref.current = fakePolicyEventControls(values); click(h, "Inspect unsent funding draft"); };
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));

test("funding starts disabled and stays form-free with no implicit zero or default currency", t => {
  noNetwork(t); const h = harness(fundingContext());
  assert.ok(h.nodes().filter(node => ["button", "input", "select", "textarea"].includes(node.type)).every(node => node.props.disabled));
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<form|type="submit"|type="number"|href="https:/);
  h.mount(); inspect(h, []); assert.deepEqual(JSON.parse(output(h)).entries, []); h.unmount();
});
test("exact decimal amount source scale financial period and replacement remain separate in the actual preview", t => {
  noNetwork(t); const c = fundingContext(), h = harness(c); h.mount(); click(h, "Add funding entry"); inspect(h, fundingFormEntries(c));
  assert.equal(JSON.parse(output(h)).entries[0].fields.amount.value, "9007199254740993.000000001");
  const html = renderToStaticMarkup(h.render());
  for (const text of ["9007199254740993.000000001", "Millions", "FY 2026/27", "Constant prices", "2020", "Cumulative total", "Replaces an earlier amount"])
    assert.ok(html.includes(text), text);
  assert.match(html, /Allocation does not establish payment or expenditure/); assert.match(html, /They are not a total/);
  assert.match(html, /original role: contradicts/); assert.ok(html.includes(`href="#proposal-proposed-reference-${c.claims[0].id}-2"`));
  h.unmount();
});
test("bad numerical or reference choices hold without leaking the value and eager edits withhold a pending old preview", t => {
  noNetwork(t); const c = fundingContext(), h = harness(c); h.mount(); click(h, "Add funding entry"); inspect(h, fundingFormEntries(c));
  const oldInspect = button(h, "Inspect unsent funding draft").props.onClick;
  h.pauseMerges(); controls(h).props.onChange(); assert.equal(output(h), undefined);
  oldInspect(new Proxy({}, { get() { assert.fail("Retired callback observed event"); } })); h.flushMerges();
  inspect(h, fundingFormEntries(c, 1, "PRIVATE_INVALID_AMOUNT")); assert.equal(output(h), undefined);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_INVALID_AMOUNT/); assert.match(renderToStaticMarkup(h.render()), /Funding preparation held/); h.unmount();
});
test("clear remove context replacement and unmount deny old inspectors before any control collection observation", t => {
  noNetwork(t);
  for (const action of ["clear", "remove", "context", "unmount"]) {
    const c = fundingContext(), h = harness(c); h.mount(); click(h, "Add funding entry");
    const inspect = button(h, "Inspect unsent funding draft").props.onClick;
    controls(h).props.ref.current = new Proxy({}, { get() { assert.fail("Retired control collection observed"); } });
    if (action === "clear") click(h, "Clear funding draft");
    if (action === "remove") click(h, "Remove funding entry 1");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(91); h.render(next); }
    if (action === "unmount") h.unmount();
    inspect(); assert.equal(output(h), undefined); h.unmount();
  }
});
test("shared option lookup retirement fences prevent later value reads in a funding inspection", t => {
  noNetwork(t); const c = fundingContext(), h = harness(c); h.mount(); click(h, "Add funding entry"); let observed = 0;
  const next = structuredClone(c); next.binding.captureId = proposalId(92);
  const control = { getAttribute: () => "1.amountReferences", tagName: "SELECT", multiple: true,
    selectedOptions: { length: 1, item() { h.render(next); return { get value() { observed++; return "PRIVATE"; } }; } } };
  controls(h).props.ref.current = { elements: { length: 1, item: () => control } }; click(h, "Inspect unsent funding draft");
  assert.equal(observed, 0); assert.equal(output(h), undefined); h.unmount();
});
test("exact saved funding data reopens with fresh control defaults and changed paste cannot restore an old preview", t => {
  noNetwork(t); const c = fundingContext(), draft = emptyFundingDraft(c); draft.entries.push(fundingEntry(c));
  const json = fundingDraftJson(draft, c), h = harness(c); h.mount(); changePaste(h, json); click(h, "Reopen funding preparation");
  assert.equal(output(h), json); assert.equal(h.nodes().find(node => node.props.name?.endsWith(".amount")).props.defaultValue, "9007199254740993.000000001");
  const oldReopen = button(h, "Reopen funding preparation").props.onClick;
  changePaste(h, json + "\n"); oldReopen(); assert.equal(output(h), undefined); click(h, "Reopen funding preparation"); assert.equal(output(h), undefined); h.unmount();
});
test("reentrant paste preserves newer intent while clear retires its old event observer", t => {
  noNetwork(t); const h = harness(fundingContext()); h.mount(); const change = paste(h).props.onChange;
  change({ get currentTarget() { change({ currentTarget: { value: "NEWEST" } }); return { value: "OLDER" }; } });
  assert.equal(paste(h).props.value, "NEWEST"); click(h, "Clear funding draft");
  change(new Proxy({}, { get() { assert.fail("Retired paste observed event"); } })); assert.equal(paste(h).props.value, ""); h.unmount();
});
test("four distinct funding entries are a hard action bound and exact duplicates stay held", t => {
  noNetwork(t); const c = fundingContext(), h = harness(c); h.mount(); for (let i = 0; i < 4; i++) click(h, "Add funding entry");
  assert.equal(button(h, "Add funding entry").props.disabled, true); click(h, "Add funding entry");
  assert.equal(h.nodes().filter(node => node.type === "fieldset" && !node.props.ref).length, 4);
  inspect(h, Array.from({ length: 4 }, (_, i) => fundingFormEntries(c, i + 1)).flat()); assert.equal(output(h), undefined); h.unmount();
});
test("source-defined period wording is escaped and never treated as executable markup", t => {
  noNetwork(t); const c = fundingContext(), h = harness(c); h.mount(); click(h, "Add funding entry");
  inspect(h, fundingFormEntries(c).map(([key, value]) => [key, key === "1.financialPeriod" ? "<script>PRIVATE_PERIOD</script>" : value]));
  const html = renderToStaticMarkup(h.render()); assert.match(html, /&lt;script&gt;PRIVATE_PERIOD&lt;\/script&gt;/); assert.doesNotMatch(html, /<script/); h.unmount();
});
test("captured funding comparison joins exact source anchors and withheld or nonfunding comparisons cannot invent an editable record", () => {
  const View = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)).ProposalComparisonView;
  const html = renderToStaticMarkup(View({ decision: { kind: "ok", report: fundingReport() }, selection: proposalScope() }));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(value => value === id).length, 1, id);
  assert.equal(ids.filter(id => id === "proposal-funding-preparation").length, 1); assert.doesNotMatch(html, /<form|type="submit"/);
  const held = renderToStaticMarkup(View({ decision: { kind: "unavailable" }, selection: proposalScope() })); assert.doesNotMatch(held, /proposal-funding-preparation|Prepare unsent funding/);
  const noFunding = renderToStaticMarkup(View({ decision: { kind: "ok", report: proposalReport() }, selection: proposalScope() }));
  assert.match(noFunding, /No proposed funding statement is available/);
});
