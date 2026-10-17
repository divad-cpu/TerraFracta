import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { policyEventContext, policyEventReport, policyEventFormEntries, policyEventEntry, emptyPolicyEventDraft, fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { proposalId, proposalScope, proposalReport } from "./helpers/proposal_fixture.mjs";
import { policyEventDraftJson } from "../src/policy-event-draft.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/policy-event-draft-view.tsx", import.meta.url), name: "PolicyEventDraftView" });
const button = (h, label) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const controls = h => h.nodes().find(node => node.type === "fieldset" && node.props["aria-label"] === "Unsent event controls") ?? assert.fail("No event controls");
const inspect = h => button(h, "Inspect unsent event draft").props.onClick;
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const paste = h => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-paste"));
const changePaste = (h, value) => paste(h).props.onChange({ currentTarget: { value } });
const nativeSeams = t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));
};
const submit = (h, values) => { controls(h).props.ref.current = fakePolicyEventControls(values); inspect(h)(); };

test("the server-rendered event controls start disabled and retain the existing form-free boundary", t => {
  nativeSeams(t); const h = harness(policyEventContext()), first = elements(h.render());
  assert.ok(first.filter(node => ["button", "select", "textarea"].includes(node.type)).every(node => node.props.disabled));
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<form|type="submit"/);
  h.mount(); submit(h, []); assert.deepEqual(JSON.parse(output(h)).entries, []);
  assert.match(renderToStaticMarkup(h.render()), /No entries or unknown values do not establish absence of action/); h.unmount();
});
test("policy event precision is entered explicitly and original conflicting reference labels remain visible", t => {
  nativeSeams(t); const c = policyEventContext(), h = harness(c); h.mount(); click(h, "Add event entry");
  submit(h, policyEventFormEntries(c)); const value = JSON.parse(output(h));
  assert.equal(value.entries[0].fields.eventDate.date.value, "2030"); assert.equal(value.entries[0].fields.reportedDate, null);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /2030 \(year only\)/); assert.doesNotMatch(html, /2030-01-01/);
  assert.match(html, /original role: contradicts/); assert.match(html, /does not establish support for the new event wording/);
  assert.ok(html.includes(`href="#proposal-proposed-reference-${c.claims[0].id}-2"`)); h.unmount();
});
test("incomplete form or guessed precision holds and withholds any previous preview", t => {
  nativeSeams(t); const c = policyEventContext(), h = harness(c); h.mount(); click(h, "Add event entry");
  submit(h, policyEventFormEntries(c)); assert.ok(output(h));
  controls(h).props.onChange(); assert.equal(output(h), undefined);
  submit(h, policyEventFormEntries(c).map(([key, value]) => [key, key === "1.eventPrecision" ? "day" : value]));
  assert.equal(output(h), undefined); assert.match(renderToStaticMarkup(h.render()), /Event preparation held/); h.unmount();
});
test("input changes remove the preview eagerly even while a state merge is pending", t => {
  nativeSeams(t); const c = policyEventContext(), h = harness(c); h.mount(); click(h, "Add event entry");
  submit(h, policyEventFormEntries(c)); assert.ok(output(h)); const oldInspect = inspect(h);
  h.pauseMerges(); controls(h).props.onChange(); assert.equal(output(h), undefined);
  oldInspect(new Proxy({}, { get() { assert.fail("Stale inspection observed event"); } }));
  h.flushMerges(); assert.equal(output(h), undefined); h.unmount();
});
test("clear remove and replaced capture retire stale inspection before any form event observation", t => {
  nativeSeams(t);
  for (const action of ["clear", "remove", "context", "unmount"]) {
    const c = policyEventContext(), h = harness(c); h.mount(); click(h, "Add event entry");
    const oldInspect = inspect(h);
    if (action === "clear") click(h, "Clear event draft");
    if (action === "remove") click(h, "Remove event entry 1");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(90); h.render(next); }
    if (action === "unmount") h.unmount();
    oldInspect(new Proxy({}, { get() { assert.fail("Retired event inspection observed event"); } }));
    assert.equal(output(h), undefined); h.unmount();
  }
});
test("control collection reentry cannot expose a retired preparation or observe further values", t => {
  nativeSeams(t); const c = policyEventContext(), h = harness(c); h.mount(); click(h, "Add event entry");
  const next = structuredClone(c); next.binding.captureId = proposalId(91); let observed = 0;
  controls(h).props.ref.current = { get elements() { h.render(next); return { get length() { observed++; throw Error("PRIVATE"); } }; } };
  inspect(h)();
  assert.equal(observed, 0); assert.equal(output(h), undefined); h.commit();
  click(h, "Add event entry");
  controls(h).props.ref.current = { elements: { length: 1, item: () => ({ getAttribute() { h.render(c); return "2.claim"; }, get tagName() { observed++; throw Error("PRIVATE"); } }) } };
  inspect(h)(); assert.equal(observed, 0);
  assert.equal(output(h), undefined); h.unmount();
});
test("exact saved preparation reopens with fresh form keys while altered paste or capture remains held", t => {
  nativeSeams(t); const c = policyEventContext(), draft = emptyPolicyEventDraft(c); draft.entries.push(policyEventEntry(c));
  const json = policyEventDraftJson(draft, c), h = harness(c); h.mount();
  changePaste(h, json); click(h, "Reopen event preparation"); assert.equal(output(h), json);
  const controls = h.nodes(); assert.equal(controls.find(node => node.props.name?.endsWith(".eventPrecision")).props.defaultValue, "year");
  assert.equal(controls.find(node => node.props.name?.endsWith(".reportedPrecision")).props.defaultValue, "day");
  const oldReopen = button(h, "Reopen event preparation").props.onClick;
  changePaste(h, json + "\n"); oldReopen(); assert.equal(output(h), undefined); click(h, "Reopen event preparation"); assert.equal(output(h), undefined);
  h.unmount();
});
test("a reentrant older paste cannot replace a newer paste and clearing retires its input intent", t => {
  nativeSeams(t); const h = harness(policyEventContext()); h.mount();
  const change = paste(h).props.onChange;
  change({ get currentTarget() { change({ currentTarget: { value: "NEWEST" } }); return { value: "OLDER" }; } });
  assert.equal(paste(h).props.value, "NEWEST");
  click(h, "Clear event draft"); change(new Proxy({}, { get() { assert.fail("Retired paste observed event"); } }));
  assert.equal(paste(h).props.value, ""); h.unmount();
});
test("eight distinct event rows are bounded and duplicate entries are held instead of automatically merged", t => {
  nativeSeams(t); const c = policyEventContext(), h = harness(c); h.mount();
  for (let i = 0; i < 8; i++) click(h, "Add event entry"); assert.equal(button(h, "Add event entry").props.disabled, true);
  click(h, "Add event entry"); assert.equal(h.nodes().filter(node => node.type === "fieldset" && !node.props.ref).length, 8);
  submit(h, Array.from({ length: 8 }, (_, i) => policyEventFormEntries(c, i + 1)).flat()); assert.equal(output(h), undefined); h.unmount();
});
test("actual captured comparison exposes one accessible worksheet target and withheld comparisons disclose none", () => {
  const View = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)).ProposalComparisonView;
  const html = renderToStaticMarkup(View({ decision: { kind: "ok", report: policyEventReport() }, selection: proposalScope() }));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter(id => id === "proposal-policy-event-preparation").length, 1);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(value => value === id).length, 1, id);
  assert.match(html, /Prepare unsent policy-event details/); assert.doesNotMatch(html, /href="https:|type="file"[^>]*policy-event/);
  const held = renderToStaticMarkup(View({ decision: { kind: "unavailable" }, selection: proposalScope() }));
  assert.doesNotMatch(held, /proposal-policy-event-preparation|Prepare unsent policy-event/);
  const noAction = renderToStaticMarkup(View({ decision: { kind: "ok", report: proposalReport() }, selection: proposalScope() }));
  assert.match(noAction, /No proposed policy-or-action statement is available/);
});
