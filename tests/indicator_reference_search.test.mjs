import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { indicatorContext, indicatorEntry, emptyIndicatorDraft } from "./helpers/indicator_draft_fixture.mjs";
import { indicatorDraftJson } from "../src/indicator-draft.ts";
import { preparationReferenceValues, policyEventControlEntries } from "../src/policy-event-controls.ts";
import { proposalId } from "./helpers/proposal_fixture.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/indicator-draft-view.tsx", import.meta.url), name: "IndicatorDraftView" });
const button = (h, label) => h.nodes().find(n => n.type === "button" && [n.props.children].flat().join("") === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const suffix = (h, name) => h.nodes().find(n => n.props.id?.endsWith(name)) ?? assert.fail(name);
const named = (h, name) => h.nodes().find(n => n.props.name === name) ?? assert.fail(name);
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const html = h => renderToStaticMarkup(h.render());
const query = (h, value) => suffix(h, "-reference-search").props.onChange({ currentTarget: { value } });
const optionKeys = n => elements(n.props.children).filter(n => n.type === "option").map(n => n.props.value);
const selected = keys => ({ selectedOptions: { length: keys.length, item(index) { return keys[index] === undefined ? null : { value: keys[index] }; } } });
const choose = (h, name, keys) => named(h, name).props.onChange({ currentTarget: selected(keys) });
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));
function reopened(c = indicatorContext()) {
  const h = harness(c); h.mount(); const draft = emptyIndicatorDraft(c); draft.entries.push(indicatorEntry(c)); const json = indicatorDraftJson(draft, c);
  suffix(h, "-paste").props.onChange({ currentTarget: { value: json } }); click(h, "Reopen indicator preparation"); assert.equal(output(h), json); return { h, c, json };
}
// Use actual controlled/default props, including empty selections and unnamed
// fieldsets/buttons, as explicit native control doubles. No DOM claim.
function attachActualControls(h) {
  const root = h.nodes().find(n => n.props["aria-label"] === "Unsent indicator controls");
  const nodes = elements(root.props.children).filter(n => ["fieldset", "input", "select", "textarea", "button"].includes(n.type));
  const controls = nodes.map(n => ({ getAttribute: key => key === "name" ? n.props.name ?? null : null,
    tagName: n.type.toUpperCase(), type: n.props.type ?? "text", multiple: !!n.props.multiple,
    value: n.props.value ?? n.props.defaultValue ?? "", ...(n.props.multiple ? selected(n.props.value ?? n.props.defaultValue ?? []) : {}) }));
  root.props.ref.current = { elements: { length: controls.length, item: index => controls[index] ?? null } }; return { root, nodes, controls };
}
function inspect(h) { attachActualControls(h); click(h, "Inspect unsent indicator draft"); }

