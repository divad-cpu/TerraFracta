import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { responsibilityDraftJson } from "../src/responsibility-draft.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const field = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const click = (h, label) => h.nodes().find(node => node.type === "button" && node.props.children === label).props.onClick();
const preview = h => h.nodes().find(node => node.props.readOnly)?.props.value;
function ready() {
  const c = capturedScopeDraftContext(proposalReport()), h = responsibilityDraftHarness(c); h.mount();
  const draft = { schemaVersion: 1, kind: "responsibility_preparation", binding: c.binding, entries: [{ claimId: c.claims[0].id,
    fields: { institution: { wording: "Invented file authority", references: [{ claimId: c.claims[0].id, referenceNumber: 2 }] }, governmentLevel: null, role: null, period: null } }] };
  const json = responsibilityDraftJson(draft, c), bytes = new TextEncoder().encode(json);
  return { c, h, json, bytes };
}
function select(h, file) { const target = { files: file === undefined ? [] : [file], value: "PRIVATE_FILENAME" }; field(h, "-file").props.onChange({ currentTarget: target }); assert.equal(target.value, ""); }
test("native File reopening installs exact copied JSON without uploads filenames or diagnostic side effects", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network or diagnostic transport"));
  const { h, json, bytes } = ready(); try {
    select(h, new File([bytes], "PRIVATE_FILENAME")); await tick(); assert.equal(preview(h), json);
    const html = renderToStaticMarkup(h.render()); assert.match(html, /Local responsibility preparation opened/); assert.doesNotMatch(html, /PRIVATE_FILENAME|<form|Download responsibility|href="https:/);
  } finally { h.unmount(); }
});
test("an invalid selected file withholds the previous preview while preserving editable authority wording", async () => {
  const { h, bytes } = ready(); try {
    select(h, new File([bytes], "Invented.json")); await tick(); assert.ok(preview(h));
    select(h, new File(["{}"], "PRIVATE_INVALID_NAME")); await tick(); assert.equal(preview(h), undefined);
    const text = h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-institution-wording")); assert.equal(text.props.value, "Invented file authority");
    const html = renderToStaticMarkup(h.render()); assert.match(html, /editable wording is preserved/); assert.doesNotMatch(html, /PRIVATE_INVALID_NAME/);
  } finally { h.unmount(); }
});
test("editing during ignored-abort bytes retires installation while the physical input stays occupied until actual settlement", async () => {
  const { h, bytes } = ready(); let finish; try {
    click(h, "Add responsibility entry"); const wording = field(h, "-1-institution-wording");
    select(h, { size: bytes.length, slice() { return { arrayBuffer() { return new Promise(resolve => { finish = resolve; }); } }; } });
    assert.equal(field(h, "-file").props.disabled, true);
    field(h, "-1-institution-wording").props.onChange({ currentTarget: { value: "Invented newer in-memory authority" } });
    assert.equal(field(h, "-file").props.disabled, true); finish(bytes.buffer); await tick();
    assert.equal(preview(h), undefined); assert.equal(field(h, "-file").props.disabled, false);
    assert.equal(field(h, "-1-institution-wording").props.value, "Invented newer in-memory authority");
  } finally { finish?.(bytes.buffer); h.unmount(); await tick(); }
});
test("clear replacement invalid-context roundtrip and unmount reject retained file events before observing getters", async () => {
  for (const action of [h => click(h, "Clear responsibility draft"), (h, c) => h.render({ ...c, binding: { ...c.binding, captureId: proposalId(99) } }),
    (h, c) => { h.render({}); h.render(c); }, h => h.unmount()]) {
    const { c, h } = ready(); const old = field(h, "-file").props.onChange;
    action(h, c); old(new Proxy({}, { get() { assert.fail("Retired selector observed event"); } })); h.unmount();
  }
});
test("producer errors invalid size and late deadline stay opaque and recover only after a new explicit selection", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No diagnostic payload or network"));
  const { h, bytes, json } = ready(); try {
    for (const file of [{ get size() { throw Error("PRIVATE_SIZE"); } }, { size: 16_385, slice() { assert.fail("Excessive file was sliced"); } },
      { size: bytes.length, slice() { throw Error("PRIVATE_SLICE"); } }, { size: bytes.length, slice() { return { arrayBuffer() { return Promise.reject(Error("PRIVATE_BYTES")); } }; } }]) {
      select(h, file); await tick(); assert.equal(preview(h), undefined); assert.equal(field(h, "-file").props.disabled, false);
      assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_SIZE|PRIVATE_SLICE|PRIVATE_BYTES/);
    }
    const clock = t.mock.method(performance, "now", (() => { let calls = 0; return () => calls++ === 0 ? 0 : 8000; })());
    select(h, new File([bytes], "Invented.json")); await tick(); assert.equal(preview(h), undefined); clock.mock.restore();
    select(h, new File([bytes], "Invented.json")); await tick(); assert.equal(preview(h), json);
    for (const event of [new Proxy({}, { get() { throw Error("PRIVATE_EVENT"); } }), { currentTarget: { get files() { throw Error("PRIVATE_FILES"); } } }]) {
      assert.doesNotThrow(() => field(h, "-file").props.onChange(event)); await tick(); assert.equal(preview(h), undefined);
      assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_EVENT|PRIVATE_FILES/);
    }
  } finally { h.unmount(); }
});
test("failed outer controller allocation releases only its own reservation without reading bytes or hiding future explicit recovery", async t => {
  const { h, bytes, json } = ready(); let reads = 0;
  const constructor = t.mock.method(globalThis, "AbortController", function () { throw Error("PRIVATE_ALLOCATION"); });
  try {
    select(h, { size: bytes.length, slice() { reads++; return { arrayBuffer: async () => bytes.buffer }; } }); await tick();
    assert.equal(reads, 0); assert.equal(field(h, "-file").props.disabled, false); assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_ALLOCATION/);
    constructor.mock.restore(); select(h, new File([bytes], "Invented.json")); await tick(); assert.equal(preview(h), json);
  } finally { constructor.mock.restore(); h.unmount(); }
});
