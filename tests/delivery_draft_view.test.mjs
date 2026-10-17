import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { deliveryContext, deliveryReport, deliveryEntry, deliveryFormEntries, emptyDeliveryDraft } from "./helpers/delivery_draft_fixture.mjs";
import { deliveryDraftJson, deliveryStages } from "../src/delivery-draft.ts";
import { proposalId, proposalScope } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/delivery-draft-view.tsx", import.meta.url), name: "DeliveryDraftView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === text) ?? assert.fail(text);
const click = (h, text) => button(h, text).props.onClick();
const controls = h => h.nodes().find(node => node.props["aria-label"] === "Unsent delivery controls");
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const paste = h => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-paste"));
const changePaste = (h, value) => paste(h).props.onChange({ currentTarget: { value } });
const inspect = (h, values) => { controls(h).props.ref.current = fakePolicyEventControls(values); click(h, "Inspect unsent delivery draft"); };
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));

test("private delivery starts disabled and form-free with no inferred operating state or coverage", t => {
  noNetwork(t); const h = harness(deliveryContext());
  assert.ok(h.nodes().filter(node => ["button", "input", "select", "textarea"].includes(node.type)).every(node => node.props.disabled));
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<form|type="submit"|href="https:/);
  h.mount(); inspect(h, []); assert.deepEqual(JSON.parse(output(h)).entries, []); h.unmount();
});
test("delivery preview distinguishes source-described stage coverage event date and reporting date with original reference roles", t => {
  noNetwork(t); const c = deliveryContext(), draft = emptyDeliveryDraft(c), entry = deliveryEntry(c);
  entry.fields.coverage = { wording: "Only two fictional districts", references: [{ claimId: c.claims[0].id, referenceNumber: 1 }] };
  draft.entries.push(entry); const h = harness(c); h.mount(); changePaste(h, deliveryDraftJson(draft, c)); click(h, "Reopen delivery preparation");
  const html = renderToStaticMarkup(h.render());
  for (const text of ["Partial delivery", "Only two fictional districts", "2030 (year only)", "2026-09-27 (exact day)", "original role: contradicts", "A completed label does not fill an unknown date"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes(`href="#proposal-proposed-reference-${c.claims[0].id}-2"`));
  assert.equal(h.nodes().find(node => node.props.name?.endsWith(".coverage")).props.defaultValue, "Only two fictional districts"); h.unmount();
});
test("all seven stages remain source-described choices and an unknown stage stays explicitly blank", t => {
  noNetwork(t); const c = deliveryContext(), h = harness(c); h.mount(); click(h, "Add delivery entry");
  const stage = h.nodes().find(node => node.props.name === "1.stage"); assert.equal(stage.props.defaultValue, "");
  const options = [stage.props.children].flat(Infinity).filter(Boolean).filter(node => node.type === "option");
  assert.deepEqual(options.map(node => node.props.value), ["", ...Object.keys(deliveryStages)]);
  const pairs = deliveryFormEntries(c); inspect(h, pairs); assert.equal(JSON.parse(output(h)).entries[0].fields.coverage, null);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /A policy announcement, adoption, budget or payment is not evidence/); h.unmount();
});
test("incomplete coverage references hold the prior preview without leaking invalid source wording", t => {
  noNetwork(t); const c = deliveryContext(), h = harness(c); h.mount(); click(h, "Add delivery entry"); inspect(h, deliveryFormEntries(c));
  const pairs = deliveryFormEntries(c).map(([key, value]) => [key, key === "1.coverage" ? "PRIVATE_COVERAGE_WITHOUT_REFERENCE" : value]);
  inspect(h, pairs); assert.equal(output(h), undefined); const html = renderToStaticMarkup(h.render());
  assert.match(html, /Delivery preparation held/); assert.doesNotMatch(html, /PRIVATE_COVERAGE_WITHOUT_REFERENCE/); h.unmount();
});
test("clear remove changed comparison and unmount retire inspectors before any old control access", t => {
  noNetwork(t);
  for (const action of ["clear", "remove", "context", "unmount"]) {
    const c = deliveryContext(), h = harness(c); h.mount(); click(h, "Add delivery entry");
    const old = button(h, "Inspect unsent delivery draft").props.onClick;
    controls(h).props.ref.current = new Proxy({}, { get() { assert.fail("Retired controls observed"); } });
    if (action === "clear") click(h, "Clear delivery draft"); if (action === "remove") click(h, "Remove delivery entry 1");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(96); h.render(next); }
    if (action === "unmount") h.unmount(); old(); assert.equal(output(h), undefined); h.unmount();
  }
});
test("eager source-control edits withhold a preview before deferred merges and later exact reopening restores all five fields", t => {
  noNetwork(t); const c = deliveryContext(), h = harness(c); h.mount(); click(h, "Add delivery entry"); inspect(h, deliveryFormEntries(c));
  h.pauseMerges(); controls(h).props.onChange(); assert.equal(output(h), undefined); h.flushMerges();
  const draft = emptyDeliveryDraft(c); draft.entries.push(deliveryEntry(c)); const json = deliveryDraftJson(draft, c);
  changePaste(h, json); click(h, "Reopen delivery preparation"); assert.equal(output(h), json);
  const old = button(h, "Reopen delivery preparation").props.onClick; changePaste(h, json + "\n"); old(); assert.equal(output(h), undefined); h.unmount();
});
test("reentrant native option and paste observations cannot overwrite a new capture or input intent", t => {
  noNetwork(t); const c = deliveryContext(), h = harness(c); h.mount(); click(h, "Add delivery entry"); let observed = 0;
  const next = structuredClone(c); next.binding.captureId = proposalId(97);
  const control = { getAttribute: () => "1.stageReferences", tagName: "SELECT", multiple: true,
    selectedOptions: { length: 1, item() { h.render(next); return { get value() { observed++; return "PRIVATE"; } }; } } };
  controls(h).props.ref.current = { elements: { length: 1, item: () => control } }; click(h, "Inspect unsent delivery draft");
  assert.equal(observed, 0); assert.equal(output(h), undefined); h.commit(); h.render(next);
  const change = paste(h).props.onChange;
  change({ get currentTarget() { change({ currentTarget: { value: "NEWER" } }); return { value: "OLDER" }; } });
  assert.equal(paste(h).props.value, "NEWER"); h.unmount();
});
test("eight sparse delivery entries fit the native control bound and cannot admit a ninth through a stale action", t => {
  noNetwork(t); const c = deliveryContext(), draft = emptyDeliveryDraft(c);
  draft.entries = Array.from({ length: 8 }, (_, i) => ({ claimId: c.claims[0].id, fields: { stage: null, description: null, coverage: null,
    eventDate: { date: { precision: "year", value: String(2000 + i) }, references: [{ claimId: c.claims[0].id, referenceNumber: 1 }] }, reportedDate: null } }));
  const h = harness(c); h.mount(); changePaste(h, deliveryDraftJson(draft, c)); click(h, "Reopen delivery preparation");
  assert.equal(button(h, "Add delivery entry").props.disabled, true); click(h, "Add delivery entry");
  assert.equal(h.nodes().filter(node => node.type === "fieldset" && !node.props.ref).length, 8);
  const nativeControls = h.nodes().filter(node => ["input", "select", "textarea"].includes(node.type) && node.props.name).map(node => {
    const value = node.props.multiple ? node.props.value : node.props.defaultValue;
    return {
    getAttribute: name => name === "name" ? node.props.name : null, tagName: node.type.toUpperCase(), type: "text", multiple: node.props.multiple,
    value, selectedOptions: { length: node.props.multiple ? value.length : 0,
      item: index => ({ value: value[index] }) },
  }; });
  assert.equal(nativeControls.length, 104); controls(h).props.ref.current = { elements: { length: nativeControls.length, item: index => nativeControls[index] } };
  click(h, "Inspect unsent delivery draft"); assert.equal(JSON.parse(output(h)).entries.length, 8);
  assert.deepEqual(JSON.parse(output(h)).entries.map(entry => entry.fields.eventDate.date.value), Array.from({ length: 8 }, (_, i) => String(2000 + i))); h.unmount();
});
test("private delivery scope text is escaped and never interpreted as source-driven markup", t => {
  noNetwork(t); const c = deliveryContext(), draft = emptyDeliveryDraft(c), entry = deliveryEntry(c);
  entry.fields.coverage = { wording: '<script>PRIVATE</script>', references: [{ claimId: c.claims[0].id, referenceNumber: 1 }] }; draft.entries.push(entry);
  const h = harness(c); h.mount(); changePaste(h, deliveryDraftJson(draft, c)); click(h, "Reopen delivery preparation");
  const html = renderToStaticMarkup(h.render()); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;PRIVATE/); h.unmount();
});

test("delivery worksheet is available only inside the checked captured proposal and preserves the other sections", () => {
  const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)), report = deliveryReport();
  const html = renderToStaticMarkup(ProposalComparisonView({ decision: { kind: "ok", report }, selection: proposalScope() }));
  for (const id of ["delivery-preparation", "indicator-preparation", "funding-preparation", "policy-event-preparation", "base-snapshot", "proposed-snapshot"])
    assert.ok(html.includes(`id="proposal-${id}"`), id);
  assert.match(html, /href="#proposal-delivery-preparation"/);
  for (const kind of ["unavailable", "invalid_scope", "capture_missing"]) {
    const held = renderToStaticMarkup(ProposalComparisonView({ decision: { kind, report }, selection: proposalScope() }));
    assert.doesNotMatch(held, /proposal-delivery-preparation|Unsent delivery controls/);
  }
});