test("indicator search starts unadmitted and is outside the bounded inspected controls", t => {
  noNetwork(t); const h = harness(indicatorContext()); assert.equal(suffix(h, "-reference-search").props.disabled, true);
  assert.equal(button(h, "Show all indicator reference choices").props.disabled, true); h.mount(); click(h, "Add indicator entry");
  const { nodes } = attachActualControls(h); assert.ok(nodes.every(n => n.props.id !== suffix(h, "-reference-search").props.id));
  assert.equal(suffix(h, "-reference-search").props.maxLength, 80); assert.doesNotMatch(html(h), /<form|type="submit"|href="https:/); h.unmount();
});
test("filtered choices retain exact selected outside matches in original occurrence order without changing preview or JSON", t => {
  noNetwork(t); const { h, c, json } = reopened(), first = `${c.claims[0].id}:1`, second = `${c.claims[0].id}:2`;
  query(h, "contradicts"); assert.deepEqual(optionKeys(named(h, "1.valueReferences")), [first, second]);
  assert.deepEqual(named(h, "1.valueReferences").props.value, [first]); assert.match(html(h), /Selected outside this filter/);
  assert.deepEqual(optionKeys(named(h, "1.definitionVersionReferences")), [second]); assert.equal(output(h), json);
  query(h, "no-such-captured-occurrence"); assert.deepEqual(optionKeys(named(h, "1.valueReferences")), [first]); assert.equal(output(h), json);
  inspect(h); assert.equal(output(h), json); h.unmount();
});
test("all words match one recorded occurrence and invalid queries never broaden or discard selected choices", t => {
  noNetwork(t); const { h, c, json } = reopened();
  query(h, "contrasting row 2"); assert.match(html(h), /1 of 2 recorded reference choices match/);
  query(h, "table row 99"); assert.match(html(h), /0 of 2 recorded reference choices match/);
  for (const value of ["x".repeat(81), "bad\u0000query", "ﬃ".repeat(30)]) {
    query(h, value); assert.match(html(h), /Reference search is invalid or unavailable/);
    assert.deepEqual(optionKeys(named(h, "1.valueReferences")), [`${c.claims[0].id}:1`]); assert.equal(output(h), json);
  }
  click(h, "Show all indicator reference choices"); assert.equal(suffix(h, "-reference-search").props.value, "");
  assert.equal(optionKeys(named(h, "1.valueReferences")).length, 2); assert.equal(output(h), json); h.unmount();
});
test("a valid explicit reference edit survives filters and exact copied reopening without changing observation digits", t => {
  noNetwork(t); const { h, c } = reopened(), second = `${c.claims[0].id}:2`;
  choose(h, "1.valueReferences", [second]); assert.equal(output(h), undefined); query(h, "supports");
  assert.deepEqual(named(h, "1.valueReferences").props.value, [second]); assert.match(html(h), /Selected outside this filter/);
  inspect(h); const saved = output(h); assert.equal(JSON.parse(saved).entries[0].fields.value.value, "9007199254740993.000000001");
  assert.equal(JSON.parse(saved).entries[0].fields.value.references[0].referenceNumber, 2);
  suffix(h, "-paste").props.onChange({ currentTarget: { value: saved } }); click(h, "Reopen indicator preparation");
  const refs = h.nodes().find(n => n.props.name?.endsWith(".valueReferences")); assert.deepEqual(refs.props.value, [second]);
  query(h, "nothing"); inspect(h); assert.equal(output(h), saved); h.unmount();
});
test("whole over-limit duplicate foreign and faulted selections retain prior choices and withhold inspection until explicit valid reselection", t => {
  noNetwork(t);
  for (const attempt of [keys => selected(Array(13).fill(keys[0])), keys => selected([keys[0], keys[0]]),
    () => selected([`${proposalId(999)}:1`]), () => ({ get selectedOptions() { throw Error("PRIVATE_SELECTION_FAULT"); } })]) {
    const { h, c } = reopened(), first = `${c.claims[0].id}:1`, control = named(h, "1.valueReferences");
    control.props.onChange({ currentTarget: attempt([first]) });
    assert.deepEqual(named(h, "1.valueReferences").props.value, [first]); assert.equal(output(h), undefined);
    assert.match(html(h), /Reference selection not applied/); assert.doesNotMatch(html(h), /PRIVATE_SELECTION_FAULT/);
    inspect(h); assert.equal(output(h), undefined); choose(h, "1.valueReferences", [first]); inspect(h); assert.ok(output(h)); h.unmount();
  }
});
test("same-control reentry keeps newest selection while independent reference edits merge in a paused batch", t => {
  noNetwork(t); const { h, c } = reopened(), first = `${c.claims[0].id}:1`, second = `${c.claims[0].id}:2`;
  const old = named(h, "1.valueReferences").props.onChange;
  old({ currentTarget: { selectedOptions: { length: 1, item() { choose(h, "1.valueReferences", [second]); return { get value() { assert.fail("Retired option value observed"); } }; } } } });
  assert.deepEqual(named(h, "1.valueReferences").props.value, [second]);
  h.pauseMerges(); choose(h, "1.valueReferences", [first]); choose(h, "1.unitReferences", [second]);
  h.nodes().find(n => n.props["aria-label"] === "Unsent indicator controls").props.onChange(); h.flushMerges();
  assert.deepEqual(named(h, "1.valueReferences").props.value, [first]); assert.deepEqual(named(h, "1.unitReferences").props.value, [second]);
  inspect(h); assert.equal(JSON.parse(output(h)).entries[0].fields.unit.references[0].referenceNumber, 2); h.unmount();
});
test("query target and value getters cannot overwrite a newer query or a displayed reset", t => {
  noNetwork(t); const { h, json } = reopened(); query(h, "supports");
  let old = suffix(h, "-reference-search").props.onChange, clear = button(h, "Show all indicator reference choices").props.onClick;
  old({ currentTarget: { get value() { clear(); return "older"; } } }); assert.equal(suffix(h, "-reference-search").props.value, "");
  old = suffix(h, "-reference-search").props.onChange;
  old({ get currentTarget() { query(h, "contradicts"); return { get value() { assert.fail("Retired search value observed"); } }; } });
  assert.equal(suffix(h, "-reference-search").props.value, "contradicts"); assert.equal(output(h), json); h.unmount();
});
test("retained query reset cannot erase a later input including a pending input update", t => {
  noNetwork(t); const { h } = reopened(); query(h, "supports"); const reset = button(h, "Show all indicator reference choices").props.onClick;
  h.pauseMerges(); query(h, "contradicts"); reset(); h.flushMerges(); assert.equal(suffix(h, "-reference-search").props.value, "contradicts"); h.unmount();
});
test("freshly represented Clear cancels pending reference observations while a retained pre-input Clear stays retired", t => {
  noNetwork(t);
  for (const boundary of ["target", "options", "item", "value"]) {
    const { h, c } = reopened(), oldClear = button(h, "Clear indicator draft").props.onClick;
    const edit = named(h, "1.valueReferences").props.onChange;
    const clear = () => {
      oldClear(); assert.ok(h.nodes().some(node => node.props.name === "1.valueReferences"), "Retained old Clear must be denied");
      click(h, "Clear indicator draft");
    };
    const options = { get length() { if (boundary === "options") assert.fail("Retired length observed"); return 1; },
      get item() { if (boundary === "item") { clear(); return () => assert.fail("Retired item invoked"); }
        return () => ({ get value() { if (boundary === "value") clear(); return `${c.claims[0].id}:1`; } }); } };
    edit({ get currentTarget() { if (boundary === "target") { clear(); return new Proxy({}, { get() { assert.fail("Retired native target observed"); } }); }
      return { get selectedOptions() { if (boundary === "options") clear(); return options; } }; } });
    assert.ok(!h.nodes().some(node => node.props.name?.endsWith(".claim"))); assert.equal(output(h), undefined);
    assert.equal(suffix(h, "-reference-search").props.value, ""); h.unmount();
  }
});
test("clear row removal changed capture and unmount retire old reference/search callbacks before event access", t => {
  noNetwork(t); const forbidden = new Proxy({}, { get() { assert.fail("Retired event was observed"); } });
  for (const action of ["clear", "remove", "context", "unmount"]) {
    const { h, c } = reopened(), ref = named(h, "1.valueReferences").props.onChange, search = suffix(h, "-reference-search").props.onChange;
    if (action === "clear") click(h, "Clear indicator draft");
    if (action === "remove") click(h, "Remove indicator entry 1");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(910); h.render(next); }
    if (action === "unmount") h.unmount(); ref(forbidden); search(forbidden); assert.equal(output(h), undefined); h.unmount();
  }
});
test("query read faults withhold matches preserve selections and expose only a fixed recovery notice", t => {
  noNetwork(t); const { h, c, json } = reopened();
  suffix(h, "-reference-search").props.onChange({ get currentTarget() { throw Error("PRIVATE_QUERY_FAULT"); } });
  assert.match(html(h), /Reference search is invalid or unavailable/); assert.doesNotMatch(html(h), /PRIVATE_QUERY_FAULT/);
  assert.deepEqual(optionKeys(named(h, "1.valueReferences")), [`${c.claims[0].id}:1`]); assert.equal(output(h), json);
  click(h, "Show all indicator reference choices"); assert.equal(optionKeys(named(h, "1.valueReferences")).length, 2); h.unmount();
});
test("maximum30 statements360 references and four rows filter exactly while search stays outside original control quota", t => {
  noNetwork(t); const c = indicatorContext(), original = structuredClone(c.claims[0]);
  c.claims = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(original), id: proposalId(100 + i),
    evidence: Array.from({ length: 12 }, (_, j) => ({ ...original.evidence[j % 2], title: `needle-${i + 1}-${j + 1}` })) }));
  const h = harness(c); h.mount(); for (let i = 0; i < 4; i++) click(h, "Add indicator entry");
  const selectors = () => h.nodes().filter(n => n.props.multiple && n.props.name?.endsWith("References"));
  assert.equal(selectors().length, 52); assert.equal(selectors().reduce((sum, n) => sum + optionKeys(n).length, 0), 18_720);
  query(h, "needle-30-12"); assert.match(html(h), /1 of 360 recorded reference choices match/);
  assert.ok(selectors().every(n => optionKeys(n).length === 1));
  const { root, nodes } = attachActualControls(h); assert.ok(nodes.length <= 128); assert.ok(!nodes.some(n => n.props.type === "search"));
  assert.equal(policyEventControlEntries(root.props.ref.current, () => true).filter(([name]) => name.endsWith("References")).length, 0);
  h.unmount();
});

test("source-stated missingness stays distinct from a numeric observation through filtered references and exact reopening", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); const draft = emptyIndicatorDraft(c), entry = indicatorEntry(c);
  entry.fields.value = null; entry.fields.missingReason = { value: "withheld", references: [{ claimId: c.claims[0].id, referenceNumber: 2 }] };
  draft.entries.push(entry); const saved = indicatorDraftJson(draft, c);
  suffix(h, "-paste").props.onChange({ currentTarget: { value: saved } }); click(h, "Reopen indicator preparation");
  query(h, "supports"); assert.deepEqual(named(h, "1.missingReasonReferences").props.value, [`${c.claims[0].id}:2`]);
  assert.deepEqual(named(h, "1.valueReferences").props.value, []); assert.match(html(h), /Selected outside this filter/);
  inspect(h); assert.equal(output(h), saved); assert.equal(JSON.parse(output(h)).entries[0].fields.value, null); h.unmount();
});
