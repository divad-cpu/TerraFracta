import assert from "node:assert/strict";
import test from "node:test";
import { responsibilityFileModule } from "./helpers/responsibility_file_harness.mjs";
import { responsibilityDraftJson } from "../src/responsibility-draft.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
function fixture() {
  const context = capturedScopeDraftContext(proposalReport());
  const json = responsibilityDraftJson({ schemaVersion: 1, kind: "responsibility_preparation", binding: context.binding, entries: [] }, context);
  return { create: responsibilityFileModule(context), bytes: new TextEncoder().encode(json), json };
}
for (const phase of ["size", "slice", "arrayBuffer"]) test(`responsibility ${phase} replacement cannot read a second body before the original invocation settles`, async () => {
  const { create, bytes, json } = fixture(); let old = create(), next, finish, firstReads = 0, nextReads = 0;
  const successor = { size: bytes.length, slice() { return { arrayBuffer() { nextReads++; return Promise.resolve(bytes.buffer); } }; } };
  const replace = () => { old.unmount(); next = create(); next.mount(); next.choose(successor); };
  const original = { get size() { if (phase === "size") replace(); return bytes.length; }, slice() {
    if (phase === "slice") replace(); return { arrayBuffer() {
      firstReads++; if (phase === "arrayBuffer") replace(); return new Promise(resolve => { finish = resolve; });
    } };
  } };
  old.mount(); try {
    old.choose(original); assert.equal(nextReads, 0); assert.equal(firstReads, phase === "arrayBuffer" ? 1 : 0);
    if (finish) { assert.equal(next.input().disabled, true); finish(bytes.buffer); }
    await tick(); assert.equal(next.input().disabled, false); assert.equal(nextReads, 0); assert.equal(next.preview(), undefined);
    next.choose(successor); await tick(); assert.equal(nextReads, 1); assert.equal(next.preview(), json);
  } finally { finish?.(bytes.buffer); old.unmount(); next?.unmount(); await tick(); }
});
test("layout cancellation failure retains unresolved physical bytes and rejects late installation on both old and replacement visits", async t => {
  const { create, bytes } = fixture(), old = create(); let finish, nextReads = 0, next;
  const nativeAbort = AbortController.prototype.abort; let failAbort = false;
  t.mock.method(AbortController.prototype, "abort", function (...args) {
    if (failAbort) throw Error("PRIVATE_ABORT");
    return nativeAbort.apply(this, args);
  });
  old.mount(); try {
    old.choose({ size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }; } });
    const retained = old.input().onChange; failAbort = true; old.retireLayout(); failAbort = false;
    retained(new Proxy({}, { get() { assert.fail("Retired file event inspected"); } }));
    next = create(); next.mount(); assert.equal(next.input().disabled, true);
    next.choose({ size: bytes.length, slice() { nextReads++; return { arrayBuffer: async () => bytes.buffer }; } });
    assert.equal(nextReads, 0); finish(bytes.buffer); await tick(); assert.equal(old.preview(), undefined); assert.equal(next.preview(), undefined);
    assert.equal(next.input().disabled, false); assert.equal(nextReads, 0);
  } finally { failAbort = false; finish?.(bytes.buffer); old.unmount(); next?.unmount(); await tick(); }
});
test("initial deadline-clock reentry reserves the physical slot before a successor can inspect File bytes", async t => {
  const { create, bytes, json } = fixture(), old = create(); let next, reads = 0, switched = false;
  const file = { size: bytes.length, slice() { reads++; return { arrayBuffer: async () => bytes.buffer }; } };
  old.mount(); const clock = t.mock.method(performance, "now", () => {
    if (!switched) { switched = true; old.unmount(); next = create(); next.mount(); next.choose(file); }
    return 0;
  });
  try {
    old.choose(file); assert.equal(reads, 0); await tick(); assert.equal(next.input().disabled, false); assert.equal(reads, 0);
    clock.mock.restore(); next.choose(file); await tick(); assert.equal(reads, 1); assert.equal(next.preview(), json);
  } finally { clock.mock.restore(); old.unmount(); next?.unmount(); await tick(); }
});
