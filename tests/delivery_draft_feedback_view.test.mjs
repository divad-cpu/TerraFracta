import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { deliveryContext, deliveryFormEntries } from "./helpers/delivery_draft_fixture.mjs";

const harness = context => responsibilityDraftHarness(context, undefined, {
  url: new URL("../src/delivery-draft-view.tsx", import.meta.url), name: "DeliveryDraftView",
});
const button = (h, text) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === text) ?? assert.fail(text);
const named = (h, name) => h.nodes().find(node => node.props.name === name) ?? assert.fail(name);
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const body = h => renderToStaticMarkup(h.render());
function setup() {
  const context = deliveryContext(), h = harness(context); h.mount(); button(h, "Add delivery entry").props.onClick();
  return { context, h };
}
function inspect(h, pairs) {
  for (const node of h.nodes().filter(node => node.props.multiple && node.props.name)) {
    const chosen = pairs.filter(([name]) => name === node.props.name).map(([, value]) => value);
    node.props.onChange({ currentTarget: { selectedOptions: { length: chosen.length,
      item: index => chosen[index] === undefined ? null : { value: chosen[index] } } } });
  }
  h.nodes().find(node => node.props["aria-label"] === "Unsent delivery controls").props.ref.current = fakePolicyEventControls(pairs);
  button(h, "Inspect unsent delivery draft").props.onClick();
}
const edit = (pairs, key, value) => pairs.map(([name, old]) => [name, name === key ? value : old]);
function linkedCorrections(h) {
  const html = body(h), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const control of h.nodes().filter(node => node.props["aria-invalid"])) {
    for (const id of control.props["aria-describedby"].split(" ")) assert.ok(ids.includes(id), id);
  }
  const list = /<ul aria-label="Delivery field corrections">[\s\S]*?<\/ul>/.exec(html)?.[0]; assert.ok(list);
  for (const [, id] of list.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
}
test("supplied delivery stage and coverage without references identify their exact correction controls", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source or network request permitted"));
  const { context, h } = setup();
  const pairs = deliveryFormEntries(context).filter(([name]) => name !== "1.stageReferences")
    .map(([name, value]) => [name, name === "1.coverage" ? "An invented local service area" : value]);
  inspect(h, pairs); assert.equal(output(h), undefined);
  for (const field of ["stage", "coverage"]) {
    const control = named(h, `1.${field}References`);
    assert.equal(control.props["aria-invalid"], true, `Missing ${field} references need a field-level correction`);
    assert.match(body(h), new RegExp(`href="#${control.props.id}"`));
  }
  assert.match(body(h), /Delivery field corrections/); h.unmount();
});
test("delivery statement stage and wording corrections have distinct fixed labels and valid targets", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const { context, h } = setup(); let pairs = deliveryFormEntries(context);
  pairs = edit(edit(edit(edit(pairs, "1.claim", "PRIVATE_CLAIM"), "1.stage", "PRIVATE_STAGE"), "1.description", " "), "1.coverage", "x".repeat(1201));
  inspect(h, pairs); assert.equal(output(h), undefined);
  for (const field of ["claim", "stage", "description", "coverage"]) assert.equal(named(h, `1.${field}`).props["aria-invalid"], true);
  linkedCorrections(h); assert.doesNotMatch(body(h), /PRIVATE_CLAIM|PRIVATE_STAGE/);
  assert.match(body(h), /Other statement types are not converted/); assert.match(body(h), /Local coverage is not treated as national/); h.unmount();
});
test("unknowns remain null and corrected exact references restore the original preparation without hints", () => {
  const { context, h } = setup(), ref = `${context.claims[0].id}:1`;
  const invalid = edit(deliveryFormEntries(context), "1.coverage", "Invented local coverage"); inspect(h, invalid);
  assert.equal(named(h, "1.coverageReferences").props["aria-invalid"], true);
  inspect(h, [...invalid, ["1.coverageReferences", ref]]);
  const accepted = JSON.parse(output(h)); assert.equal(accepted.entries[0].fields.coverage.wording, "Invented local coverage");
  assert.equal(accepted.entries[0].fields.description, null); assert.equal(accepted.entries[0].fields.reportedDate, null);
  assert.doesNotMatch(body(h), /field corrections|date corrections/);
  const unknown = edit(deliveryFormEntries(context).filter(([name]) => name !== "1.stageReferences"), "1.stage", ""); inspect(h, unknown);
  assert.equal(JSON.parse(output(h)).entries[0].fields.stage, null); assert.doesNotMatch(body(h), /field corrections/); h.unmount();
});
test("date precision failures and missing coverage references remain independently linked", () => {
  const { context, h } = setup(); const pairs = edit(edit(deliveryFormEntries(context), "1.eventValue", "PRIVATE_DATE"), "1.coverage", "Local scope");
  inspect(h, pairs); assert.equal(output(h), undefined);
  assert.equal(named(h, "1.eventValue").props["aria-invalid"], true); assert.equal(named(h, "1.coverageReferences").props["aria-invalid"], true);
  assert.match(body(h), /Delivery date corrections/); linkedCorrections(h); assert.doesNotMatch(body(h), /PRIVATE_DATE/); h.unmount();
});
test("editing Clear context replacement and unmount retire old delivery correction hints and callbacks", () => {
  for (const action of ["edit", "clear", "context", "unmount"]) {
    const { context, h } = setup(); inspect(h, edit(deliveryFormEntries(context), "1.coverage", "Local scope"));
    assert.equal(named(h, "1.coverageReferences").props["aria-invalid"], true);
    const old = button(h, "Inspect unsent delivery draft").props.onClick;
    if (action === "edit") { h.pauseMerges(); h.nodes().find(node => node.props["aria-label"] === "Unsent delivery controls").props.onChange(); }
    if (action === "clear") button(h, "Clear delivery draft").props.onClick();
    if (action === "context") { const next = structuredClone(context); next.binding.captureId = "87000000-0000-4000-8000-000000000999"; h.render(next); }
    if (action === "unmount") h.unmount(); old();
    assert.doesNotMatch(body(h), /Delivery field corrections/); assert.ok(h.nodes().filter(node => node.props.name).every(node => node.props["aria-invalid"] === undefined));
    if (action === "edit") h.flushMerges(); h.unmount();
  }
});
test("row removal keeps stable correction targets while renumbering the remaining delivery entry", () => {
  const { context, h } = setup(); button(h, "Add delivery entry").props.onClick(); button(h, "Remove delivery entry 1").props.onClick();
  const pairs = edit(deliveryFormEntries(context, 2), "2.coverage", "Local scope"); inspect(h, pairs);
  assert.equal(named(h, "2.coverageReferences").props["aria-invalid"], true); linkedCorrections(h);
  assert.match(body(h), /Entry 1: correct references for Documented delivery coverage/); assert.doesNotMatch(body(h), /Entry 2: correct/); h.unmount();
});
test("native faults remain generic and explicit inspection reads the native collection only once", () => {
  const { context, h } = setup(), pairs = edit(deliveryFormEntries(context), "1.coverage", "Local scope");
  const native = fakePolicyEventControls(pairs); let reads = 0;
  h.nodes().find(node => node.props["aria-label"] === "Unsent delivery controls").props.ref.current = { get elements() { reads++; return native.elements; } };
  button(h, "Inspect unsent delivery draft").props.onClick(); assert.equal(reads, 1); linkedCorrections(h);
  h.nodes().find(node => node.props["aria-label"] === "Unsent delivery controls").props.ref.current = { get elements() { throw Error("PRIVATE_CONTROL_FAULT"); } };
  button(h, "Inspect unsent delivery draft").props.onClick(); assert.match(body(h), /Delivery preparation held/); assert.doesNotMatch(body(h), /PRIVATE_CONTROL_FAULT|field corrections/); h.unmount();
});
test("wording controls keep source input intact rather than imposing a new raw text truncation limit", () => {
  const { context, h } = setup(); assert.equal(named(h, "1.description").props.maxLength, undefined); assert.equal(named(h, "1.coverage").props.maxLength, undefined);
  const pairs = [...edit(deliveryFormEntries(context), "1.coverage", "  " + "x".repeat(1200) + "  "), ["1.coverageReferences", `${context.claims[0].id}:1`]];
  inspect(h, pairs); assert.equal(JSON.parse(output(h)).entries[0].fields.coverage.wording.length, 1200);
  assert.doesNotMatch(body(h), /Delivery field corrections/); h.unmount();
});
