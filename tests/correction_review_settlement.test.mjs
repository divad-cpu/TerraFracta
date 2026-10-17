import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const field = (h, tag, suffix) => elements(h.render()).find(row => row.type === tag && row.props.id?.endsWith(`-${suffix}`));
const button = (h, text) => elements(h.render()).find(row => row.type === "button" && row.props.children === text);
const detail = (h, value) => field(h, "textarea", "detail").props.onChange({ target: { value } });
const request = h => h.states().find(value => value?.requestId && value.draft);
const preview = h => /Preview only · never submitted/.test(renderToStaticMarkup(h.render()));
const id = n => `fb000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

for (const scope of ["connected", "current"]) for (const change of ["clear", "detail", "claim"]) {
  test(`${scope} review identity settlement cannot restore a draft after ${change}`, t => {
    const input = connectedInput(), h = editorHarness(scope === "current" ? input.issue : { ...input, generation: 1 }, scope);
    detail(h, "Invented earlier explanation for a local-only draft.");
    let identities = 0;
    t.mock.method(crypto, "randomUUID", () => {
      identities++;
      if (change === "clear") button(h, "Clear draft").props.onClick();
      if (change === "detail") detail(h, "Invented newer explanation must remain unsent.");
      if (change === "claim") field(h, "select", "claim").props.onChange({ target: { value: input.issue.claims[0].id } });
      return id(identities);
    });
    t.mock.method(globalThis, "fetch", () => assert.fail("No transport in the unsent editor"));
    button(h, "Review draft").props.onClick();
    assert.equal(identities, 1); assert.equal(preview(h), false); assert.equal(request(h), undefined);
    if (change === "detail") assert.equal(field(h, "textarea", "detail").props.value, "Invented newer explanation must remain unsent.");
    if (change === "clear" || change === "claim") assert.equal(field(h, "textarea", "detail").props.value, "");
    h.unmount();
  });
}

test("ordinary review after a cleared attempt prepares only the fresh unsent intent", t => {
  const h = editorHarness(connectedInput().issue, "current"); let count = 0;
  t.mock.method(crypto, "randomUUID", () => id(++count));
  t.mock.method(globalThis, "fetch", () => assert.fail("No transport in the unsent editor"));
  detail(h, "Invented earlier explanation."); button(h, "Review draft").props.onClick();
  const first = request(h); assert.ok(first); button(h, "Clear draft").props.onClick();
  detail(h, "Invented explicit successor explanation."); button(h, "Review draft").props.onClick();
  assert.equal(preview(h), true); assert.equal(request(h).requestId, id(2));
  assert.notEqual(request(h).requestId, first.requestId);
  assert.equal(request(h).draft.fields.details, "Invented explicit successor explanation."); h.unmount();
});
