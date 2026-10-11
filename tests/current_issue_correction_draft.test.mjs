import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { currentIssueCorrectionContext, previewCurrentIssueCorrection } from "../src/current-issue-correction-draft.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { correctionModule, editorHarness, elements } from "./helpers/correction_draft_harness.mjs";

const issue = () => parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const fields = { kind: "missing_context", details: "Invented explanation of the example period.", sourceUrl: "https://example.org/fictional-note" };
const element = (tree, type, suffix) => elements(tree).find(item => item.type === type && item.props.id?.endsWith(`-${suffix}`));
const review = tree => elements(tree).find(item => item.type === "button" && item.props.children === "Review draft");
const prepared = harness => harness.states().find(value => value?.schemaVersion === 1 && value.requestId && value.draft);
const { CurrentIssueCorrectionDraft } = correctionModule();

test("current issue correction context has exact publication identity without inventing a saved edition or time", () => {
  const record = issue(), context = currentIssueCorrectionContext(record);
  assert.equal(context.edition, null); assert.notEqual(context.issue, record);
  assert.ok(context.key.includes(record.publicationId));
  assert.ok(!Object.hasOwn(context, "observedAt")); assert.ok(!Object.hasOwn(context, "generation"));
  const next = { ...record, publicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 2 };
  assert.notEqual(currentIssueCorrectionContext(next).key, context.key);
});
test("malformed or ambiguous current projections withhold the editor and never become the Norway exercise", () => {
  const duplicate = issue(); duplicate.claims.push(structuredClone(duplicate.claims[0]));
  for (const value of [null, undefined, {}, { ...issue(), privateCanary: "hidden" }, duplicate,
    { ...issue(), revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(currentIssueCorrectionContext(value), null);
    const html = renderToStaticMarkup(createElement(CurrentIssueCorrectionDraft, { issue: value }));
    assert.ok(html.includes("Correction draft unavailable")); assert.ok(!html.includes("textarea"));
    assert.ok(!html.includes("Norway / Housing costs")); assert.ok(!html.includes("privateCanary"));
  }
});
test("current draft binds whole page or visible claim and rejects foreign claims and unsupported fields", () => {
  const record = issue(), context = currentIssueCorrectionContext(record);
  for (const claimId of [null, record.claims[0].id]) {
    const preview = previewCurrentIssueCorrection(context, fields, claimId);
    assert.equal(preview.edition, null); assert.equal(preview.draft.target.publicationId, record.publicationId);
    assert.equal(preview.draft.target.claimId, claimId);
    assert.equal(preview.draft.claimAssertion, claimId === null ? null : record.claims[0].assertion);
  }
  assert.equal(previewCurrentIssueCorrection(context, fields, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), null);
  assert.equal(previewCurrentIssueCorrection(context, { ...fields, details: "short" }, null), null);
  assert.equal(previewCurrentIssueCorrection(context, { ...fields, sourceUrl: "http://example.org/" }, null), null);
});
test("actual shared current editor shows exact visible wording without a fictional execution or submission channel", () => {
  const record = issue(), html = renderToStaticMarkup(createElement(CurrentIssueCorrectionDraft, { issue: record }));
  for (const text of [record.title, record.claims[0].assertion, "current reader publication revision 1", "Draft text is not submitted or stored"])
    assert.ok(html.includes(text));
  for (const text of ["fictional local edition", "Saved edition", "<form", 'type="submit"', 'name="contact"', 'href="https:'])
    assert.ok(!html.includes(text), text);
});
test("actual current-editor callbacks retain one unsent identity and clear details on exact claim selection", () => {
  const record = issue(), harness = editorHarness(record, "current");
  let tree = harness.render(); element(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } });
  tree = harness.render(); review(tree).props.onClick();
  const first = prepared(harness); assert.equal(first.draft.target.publicationId, record.publicationId);
  tree = harness.render(); review(tree).props.onClick(); assert.deepEqual(prepared(harness), first);
  tree = harness.render(); element(tree, "select", "claim").props.onChange({ target: { value: record.claims[0].id } });
  tree = harness.render(); assert.equal(element(tree, "textarea", "detail").props.value, "");
  assert.equal(element(tree, "input", "source").props.value, ""); assert.equal(prepared(harness), undefined);
  element(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } });
  tree = harness.render(); review(tree).props.onClick(); assert.equal(prepared(harness).draft.target.claimId, record.claims[0].id);
});
test("actual current draft preview preserves publication and claim but supplies no invented saved timestamp", () => {
  const record = issue(), harness = editorHarness(record, "current");
  let tree = harness.render(); element(tree, "select", "claim").props.onChange({ target: { value: record.claims[0].id } });
  tree = harness.render(); element(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } });
  tree = harness.render(); review(tree).props.onClick(); tree = harness.render();
  const html = renderToStaticMarkup(tree);
  for (const text of ["Publication revision 1", record.publicationId, record.claims[0].id, record.claims[0].assertion, "No message was sent"])
    assert.ok(html.includes(text));
  assert.ok(!html.includes("Saved edition")); assert.ok(!html.includes("Local edition")); assert.ok(!html.includes("<time"));
});
test("changed or withdrawn current issue unmounts the local draft before a later visit starts empty", () => {
  const record = issue(), harness = editorHarness(record, "current");
  let tree = harness.render(); element(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } });
  tree = harness.render(); review(tree).props.onClick(); assert.ok(prepared(harness));
  const successor = { ...record, publicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 2 };
  tree = harness.render(successor); assert.equal(element(tree, "textarea", "detail").props.value, "");
  assert.equal(prepared(harness), undefined);
  const held = harness.render(null); assert.ok(renderToStaticMarkup(held).includes("Correction draft unavailable"));
  assert.deepEqual(harness.states(), []);
  tree = harness.render(record); assert.equal(element(tree, "textarea", "detail").props.value, "");
});
