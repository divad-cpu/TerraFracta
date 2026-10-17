import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { policyEventContext, policyEventFormEntries, fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { deliveryContext, deliveryFormEntries } from "./helpers/delivery_draft_fixture.mjs";
import { proposalId } from "./helpers/proposal_fixture.mjs";
const configs = [{ label: "event", heading: "Event", file: "policy-event", component: "PolicyEventDraftView", context: policyEventContext, entries: policyEventFormEntries },
  { label: "delivery", heading: "Delivery", file: "delivery", component: "DeliveryDraftView", context: deliveryContext, entries: deliveryFormEntries }];
const button = (h, label) => h.nodes().find(n => n.type === "button" && [n.props.children].flat().join("") === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const named = (h, name) => h.nodes().find(n => n.props.name === name) ?? assert.fail(name);
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const html = h => renderToStaticMarkup(h.render());
const edit = (pairs, key, value) => pairs.map(([name, old]) => [name, name === key ? value : old]);
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));
function links(h, heading) {
  const body = html(h), ids = [...body.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const node of h.nodes().filter(n => n.props["aria-invalid"])) for (const id of node.props["aria-describedby"].split(" ")) assert.ok(ids.includes(id));
  const list = new RegExp(`<ul aria-label="${heading} date corrections">[\\s\\S]*?<\\/ul>`).exec(body)?.[0]; assert.ok(list);
  for (const [, target] of list.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(target));
}
for (const cfg of configs) {
  const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL(`../src/${cfg.file}-draft-view.tsx`, import.meta.url), name: cfg.component });
  function setup() { const c = cfg.context(), h = harness(c); h.mount(); click(h, `Add ${cfg.label} entry`); return { h, c }; }
  function inspect(h, pairs) {
    for (const node of h.nodes().filter(n => n.props.multiple && n.props.name)) {
      const chosen = pairs.filter(([name]) => name === node.props.name).map(([_name, value]) => value);
      node.props.onChange({ currentTarget: { selectedOptions: { length: chosen.length, item: index => chosen[index] === undefined ? null : { value: chosen[index] } } } });
    }
    h.nodes().find(n => n.props["aria-label"] === `Unsent ${cfg.label} controls`).props.ref.current = fakePolicyEventControls(pairs);
    click(h, `Inspect unsent ${cfg.label} draft`);
  }
  test(`${cfg.label}: explicit malformed-date inspection links precision value and independent missing-reference errors`, t => {
    noNetwork(t); const { h, c } = setup(); assert.ok(h.nodes().filter(n => n.props.name).every(n => n.props["aria-invalid"] === undefined));
    let pairs = edit(edit(cfg.entries(c), "1.eventPrecision", "month"), "1.eventValue", "2030-13"); pairs = pairs.filter(([name]) => name !== "1.eventDateReferences");
    inspect(h, pairs); assert.equal(output(h), undefined); assert.equal(named(h, "1.eventValue").props["aria-invalid"], true);
    assert.equal(named(h, "1.eventDateReferences").props["aria-invalid"], true); assert.equal(named(h, "1.eventPrecision").props["aria-invalid"], undefined); links(h, cfg.heading);
    inspect(h, edit(cfg.entries(c), "1.eventPrecision", "")); assert.equal(named(h, "1.eventPrecision").props["aria-invalid"], true); links(h, cfg.heading); h.unmount();
  });
  test(`${cfg.label}: unknown dates remain null and unrelated field refusal produces no date corrections`, t => {
    noNetwork(t); const { h, c } = setup(); let pairs = edit(edit(cfg.entries(c), "1.eventPrecision", ""), "1.eventValue", "").filter(([name]) => name !== "1.eventDateReferences");
    inspect(h, pairs); assert.equal(JSON.parse(output(h)).entries[0].fields.eventDate, null); assert.doesNotMatch(html(h), /date corrections/);
    pairs = edit(cfg.entries(c), cfg.label === "event" ? "1.kind" : "1.stage", "PRIVATE_INVALID_STAGE"); inspect(h, pairs);
    assert.equal(output(h), undefined); assert.doesNotMatch(html(h), /date corrections|PRIVATE_INVALID_STAGE/); h.unmount();
  });
  test(`${cfg.label}: source stated periods and independent reported dates retain exact precision without date repair`, t => {
    noNetwork(t); const { h, c } = setup(); const pairs = edit(edit(cfg.entries(c), "1.eventPrecision", "period"), "1.eventValue", "source interval 2030/31"); inspect(h, pairs);
    const entry = JSON.parse(output(h)).entries[0]; assert.deepEqual(entry.fields.eventDate.date, { precision: "period", label: "source interval 2030/31" });
    assert.equal(entry.fields.reportedDate, null); assert.doesNotMatch(html(h), /date corrections/); h.unmount();
  });
  test(`${cfg.label}: pending edits Clear context change and unmount withhold old date hints and deny the old inspector`, t => {
    noNetwork(t);
    for (const action of ["edit", "clear", "context", "unmount"]) {
      const { h, c } = setup(); inspect(h, edit(cfg.entries(c), "1.eventValue", "PRIVATE_INVALID_DATE")); assert.equal(named(h, "1.eventValue").props["aria-invalid"], true);
      const old = button(h, `Inspect unsent ${cfg.label} draft`).props.onClick;
      if (action === "edit") { h.pauseMerges(); h.nodes().find(n => n.props["aria-label"] === `Unsent ${cfg.label} controls`).props.onChange(); }
      if (action === "clear") click(h, `Clear ${cfg.label} draft`);
      if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(923); h.render(next); }
      if (action === "unmount") h.unmount(); old(); assert.doesNotMatch(html(h), /date corrections|PRIVATE_INVALID_DATE/);
      assert.ok(h.nodes().filter(n => n.props.name).every(n => n.props["aria-invalid"] === undefined)); if (action === "edit") h.flushMerges(); h.unmount();
    }
  });
  test(`${cfg.label}: control faults remain generic and fresh Clear during collection cannot publish later date hints`, t => {
    noNetwork(t); const { h } = setup(), root = () => h.nodes().find(n => n.props["aria-label"] === `Unsent ${cfg.label} controls`);
    root().props.ref.current = { get elements() { throw Error("PRIVATE_DATE_CONTROL_FAULT"); } }; click(h, `Inspect unsent ${cfg.label} draft`);
    assert.match(html(h), /preparation held/); assert.doesNotMatch(html(h), /PRIVATE_DATE_CONTROL_FAULT|date corrections/);
    root().props.ref.current = { get elements() { click(h, `Clear ${cfg.label} draft`); return { get length() { assert.fail("Retired collection length observed"); } }; } };
    click(h, `Inspect unsent ${cfg.label} draft`); assert.equal(output(h), undefined); assert.ok(!h.nodes().some(n => n.props.name?.endsWith(".claim"))); assert.doesNotMatch(html(h), /date corrections/); h.unmount();
  });
}
