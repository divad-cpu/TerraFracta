import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId, proposalScope } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
const context = () => capturedScopeDraftContext(proposalReport());
const field = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const click = (h, label) => (h.nodes().find(node => node.type === "button" && node.props.children === label) ?? assert.fail(label)).props.onClick();
const change = (h, suffix, value) => field(h, suffix).props.onChange({ currentTarget: { value } });
const refs = (h, suffix, values) => field(h, suffix).props.onChange({ currentTarget: { selectedOptions: values.map(value => ({ value })) } });
const json = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const add = h => click(h, "Add responsibility entry");
function fill(h, c, number = 1) {
  change(h, `-${number}-statement`, c.claims[0].id);
  change(h, `-${number}-institution-wording`, `<img src=x> Invented authority ${number}`);
  refs(h, `-${number}-institution-references`, [`${c.claims[0].id}:2`]);
  change(h, `-${number}-period-wording`, "2024");
  refs(h, `-${number}-period-references`, [`${c.claims[0].id}:1`]);
}
test("server-rendered worksheet starts disabled and an admitted empty review explains absence without inventing authority", () => {
  const h = responsibilityDraftHarness(context());
  assert.ok(elements(h.render()).filter(node => ["button", "textarea", "select"].includes(node.type)).every(node => node.props.disabled));
  h.mount(); click(h, "Review responsibility draft"); assert.deepEqual(JSON.parse(json(h)).entries, []);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /not evidence that no authority is responsible/); assert.doesNotMatch(html, /<form|type="submit"|href="https:/);
  h.unmount();
});
test("two authorities retain separate nullable fields exact references and date precision without requests", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network"));
  const c = context(), h = responsibilityDraftHarness(c); h.mount(); add(h); fill(h, c); add(h); fill(h, c, 2);
  click(h, "Review responsibility draft"); const result = JSON.parse(json(h)); assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].fields.period.wording, "2024"); assert.equal(result.entries[0].fields.role, null);
  assert.equal(result.entries[1].fields.institution.references[0].referenceNumber, 2);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<img/);
  assert.ok(html.includes(`href="#proposal-proposed-reference-${c.claims[0].id}-2"`));
  assert.match(html, /does not establish support for this new wording/); h.unmount();
});
test("missing association incomplete wording duplicate and foreign references hold without leaking injected target", () => {
  const c = context(), h = responsibilityDraftHarness(c); h.mount(); add(h); click(h, "Review responsibility draft"); assert.equal(json(h), undefined);
  fill(h, c); click(h, "Review responsibility draft"); assert.ok(json(h));
  refs(h, "-1-institution-references", ["PRIVATE_FOREIGN_REFERENCE"]); assert.equal(json(h), undefined);
  click(h, "Review responsibility draft"); assert.equal(json(h), undefined);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_FOREIGN_REFERENCE/);
  refs(h, "-1-institution-references", [`${c.claims[0].id}:1`, `${c.claims[0].id}:1`]); click(h, "Review responsibility draft"); assert.equal(json(h), undefined);
  h.unmount();
});
test("editing remove and clear retire old review remove clear and input callbacks within the same capture", () => {
  const c = context(), h = responsibilityDraftHarness(c); h.mount(); add(h); fill(h, c);
  const action = label => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === label).props.onClick;
  const oldReview = action("Review responsibility draft"), oldRemove = action("Remove responsibility entry 1"), oldClear = action("Clear responsibility draft");
  change(h, "-1-institution-wording", "Invented updated authority"); oldReview(); oldRemove(); oldClear(); assert.equal(json(h), undefined);
  assert.equal(field(h, "-1-institution-wording").props.value, "Invented updated authority");
  const oldInput = field(h, "-1-institution-wording").props.onChange; click(h, "Clear responsibility draft");
  const forbidden = new Proxy({}, { get() { assert.fail("Retired input observed event"); } }); oldInput(forbidden);
  add(h); assert.equal(h.nodes().filter(node => node.type === "fieldset").length, 1); h.unmount();
});
test("replacement invalid-context roundtrip and committed unmount retire callbacks before event observation", () => {
  const c = context(), h = responsibilityDraftHarness(c); h.mount(); add(h); fill(h, c); click(h, "Review responsibility draft");
  const oldInput = field(h, "-1-institution-wording").props.onChange, oldReview = h.nodes().find(node => node.props.children === "Review responsibility draft").props.onClick;
  const changed = structuredClone(c); changed.binding.captureId = proposalId(99); h.render(changed); assert.equal(json(h), undefined);
  const forbidden = new Proxy({}, { get() { assert.fail("Old input observed event"); } }); oldInput(forbidden); oldReview(); h.commit();
  assert.equal(h.nodes().filter(node => node.type === "fieldset").length, 0);
  const review = h.nodes().find(node => node.props.children === "Review responsibility draft").props.onClick;
  h.render({}); h.render(changed); review(); assert.equal(json(h), undefined); h.commit();
  const paste = field(h, "-reopen-json").props.onChange; h.unmount(); paste(forbidden);
});
test("copied JSON roundtrip restores exact fields while changed paste or capture withholds prior preview", () => {
  const c = context(), h = responsibilityDraftHarness(c); h.mount(); add(h); fill(h, c); click(h, "Review responsibility draft"); const saved = json(h);
  click(h, "Clear responsibility draft"); change(h, "-reopen-json", saved); click(h, "Reopen responsibility preparation"); assert.equal(json(h), saved);
  const row = h.nodes().find(node => node.type === "fieldset"), statement = elements(row).find(node => node.type === "select"); assert.equal(statement.props.value, c.claims[0].id);
  const oldReopen = h.nodes().find(node => node.props.children === "Reopen responsibility preparation").props.onClick;
  change(h, "-reopen-json", "{}"); oldReopen(); assert.equal(json(h), undefined); click(h, "Reopen responsibility preparation"); assert.equal(json(h), undefined);
  change(h, "-reopen-json", saved + "\n"); click(h, "Reopen responsibility preparation"); assert.equal(json(h), undefined);
  h.unmount();
});
test("pending field merges cannot review old text or revive prior preview and structural edits retire old inputs", () => {
  const c = context(), h = responsibilityDraftHarness(c); h.mount(); add(h); fill(h, c); click(h, "Review responsibility draft"); assert.ok(json(h));
  h.pauseMerges(); change(h, "-1-institution-wording", "Invented delayed authority");
  assert.equal(json(h), undefined); click(h, "Review responsibility draft"); assert.equal(json(h), undefined);
  h.flushMerges(); click(h, "Review responsibility draft"); assert.equal(JSON.parse(json(h)).entries[0].fields.institution.wording, "Invented delayed authority");
  const oldInput = field(h, "-1-period-wording").props.onChange;
  add(h); oldInput(new Proxy({}, { get() { assert.fail("Structural edit did not retire input"); } })); h.unmount();
});
test("bounded row controls and Unicode input capacity preserve complete-export holds", () => {
  const c = context(), h = responsibilityDraftHarness(c); h.mount();
  for (let i = 1; i <= 8; i++) { add(h); fill(h, c, i); }
  const addButton = h.nodes().find(node => node.props.children === "Add responsibility entry"); assert.equal(addButton.props.disabled, true); addButton.props.onClick();
  assert.equal(h.nodes().filter(node => node.type === "fieldset").length, 8);
  assert.equal(field(h, "-1-institution-wording").props.maxLength, 2400);
  for (let i = 1; i <= 8; i++) change(h, `-${i}-institution-wording`, String(i) + "😀".repeat(1199));
  click(h, "Review responsibility draft"); assert.equal(json(h), undefined); assert.match(renderToStaticMarkup(h.render()), /complete JSON size/); h.unmount();
});
test("actual checked parent offers a distinct focus target while foreign corrupt and withheld captures refuse the whole worksheet", () => {
  const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url));
  const report = proposalReport(), render = (kind, value = report, selection = proposalScope()) => renderToStaticMarkup(ProposalComparisonView({ decision: { kind, report: value }, selection }));
  const html = render("ok"); assert.match(html, /Prepare dated responsibility — unsent/);
  assert.match(html, /href="#proposal-responsibility-preparation"/); assert.equal([...html.matchAll(/id="proposal-responsibility-preparation"/g)].length, 1);
  const bad = structuredClone(report); bad.capture.proposalSha256 = "0".repeat(64);
  for (const value of [render("ok", bad), render("ok", report, { ...proposalScope(), runId: proposalId(99) }), ...["changed", "capture_missing", "unavailable"].map(kind => render(kind))]) assert.doesNotMatch(value, /responsibility-preparation|Prepare dated responsibility|Institution or authority/);
});
