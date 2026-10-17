import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { fakePolicyEventControls, policyEventContext, policyEventFormEntries } from "./helpers/policy_event_fixture.mjs";
const harness = context => responsibilityDraftHarness(context, undefined, {
  url: new URL("../src/policy-event-draft-view.tsx", import.meta.url), name: "PolicyEventDraftView",
});
const button = (h, text) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === text) ?? assert.fail(text);
const named = (h, name) => h.nodes().find(node => node.props.name === name) ?? assert.fail(name);
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const body = h => renderToStaticMarkup(h.render());
const edit = (pairs, key, value) => pairs.map(([name, old]) => [name, name === key ? value : old]);
function setup() { const context = policyEventContext(), h = harness(context); h.mount(); button(h, "Add event entry").props.onClick(); return { context, h }; }
function inspect(h, pairs) {
  for (const node of h.nodes().filter(node => node.props.multiple && node.props.name)) {
    const values = pairs.filter(([name]) => name === node.props.name).map(([, value]) => value);
    node.props.onChange({ currentTarget: { selectedOptions: { length: values.length, item: index => values[index] === undefined ? null : { value: values[index] } } } });
  }
  h.nodes().find(node => node.props["aria-label"] === "Unsent event controls").props.ref.current = fakePolicyEventControls(pairs);
  button(h, "Inspect unsent event draft").props.onClick();
}
function links(h) {
  const html = body(h), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const node of h.nodes().filter(node => node.props["aria-invalid"])) for (const id of node.props["aria-describedby"].split(" ")) assert.ok(ids.includes(id));
  const list = /<ul aria-label="Event field corrections">[\s\S]*?<\/ul>/.exec(html)?.[0]; assert.ok(list);
  for (const [, target] of list.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(target));
}
test("event kind and description without references identify their exact correction controls", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const { context, h } = setup(), pairs = edit(policyEventFormEntries(context).filter(([name]) => name !== "1.kindReferences"), "1.description", "An invented source-described event");
  inspect(h, pairs); assert.equal(output(h), undefined);
  for (const field of ["kind", "description"]) {
    const control = named(h, `1.${field}References`); assert.equal(control.props["aria-invalid"], true, `Missing ${field} references need a field-level correction`);
    assert.match(body(h), new RegExp(`href="#${control.props.id}"`));
  }
  assert.match(body(h), /Event field corrections/); h.unmount();
});
test("event statement type and wording errors use fixed independently linked correction targets", () => {
  const { context, h } = setup(); let pairs = policyEventFormEntries(context);
  pairs = edit(edit(edit(pairs, "1.claim", "PRIVATE_CLAIM"), "1.kind", "PRIVATE_KIND"), "1.description", "x".repeat(1201)); inspect(h, pairs);
  assert.equal(output(h), undefined); for (const field of ["claim", "kind", "description"]) assert.equal(named(h, `1.${field}`).props["aria-invalid"], true);
  links(h); assert.doesNotMatch(body(h), /PRIVATE_CLAIM|PRIVATE_KIND/); assert.match(body(h), /not inferred from one another/); h.unmount();
});
test("event correction and unknown fields retain exact existing JSON rules", () => {
  const { context, h } = setup(), ref = `${context.claims[0].id}:1`;
  const pairs = edit(policyEventFormEntries(context), "1.description", "Invented event wording"); inspect(h, pairs); links(h);
  inspect(h, [...pairs, ["1.descriptionReferences", ref]]); assert.equal(JSON.parse(output(h)).entries[0].fields.description.wording, "Invented event wording");
  assert.doesNotMatch(body(h), /field corrections|date corrections/);
  inspect(h, edit(policyEventFormEntries(context).filter(([name]) => name !== "1.kindReferences"), "1.kind", ""));
  assert.equal(JSON.parse(output(h)).entries[0].fields.kind, null); assert.doesNotMatch(body(h), /field corrections/); h.unmount();
});
test("event type references and malformed date values remain independent corrections", () => {
  const { context, h } = setup(), pairs = edit(policyEventFormEntries(context).filter(([name]) => name !== "1.kindReferences"), "1.eventValue", "PRIVATE_DATE");
  inspect(h, pairs); assert.equal(output(h), undefined); assert.equal(named(h, "1.kindReferences").props["aria-invalid"], true);
  assert.equal(named(h, "1.eventValue").props["aria-invalid"], true); links(h); assert.match(body(h), /Event date corrections/); h.unmount();
});
test("event hint ownership retires on pending edits Clear context replacement unmount and row removal", () => {
  for (const action of ["edit", "clear", "context", "unmount", "remove"]) {
    const { context, h } = setup(); inspect(h, policyEventFormEntries(context).filter(([name]) => name !== "1.kindReferences")); links(h);
    const old = button(h, "Inspect unsent event draft").props.onClick;
    if (action === "edit") { h.pauseMerges(); h.nodes().find(node => node.props["aria-label"] === "Unsent event controls").props.onChange(); }
    if (action === "clear") button(h, "Clear event draft").props.onClick();
    if (action === "remove") button(h, "Remove event entry 1").props.onClick();
    if (action === "context") { const next = structuredClone(context); next.binding.captureId = "87000000-0000-4000-8000-000000000998"; h.render(next); }
    if (action === "unmount") h.unmount(); old(); assert.doesNotMatch(body(h), /Event field corrections/);
    assert.ok(h.nodes().filter(node => node.props.name).every(node => node.props["aria-invalid"] === undefined)); if (action === "edit") h.flushMerges(); h.unmount();
  }
});
test("event inspection uses one native collection and faults withdraw earlier hints", () => {
  const { context, h } = setup(), pairs = policyEventFormEntries(context).filter(([name]) => name !== "1.kindReferences"), native = fakePolicyEventControls(pairs); let reads = 0;
  const root = () => h.nodes().find(node => node.props["aria-label"] === "Unsent event controls");
  root().props.ref.current = { get elements() { reads++; return native.elements; } }; button(h, "Inspect unsent event draft").props.onClick(); assert.equal(reads, 1); links(h);
  root().props.ref.current = { get elements() { throw Error("PRIVATE_EVENT_FAULT"); } }; button(h, "Inspect unsent event draft").props.onClick();
  assert.equal(output(h), undefined); assert.doesNotMatch(body(h), /PRIVATE_EVENT_FAULT|field corrections/); assert.match(body(h), /Event preparation held/); h.unmount();
});
test("event wording is not truncated by a new raw cap and retained row IDs link displayed entry one", () => {
  const { context, h } = setup(); button(h, "Add event entry").props.onClick(); button(h, "Remove event entry 1").props.onClick();
  assert.equal(named(h, "2.description").props.maxLength, undefined);
  const pairs = edit(policyEventFormEntries(context, 2), "2.description", "  " + "😀".repeat(1200) + "  "); inspect(h, pairs); links(h);
  assert.match(body(h), /Entry 1: correct references for Event description/); assert.doesNotMatch(body(h), /Entry 2: correct/);
  inspect(h, [...pairs, ["2.descriptionReferences", `${context.claims[0].id}:1`]]); assert.equal(Array.from(JSON.parse(output(h)).entries[0].fields.description.wording).length, 1200); h.unmount();
});
