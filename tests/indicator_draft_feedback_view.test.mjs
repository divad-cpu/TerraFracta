import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { fakePolicyEventControls } from "./helpers/policy_event_fixture.mjs";
import { indicatorContext, indicatorEntry, indicatorFormEntries } from "./helpers/indicator_draft_fixture.mjs";
import { proposalId } from "./helpers/proposal_fixture.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/indicator-draft-view.tsx", import.meta.url), name: "IndicatorDraftView" });
const button = (h, label) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const controls = h => h.nodes().find(node => node.props["aria-label"] === "Unsent indicator controls");
const field = (h, name) => h.nodes().find(node => node.props.name === name) ?? assert.fail(name);
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const inspect = (h, pairs) => { controls(h).props.ref.current = fakePolicyEventControls(pairs); click(h, "Inspect unsent indicator draft"); };
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));
function linkedErrors(h) {
  const html = renderToStaticMarkup(h.render()), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const node of h.nodes().filter(node => node.props["aria-invalid"])) {
    assert.ok(node.props["aria-describedby"]); for (const id of node.props["aria-describedby"].split(" ")) assert.ok(ids.includes(id), id);
  }
  const list = /<ul aria-label="Indicator corrections">[\s\S]*?<\/ul>/.exec(html)?.[0];
  assert.ok(list); for (const [, id] of list.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
}
test("field correction hints appear only after explicit inspection and link to both invalid value and reference controls", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
  assert.ok(h.nodes().filter(node => node.props.name).every(node => node.props["aria-invalid"] === undefined));
  const pairs = indicatorFormEntries(c).filter(([key]) => key !== "1.valueReferences").map(([key, value]) => [key, key === "1.value" ? "PRIVATE_INVALID_NUMBER" : value]);
  inspect(h, pairs); assert.equal(output(h), undefined); assert.equal(field(h, "1.value").props["aria-invalid"], true);
  assert.equal(field(h, "1.valueReferences").props["aria-invalid"], true); assert.equal(field(h, "1.unit").props["aria-invalid"], undefined);
  linkedErrors(h); assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_INVALID_NUMBER/); h.unmount();
});
test("clearing a field while its references remain selected points to its value rather than silently deleting references", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
  const pairs = indicatorFormEntries(c).map(([key, value]) => [key, key === "1.unit" ? "" : value]); inspect(h, pairs);
  assert.equal(field(h, "1.unit").props["aria-invalid"], true); assert.equal(field(h, "1.unitReferences").props["aria-invalid"], undefined);
  assert.match(renderToStaticMarkup(h.render()), /clear both the value and references to leave it unknown/); linkedErrors(h); h.unmount();
});
test("simultaneous numeric and missing observations produce fixed linked correction guidance for both controls", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
  const pairs = indicatorFormEntries(c).map(([key, value]) => [key, key === "1.missingReason" ? "withheld" : value]); pairs.push(["1.missingReasonReferences", `${c.claims[0].id}:1`]);
  inspect(h, pairs); assert.equal(field(h, "1.value").props["aria-invalid"], true); assert.equal(field(h, "1.missingReason").props["aria-invalid"], true);
  assert.match(renderToStaticMarkup(h.render()), /Supply an observation or one source-stated missing reason, never both/); linkedErrors(h); h.unmount();
});
test("unselected statement and exact duplicate entry have distinct reachable correction targets", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
  inspect(h, indicatorFormEntries(c).map(([key, value]) => [key, key === "1.claim" ? "" : value]));
  assert.equal(field(h, "1.claim").props["aria-invalid"], true); linkedErrors(h);
  click(h, "Add indicator entry"); inspect(h, [...indicatorFormEntries(c), ...indicatorFormEntries(c, 2)]);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /exactly repeats an earlier entry/); assert.match(html, /correct or remove the repeated entry/);
  linkedErrors(h); assert.equal(output(h), undefined); h.unmount();
});
test("complete encoded size is reported separately from valid fields without wrongly marking their controls", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); for (let i = 0; i < 3; i++) click(h, "Add indicator entry");
  const entries = Array.from({ length: 3 }, (_, i) => {
    const entry = indicatorEntry(c, String(i)); entry.fields.definition.value = "😀".repeat(600);
    for (const field of Object.values(entry.fields)) if (field) field.references = [1, 2].map(referenceNumber => ({ claimId: c.claims[0].id, referenceNumber })); return entry;
  });
  const pairs = entries.flatMap((entry, i) => [[`${i + 1}.claim`, entry.claimId], ...Object.entries(entry.fields).flatMap(([name, value]) => [
    [`${i + 1}.${name}`, value?.value ?? ""], ...(value?.references.map(ref => [`${i + 1}.${name}References`, `${ref.claimId}:${ref.referenceNumber}`]) ?? []),
  ])]);
  inspect(h, pairs); assert.equal(output(h), undefined); assert.match(renderToStaticMarkup(h.render()), /complete copied preparation exceeds 16 KiB/);
  assert.ok(h.nodes().filter(node => node.props.name).every(node => node.props["aria-invalid"] === undefined));
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /aria-label="Indicator corrections"/); h.unmount();
});
test("oversized bounded input has its own fixed notice and unclassifiable getter faults retain generic held guidance", t => {
  noNetwork(t); const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
  inspect(h, [["1.claim", "x".repeat(16_385)]]); assert.match(renderToStaticMarkup(h.render()), /bounded worksheet input exceeds 16 KiB/);
  controls(h).props.ref.current = { get elements() { throw Error("PRIVATE_CONTROL_FAULT"); } }; click(h, "Inspect unsent indicator draft");
  const html = renderToStaticMarkup(h.render()); assert.match(html, /Indicator preparation held/); assert.doesNotMatch(html, /PRIVATE_CONTROL_FAULT|bounded worksheet input exceeds/); h.unmount();
});
test("new input clear changed capture and unmount never retain stale correction markers or enable an old inspector", t => {
  noNetwork(t);
  for (const action of ["input", "clear", "context", "unmount"]) {
    const c = indicatorContext(), h = harness(c); h.mount(); click(h, "Add indicator entry");
    inspect(h, indicatorFormEntries(c).map(([key, value]) => [key, key === "1.value" ? "1e3" : value]));
    assert.equal(field(h, "1.value").props["aria-invalid"], true); const old = button(h, "Inspect unsent indicator draft").props.onClick;
    if (action === "input") { h.pauseMerges(); controls(h).props.onChange(); }
    if (action === "clear") click(h, "Clear indicator draft");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(295); h.render(next); }
    if (action === "unmount") h.unmount();
    old(); assert.ok(h.nodes().filter(node => node.props.name).every(node => node.props["aria-invalid"] === undefined));
    assert.doesNotMatch(renderToStaticMarkup(h.render()), /aria-label="Indicator corrections"/); if (action === "input") h.flushMerges(); h.unmount();
  }
});
