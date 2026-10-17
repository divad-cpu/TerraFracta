import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";

const input = (tree, suffix) => elements(tree).find(node => node.props.id?.endsWith(suffix));
const button = (tree, label) => elements(tree).find(node => node.type === "button" && node.props.children === label);
const canary = "PRIVATE_DRAFT_PRIOR_VISIT";
function prepare(h) {
  const tree = h.render();
  input(tree, "-population-wording").props.onChange({ currentTarget: { value: canary } });
  input(tree, "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value: `${proposalId(3)}:1` }] } });
  const json = `{"private":"${canary}"}`;
  input(h.render(), "-reopen-json").props.onChange({ currentTarget: { value: json } });
  return json;
}

test("scope values and selected references are withheld on a same-capture return before visit admission", () => {
  for (const replacementKind of ["other-capture", "invalid"]) {
    const context = capturedScopeDraftContext(proposalReport());
    const h = scopeDraftHarness(context); h.mount(); const pasted = prepare(h);
    const old = h.render();
    assert.equal(input(old, "-population-wording").props.value, canary);
    assert.equal(input(old, "-reopen-json").props.value, pasted);
    const replacement = structuredClone(context);
    replacement.binding.captureId = proposalId(99);
    h.render(replacementKind === "invalid" ? {} : replacement);
    const returning = h.render(context);
    assert.equal(button(returning, "Review scope draft").props.disabled, true);
    assert.equal(input(returning, "-population-wording").props.value, "");
    assert.deepEqual(input(returning, "-population-references").props.value, []);
    assert.equal(input(returning, "-reopen-json").props.value, "");
    assert.doesNotMatch(renderToStaticMarkup(returning), new RegExp(canary));
    for (const suffix of ["-population-wording", "-population-references", "-reopen-json"]) {
      input(old, suffix).props.onChange(new Proxy({}, { get() { assert.fail("Retired event read"); } }));
    }
    h.commit(); const admitted = h.render();
    assert.equal(button(admitted, "Review scope draft").props.disabled, false);
    assert.equal(input(admitted, "-population-wording").props.value, "");
    input(admitted, "-population-wording").props.onChange({ currentTarget: { value: "New admitted wording" } });
    assert.equal(input(h.render(), "-population-wording").props.value, "New admitted wording");
    h.unmount();
  }
});

test("scope projection preserves ordinary same-visit edits and does not turn reference filtering into a reset", () => {
  const context = capturedScopeDraftContext(proposalReport());
  const h = scopeDraftHarness(context); h.mount(); const pasted = prepare(h);
  input(h.render(), "-reference-search").props.onChange({ currentTarget: { value: "no matching reference" } });
  const same = h.render(structuredClone(context));
  assert.equal(button(same, "Review scope draft").props.disabled, false);
  assert.equal(input(same, "-population-wording").props.value, canary);
  assert.deepEqual(input(same, "-population-references").props.value, [`${proposalId(3)}:1`]);
  assert.equal(input(same, "-reopen-json").props.value, pasted);
  assert.match(renderToStaticMarkup(same), /Selected outside this filter/);
  h.unmount();
});

test("retired scope reference-search handlers refuse an event before extracting its value", () => {
  const context = capturedScopeDraftContext(proposalReport());
  const h = scopeDraftHarness(context); h.mount();
  const oldSearch = input(h.render(), "-reference-search").props.onChange;
  const next = structuredClone(context); next.binding.captureId = proposalId(99);
  h.render(next);
  oldSearch(new Proxy({}, { get() { assert.fail("Retired reference-search event read"); } }));
  h.commit();
  input(h.render(), "-reference-search").props.onChange({ currentTarget: { value: "Invented" } });
  assert.equal(input(h.render(), "-reference-search").props.value, "Invented");
  h.unmount();
});
