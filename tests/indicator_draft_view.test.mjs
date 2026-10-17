import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { indicatorContext, indicatorReport, indicatorEntry, indicatorFields, emptyIndicatorDraft, indicatorFormEntries } from "./helpers/indicator_draft_fixture.mjs";
import { indicatorDraftJson } from "../src/indicator-draft.ts";
import { proposalId, proposalScope } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/indicator-draft-view.tsx", import.meta.url), name: "IndicatorDraftView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === text) ?? assert.fail(text);
const click = (h, text) => button(h, text).props.onClick();
const controls = h => h.nodes().find(node => node.props["aria-label"] === "Unsent indicator controls");
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const paste = h => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-paste"));
const changePaste = (h, value) => paste(h).props.onChange({ currentTarget: { value } });
const inspect = (h, values) => { controls(h).props.ref.current = fakePolicyEventControls(values); click(h, "Inspect unsent indicator draft"); };
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));

test("indicator controls start disabled remain form-free and do not invent an observation or missing reason", t => {
  noNetwork(t); const h = harness(indicatorContext());
  assert.ok(h.nodes().filter(node => ["button", "input", "select", "textarea"].includes(node.type)).every(node => node.props.disabled));
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<form|type="submit"|type="number"|href="https:/);
  h.mount(); inspect(h, []); assert.deepEqual(JSON.parse(output(h)).entries, []); assert.doesNotMatch(renderToStaticMarkup(h.render()), /<table/); h.unmount();
});
test("joined preview preserves exact observation denominator period vintage and original contradictory role", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry"); inspect(h, indicatorFormEntries(c));
  const value = JSON.parse(output(h)); assert.equal(value.entries[0].fields.value.value, "9007199254740993.000000001");
  const html = renderToStaticMarkup(h.render());
  for (const text of ["responding sample, exclusions stated by source", "fieldwork interval 2024/25", "revised edition B", "original role: contradicts", "No interpolation, arithmetic, aggregation"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes(`href="#proposal-proposed-reference-${c.claims[0].id}-2"`));
  assert.doesNotMatch(html, /<table/); h.unmount();
});
test("definition table shows equal spellings different versions and missing coverage independently with accessible headings", t => {
  noNetwork(t); const c = indicatorContext(), draft = emptyIndicatorDraft(c), first = indicatorEntry(c, "1"), second = indicatorEntry(c, "2"), third = indicatorEntry(c, "3");
  second.fields.definitionVersion.value = "definition 3"; third.fields.definitionVersion = null; draft.entries = [first, second, third];
  const json = indicatorDraftJson(draft, c); assert.ok(json); const h = harness(c); h.mount(); changePaste(h, json); click(h, "Reopen indicator preparation");
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /role="region" aria-label="Indicator metadata comparison" tabindex="0"/);
  assert.match(html, /<caption>Source-described metadata in worksheet order; no series join or trend calculation<\/caption>/);
  assert.match(html, /<th scope="col">Entry 3<\/th>/); assert.match(html, /<th scope="row">Definition version<\/th>/);
  assert.match(html, /Some entries omit this field\. Supplied texts differ\./);
  assert.match(html, /Every entry supplies this field\. Supplied texts have the same spelling\./);
  assert.match(html, /Equal spelling does not establish identity/); assert.match(html, /Unknown — no value supplied/); h.unmount();
});
test("source-stated missingness is displayed separately and invalid simultaneous value is held without exposing bad input", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
  const pairs = indicatorFormEntries(c).filter(([name]) => !name.endsWith(".valueReferences"));
  for (const pair of pairs) { if (pair[0] === "1.value") pair[1] = ""; if (pair[0] === "1.missingReason") pair[1] = "withheld"; }
  pairs.push(["1.missingReasonReferences", `${c.claims[0].id}:1`]); inspect(h, pairs);
  assert.equal(JSON.parse(output(h)).entries[0].fields.value, null); assert.match(renderToStaticMarkup(h.render()), /<p>Withheld<\/p>/);
  inspect(h, [...pairs.filter(([name]) => name !== "1.value"), ["1.value", "PRIVATE_INVALID_VALUE"]]);
  assert.equal(output(h), undefined); const html = renderToStaticMarkup(h.render()); assert.match(html, /Indicator preparation held/); assert.doesNotMatch(html, /PRIVATE_INVALID_VALUE/); h.unmount();
});
test("edits eagerly hide an old preview before deferred state updates and old inspectors cannot read controls", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry"); inspect(h, indicatorFormEntries(c));
  const oldInspect = button(h, "Inspect unsent indicator draft").props.onClick;
  h.pauseMerges(); controls(h).props.onChange(); assert.equal(output(h), undefined);
  controls(h).props.ref.current = new Proxy({}, { get() { assert.fail("Old inspector observed controls"); } });
  oldInspect(); h.flushMerges(); assert.equal(output(h), undefined); h.unmount();
});
test("clear remove context replacement and unmount retire earlier inspectors before property observation", t => {
  noNetwork(t);
  for (const action of ["clear", "remove", "context", "unmount"]) {
    const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
    const old = button(h, "Inspect unsent indicator draft").props.onClick;
    controls(h).props.ref.current = new Proxy({}, { get() { assert.fail("Retired controls observed"); } });
    if (action === "clear") click(h, "Clear indicator draft"); if (action === "remove") click(h, "Remove indicator entry 1");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(94); h.render(next); }
    if (action === "unmount") h.unmount(); old(); assert.equal(output(h), undefined); h.unmount();
  }
});
test("reentrant selected-option retirement refuses a later private value observation", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry"); let observed = 0;
  const next = structuredClone(c); next.binding.captureId = proposalId(95);
  const control = { getAttribute: () => "1.valueReferences", tagName: "SELECT", multiple: true,
    selectedOptions: { length: 1, item() { h.render(next); return { get value() { observed++; return "PRIVATE"; } }; } } };
  controls(h).props.ref.current = { elements: { length: 1, item: () => control } }; click(h, "Inspect unsent indicator draft");
  assert.equal(observed, 0); assert.equal(output(h), undefined); h.unmount();
});
test("exact copied JSON reopening restores decimal spelling and every source control while changed bytes retire old actions", t => {
  noNetwork(t); const c = indicatorContext(), draft = emptyIndicatorDraft(c); draft.entries.push(indicatorEntry(c, "-0.000"));
  const json = indicatorDraftJson(draft, c), h = harness(c); h.mount(); changePaste(h, json); click(h, "Reopen indicator preparation");
  assert.equal(output(h), json); assert.equal(h.nodes().find(node => node.props.name?.endsWith(".value")).props.defaultValue, "-0.000");
  assert.deepEqual(h.nodes().find(node => node.props.name?.endsWith(".definitionVersionReferences")).props.value, [`${c.claims[0].id}:2`]);
  const old = button(h, "Reopen indicator preparation").props.onClick; changePaste(h, json + "\n"); old(); assert.equal(output(h), undefined);
  click(h, "Reopen indicator preparation"); assert.equal(output(h), undefined); h.unmount();
});
test("paste latest intent wins and clear retires its event callback without observing private values", t => {
  noNetwork(t); const h = harness(indicatorContext()); h.mount(); const change = paste(h).props.onChange;
  change({ get currentTarget() { change({ currentTarget: { value: "LATEST" } }); return { value: "STALE" }; } });
  assert.equal(paste(h).props.value, "LATEST"); click(h, "Clear indicator draft");
  change(new Proxy({}, { get() { assert.fail("Retired paste observed event"); } })); assert.equal(paste(h).props.value, ""); h.unmount();
});
test("four sparse observations fit real control bounds and preserve four zero values without aggregate totals", t => {
  noNetwork(t); const c = indicatorContext(), draft = emptyIndicatorDraft(c);
  draft.entries = Array.from({ length: 4 }, (_, i) => ({ claimId: c.claims[0].id, fields: { ...indicatorFields(),
    value: indicatorEntry(c, "0.000").fields.value, observationPeriod: { ...indicatorEntry(c).fields.observationPeriod, value: `source period ${i}` } } }));
  const h = harness(c); h.mount(); changePaste(h, indicatorDraftJson(draft, c)); click(h, "Reopen indicator preparation");
  assert.equal(button(h, "Add indicator entry").props.disabled, true); click(h, "Add indicator entry");
  assert.equal(h.nodes().filter(node => node.type === "fieldset" && !node.props.ref).length, 4);
  const nativeControls = h.nodes().filter(node => ["input", "select", "textarea"].includes(node.type) && node.props.name).map(node => {
    const value = node.props.multiple ? node.props.value : node.props.defaultValue;
    return {
    getAttribute: name => name === "name" ? node.props.name : null, tagName: node.type.toUpperCase(), type: "text", multiple: node.props.multiple,
    value, selectedOptions: { length: node.props.multiple ? value.length : 0,
      item: index => ({ value: value[index] }) },
  }; });
  assert.equal(nativeControls.length, 108); controls(h).props.ref.current = { elements: { length: nativeControls.length, item: index => nativeControls[index] } };
  click(h, "Inspect unsent indicator draft"); assert.equal(JSON.parse(output(h)).entries.length, 4);
  assert.ok(JSON.parse(output(h)).entries.every(entry => entry.fields.value.value === "0.000")); h.unmount();
});
test("definition and period text are escaped in cells and references never become executable markup", t => {
  noNetwork(t); const c = indicatorContext(), draft = emptyIndicatorDraft(c), entry = indicatorEntry(c);
  entry.fields.definition.value = '<img src=x onerror="PRIVATE">'; draft.entries = [entry, indicatorEntry(c, "2")];
  const h = harness(c); h.mount(); changePaste(h, indicatorDraftJson(draft, c)); click(h, "Reopen indicator preparation");
  const html = renderToStaticMarkup(h.render()); assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img src=x onerror=/); h.unmount();
});
test("only fully checked comparisons expose indicator preparation while source panels and original references remain", () => {
  const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)), report = indicatorReport();
  const html = renderToStaticMarkup(ProposalComparisonView({ decision: { kind: "ok", report }, selection: proposalScope() }));
  assert.match(html, /id="proposal-indicator-preparation" tabindex="-1"/); assert.match(html, /href="#proposal-indicator-preparation"/);
  assert.match(html, /id="proposal-base-snapshot"/); assert.match(html, /id="proposal-proposed-snapshot"/);
  for (const kind of ["unavailable", "invalid_scope", "capture_missing"]) {
    const held = renderToStaticMarkup(ProposalComparisonView({ decision: { kind, report }, selection: proposalScope() }));
    assert.doesNotMatch(held, /proposal-indicator-preparation|Unsent indicator controls/);
  }
});
