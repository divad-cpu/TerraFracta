import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const projection = connectedInput().issue;
function snapshot() {
  // Actual editor callback seam, with explicitly substituted invented reader
  // metadata. This is not Browser hydration or a current native reader check.
  return { schemaVersion: 1, evidenceKind: "connected_fictional_reader", state: "active", generation: 1,
    executionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", observedAt: "2026-10-03T06:00:00Z",
    actualSourceRequests: 0, modelCalls: 0, livePublicationEnabled: false, issue: projection };
}
const find = (tree, type, suffix) => elements(tree).find(item => item.type === type && (!suffix || item.props.id?.endsWith(suffix)));
const review = tree => elements(tree).find(item => item.type === "button" && item.props.children === "Review draft");
const prepared = harness => harness.states().find(value => value?.schemaVersion === 1 && value.requestId && value.draft);
const explain = (harness, value) => { find(harness.render(), "textarea").props.onChange({ target: { value } }); };

test("actual editor callbacks keep one request for repeated normalized review and replace changed intent", () => {
  const harness = editorHarness(snapshot());
  explain(harness, "Invented explanation for this exact sample."); review(harness.render()).props.onClick();
  const original = prepared(harness); assert.ok(original);
  review(harness.render()).props.onClick(); assert.equal(prepared(harness).requestId, original.requestId);
  explain(harness, "  Invented explanation for this exact sample.  "); review(harness.render()).props.onClick();
  assert.equal(prepared(harness).requestId, original.requestId);
  explain(harness, "A different invented explanation for this sample."); review(harness.render()).props.onClick();
  assert.notEqual(prepared(harness).requestId, original.requestId);
  assert.equal(prepared(harness).draft.target.publicationId, projection.publicationId);
  const html = renderToStaticMarkup(harness.render()); assert.ok(!html.includes(prepared(harness).requestId));
  assert.ok(html.includes("No message was sent and no record was created."));
});
for (const scope of ["connected", "current"]) {
  test(`${scope} editor reuses a reviewed canonical draft when fresh identity generation is unavailable`, () => {
    const h = editorHarness(scope === "current" ? projection : snapshot(), scope);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const detail = "Invented explanation for an already prepared correction.";
    let calls = 0;
    try {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID() {
        calls++; if (calls > 1) throw new Error("PRIVATE_IDENTITY_FAILURE");
        return "f8a11111-1111-4111-8111-111111111111";
      } } });
      explain(h, detail); review(h.render()).props.onClick(); const original = prepared(h);
      assert.ok(original);
      for (const value of [detail, `  ${detail}  `]) {
        explain(h, value); review(h.render()).props.onClick();
        const html = renderToStaticMarkup(h.render());
        assert.deepEqual(prepared(h), original); assert.equal(calls, 1);
        assert.ok(html.includes("Preview only · never submitted"));
        assert.ok(!html.includes("The draft could not be prepared"));
        assert.ok(!html.includes(original.requestId));
      }
      explain(h, "Changed invented explanation that needs a fresh identity."); review(h.render()).props.onClick();
      const failed = renderToStaticMarkup(h.render());
      assert.equal(calls, 2); assert.deepEqual(prepared(h), original);
      assert.ok(failed.includes("The draft could not be prepared"));
      assert.ok(!failed.includes("Preview only · never submitted"));
      assert.ok(failed.includes("Changed invented explanation"));
      assert.ok(!failed.includes("PRIVATE_IDENTITY_FAILURE"));
      // Returning to the earlier intent can reuse its still-current identity.
      explain(h, detail); review(h.render()).props.onClick();
      const restored = renderToStaticMarkup(h.render());
      assert.equal(calls, 2); assert.deepEqual(prepared(h), original);
      assert.ok(restored.includes("Preview only · never submitted"));
      assert.ok(!restored.includes("The draft could not be prepared"));
      assert.ok(restored.includes("No message was sent and no record was created."));
    } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
  });
}
test("target change, clearing and edition remount retire ephemeral request state", () => {
  const harness = editorHarness(snapshot()); explain(harness, "An invented page explanation."); review(harness.render()).props.onClick();
  const original = prepared(harness).requestId;
  find(harness.render(), "select", "claim").props.onChange({ target: { value: projection.claims[0].id } });
  assert.equal(prepared(harness), undefined);
  explain(harness, "An invented claim explanation."); review(harness.render()).props.onClick();
  assert.notEqual(prepared(harness).requestId, original);
  elements(harness.render()).find(item => item.type === "button" && item.props.children === "Clear draft").props.onClick();
  assert.equal(prepared(harness), undefined);
  explain(harness, "Another invented page explanation."); review(harness.render()).props.onClick();
  harness.render({ ...snapshot(), generation: 2, executionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  assert.equal(prepared(harness), undefined);
});
test("failed identity generation refuses connected preview without sending or leaking", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const harness = editorHarness(snapshot()); explain(harness, "An invented explanation before generation failure.");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID() { throw new Error("invented identity failure"); } } });
    review(harness.render()).props.onClick(); assert.equal(prepared(harness), undefined);
    const html = renderToStaticMarkup(harness.render());
    assert.ok(!html.includes("Preview only · never submitted"));
    assert.ok(html.includes("The draft could not be prepared"));
    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes("An invented explanation before generation failure."));
    assert.ok(!html.includes("invented identity failure"));
  } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
});
test("editing, target selection and clear remove an unavailable-review notice while preserving draft rules", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID() { throw new Error("PRIVATE_CANARY"); } } });
    for (const edit of [h => explain(h, "Edited sample explanation."),
      h => find(h.render(), "input", "source").props.onChange({ target: { value: "https://example.org/changed" } }),
      h => find(h.render(), "select", "kind").props.onChange({ target: { value: "missing_context" } }),
      h => find(h.render(), "select", "claim").props.onChange({ target: { value: projection.claims[0].id } }),
      h => elements(h.render()).find(item => item.type === "button" && item.props.children === "Clear draft").props.onClick()]) {
      const h = editorHarness(snapshot()); explain(h, "Valid sample explanation before failure."); review(h.render()).props.onClick();
      assert.ok(renderToStaticMarkup(h.render()).includes("The draft could not be prepared")); edit(h);
      assert.ok(!renderToStaticMarkup(h.render()).includes("The draft could not be prepared"));
      assert.equal(prepared(h), undefined);
    }
  } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
});
test("successful review after an unavailable identity restores the exact unsent preview and no failure claim", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto"), h = editorHarness(snapshot());
  explain(h, "Retained sample explanation for recovery.");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID() { throw new Error("PRIVATE_CANARY"); } } });
    review(h.render()).props.onClick(); assert.ok(renderToStaticMarkup(h.render()).includes("The draft could not be prepared"));
  } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
  review(h.render()).props.onClick(); const html = renderToStaticMarkup(h.render());
  assert.ok(html.includes("Preview only · never submitted")); assert.ok(html.includes("Retained sample explanation for recovery."));
  assert.ok(!html.includes("The draft could not be prepared")); assert.equal(prepared(h).draft.target.publicationId, projection.publicationId);
});
