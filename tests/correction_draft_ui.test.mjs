import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { connectedInput, suppressionInput } from "./helpers/connected_reader_fixture.mjs";
import { correctionModule, editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { connectedCorrectionContext, previewConnectedCorrection } from "../src/connected-correction-draft.ts";

const snapshot = (value = "27.4", generation = 1) => ({ ...connectedInput(value), generation });
const { CorrectionDraft } = correctionModule();
const markup = input => renderToStaticMarkup(createElement(CorrectionDraft, input === undefined ? {} : { connectedSnapshot: input }));
const find = (tree, type, suffix) => elements(tree).find(item => item.type === type && (!suffix || item.props.id?.endsWith(suffix)));
const review = tree => elements(tree).find(item => item.type === "button" && item.props.children === "Review draft");
const clear = tree => elements(tree).find(item => item.type === "button" && item.props.children === "Clear draft");
const text = tree => renderToStaticMarkup(tree);
const detail = "Sample: clarify the exact measured period in this sentence.";

test("the original illustrative exercise and connected exact edition share the real editor", () => {
  const original = markup(); assert.ok(original.includes("Norway / Housing costs")); assert.ok(original.includes("illustrative page"));
  assert.ok(!original.includes("Affected part of this edition"));
  const connected = markup(snapshot());
  for (const value of ["Fictional share observation", "fictional local edition 1", "publication revision 1", "Affected part of this edition", "27.4%", "Nothing will be sent"]) assert.ok(connected.includes(value), value);
  assert.ok(!connected.includes("Norway / Housing costs")); assert.ok(!connected.includes('<form')); assert.ok(!connected.includes('type="submit"'));
});

test("withdrawn, malformed or private-extra snapshots withhold the editor and all their details", () => {
  for (const input of [{ ...suppressionInput(), generation: 2 }, null,
    { ...snapshot(), privateCanary: "DO_NOT_DISPLAY" }, { ...snapshot(), issue: { ...snapshot().issue, privateCanary: "DO_NOT_DISPLAY" } }]) {
    const html = markup(input); assert.ok(html.includes("Correction draft unavailable"));
    assert.ok(!html.includes("DO_NOT_DISPLAY")); assert.ok(!html.includes("27.4%")); assert.ok(!html.includes("textarea"));
  }
});

test("actual edit/review callbacks create only a local page preview and clear it after every edit", () => {
  const harness = editorHarness(snapshot()); let tree = harness.render(); assert.equal(review(tree).props.disabled, true);
  find(tree, "textarea").props.onChange({ target: { value: detail } }); tree = harness.render();
  assert.equal(review(tree).props.disabled, false); review(tree).props.onClick(); tree = harness.render();
  assert.ok(text(tree).includes("Preview only · never submitted")); assert.ok(text(tree).includes("Entire page"));
  assert.ok(text(tree).includes("Publication revision 1"));
  for (const [type, suffix, value] of [["textarea", "detail", detail + " Additional sample."], ["input", "source", "https://example.org/sample"], ["select", "kind", "missing_context"]]) {
    find(tree, type, suffix).props.onChange({ target: { value } }); tree = harness.render();
    assert.ok(!text(tree).includes("Preview only · never submitted")); review(tree).props.onClick(); tree = harness.render();
    assert.ok(text(tree).includes("Preview only · never submitted"));
  }
});

test("selecting the visible claim clears the old explanation and binds reviewed wording and publication", () => {
  const selected = snapshot(), harness = editorHarness(selected); let tree = harness.render();
  find(tree, "textarea").props.onChange({ target: { value: detail } });
  find(tree, "input", "source").props.onChange({ target: { value: "https://example.org/sample" } }); tree = harness.render();
  review(tree).props.onClick(); tree = harness.render();
  find(tree, "select", "claim").props.onChange({ target: { value: selected.issue.claims[0].id } }); tree = harness.render();
  assert.equal(find(tree, "textarea").props.value, ""); assert.equal(find(tree, "input", "source").props.value, ""); assert.equal(review(tree).props.disabled, true);
  find(tree, "textarea").props.onChange({ target: { value: detail } }); tree = harness.render(); review(tree).props.onClick(); tree = harness.render();
  const html = text(tree); for (const value of [selected.issue.publicationId, selected.issue.issueId, selected.issue.claims[0].id, "Affected wording", "In 2025, the fictional share was 27.4%."]) assert.ok(html.includes(value), value);
});

test("unrecognized selector tampering cannot produce a draft", () => {
  const harness = editorHarness(snapshot()); let tree = harness.render();
  find(tree, "select", "claim").props.onChange({ target: { value: "11111111-1111-4111-8111-111111111111" } });
  find(tree, "textarea").props.onChange({ target: { value: detail } }); tree = harness.render(); review(tree).props.onClick(); tree = harness.render();
  assert.ok(!text(tree).includes("Preview only · never submitted"));
  find(tree, "select", "kind").props.onChange({ target: { value: "approve_and_publish" } }); tree = harness.render();
  assert.equal(review(tree).props.disabled, true);
});

test("clear resets all fields, target and reviewed output", () => {
  const selected = snapshot(), harness = editorHarness(selected); let tree = harness.render();
  find(tree, "select", "claim").props.onChange({ target: { value: selected.issue.claims[0].id } });
  find(tree, "textarea").props.onChange({ target: { value: detail } }); tree = harness.render(); review(tree).props.onClick(); tree = harness.render();
  clear(tree).props.onClick(); tree = harness.render();
  assert.equal(find(tree, "textarea").props.value, ""); assert.equal(find(tree, "input", "source").props.value, "");
  assert.equal(find(tree, "select", "kind").props.value, "incorrect_statement"); assert.equal(find(tree, "select", "claim").props.value, "");
  assert.ok(!text(tree).includes("Preview only · never submitted"));
});

test("plain text is escaped and an optional source never becomes an opened link", () => {
  const harness = editorHarness(snapshot()); let tree = harness.render();
  find(tree, "textarea").props.onChange({ target: { value: "Sample <script>unsupported</script> explanation." } });
  find(tree, "input", "source").props.onChange({ target: { value: "https://example.org/sample" } }); tree = harness.render(); review(tree).props.onClick();
  const html = text(harness.render()); assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="https://example.org/sample"'));
});

test("a replacement edition has a different React key even when the claim ID survives", () => {
  const first = snapshot(), next = snapshot("28.1", 2); next.issue.revision = 2;
  assert.equal(first.issue.claims[0].id, next.issue.claims[0].id);
  const firstContext = connectedCorrectionContext(first), nextContext = connectedCorrectionContext(next);
  assert.notEqual(firstContext.key, nextContext.key);
  assert.notEqual(CorrectionDraft({ connectedSnapshot: first }).key, CorrectionDraft({ connectedSnapshot: next }).key);
  const harness = editorHarness(first); let tree = harness.render();
  find(tree, "textarea").props.onChange({ target: { value: detail } }); tree = harness.render(); review(tree).props.onClick();
  tree = harness.render(next); assert.equal(find(tree, "textarea").props.value, ""); assert.ok(!text(tree).includes("Preview only · never submitted"));
  assert.ok(text(tree).includes("28.1%")); assert.ok(!text(tree).includes("27.4%"));
});

test("independent simultaneous editors have unique labels and guidance references", () => {
  const html = renderToStaticMarkup(createElement("div", null, createElement(CorrectionDraft), createElement(CorrectionDraft, { connectedSnapshot: snapshot() })));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/(?:for|aria-describedby|aria-labelledby)="([^"]+)"/g)) assert.ok(ids.includes(match[1]), match[1]);
});

test("the reusable connected preview model supplies the exact local edition without storage fields", () => {
  const saved = snapshot(), context = connectedCorrectionContext(saved);
  const result = previewConnectedCorrection(context, { kind: "missing_context", details: detail, sourceUrl: "" }, saved.issue.claims[0].id);
  assert.deepEqual(result.edition, context.edition); assert.equal(result.draft.target.publicationId, saved.issue.publicationId);
  assert.ok(!JSON.stringify(result).includes("privateEvidenceDirectory"));
});
