import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as observation from "../src/fictional-observation-comparison.ts";

const before = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url))).fictionalCandidate;
const after = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url))).fictionalCandidate;
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
function action(isCurrent, codes) {
  const file = new URL("../app/update-preview/comparison.tsx", import.meta.url), native = createRequire(file), out = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)(name => name === "react" ? { useId: () => "owned", useState: () => [null, () => {}] } :
    name.endsWith("fictional-observation-comparison") ? observation : name.endsWith("client-error-diagnostics.ts") ?
      { observeClientError: code => codes.push(code) } : native(name), out);
  return nodes(out.FictionalComparison({ baseline: before, candidate: after, isCurrent })).find(x => x.type === "button").props.onClick;
}
function trap(t, retireAt, invalidate) {
  const calls = [], blobs = [], timers = [];
  const at = name => { calls.push(name); if (name === retireAt) invalidate(); };
  const link = { remove() { at("remove"); }, click() { at("click"); } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() { at("create"); return link; }, body: { append() { at("append"); } },
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", blob => { blobs.push(blob); at("url"); return "blob:owned"; });
  t.mock.method(URL, "revokeObjectURL", () => at("revoke"));
  t.mock.method(globalThis, "setTimeout", fn => { timers.push(fn); return 1; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Comparison export dispatched a request"));
  return { calls, blobs, link, settle() { for (const fn of timers) fn(); } };
}
test("retired and throwing selection guards deny comparison export before native allocation", t => {
  const codes = [], native = trap(t);
  for (const guard of [() => false, () => { throw new Error("PRIVATE_GUARD"); }]) action(guard, codes)();
  assert.deepEqual(native.calls, []); assert.deepEqual(codes, []);
});
test("selection replacement between URL allocation and append releases resources without a click", t => {
  let current = true; const codes = [], native = trap(t, "url", () => { current = false; });
  action(() => current, codes)(); native.settle();
  assert.equal(native.calls.includes("click"), false); assert.equal(native.calls.includes("append"), false);
  assert.equal(native.calls.includes("remove"), true); assert.equal(native.calls.includes("revoke"), true); assert.deepEqual(codes, []);
});
test("selection replacement during append denies the retained comparison click", t => {
  let current = true; const codes = [], native = trap(t, "append", () => { current = false; });
  action(() => current, codes)(); native.settle();
  assert.equal(native.calls.includes("click"), false); assert.equal(native.calls.includes("revoke"), true); assert.deepEqual(codes, []);
});
test("admitted comparison keeps exact existing artifact and native delayed cleanup", async t => {
  const codes = [], native = trap(t);
  action(() => true, codes)(); assert.equal(native.calls.includes("click"), true);
  assert.equal(await native.blobs[0].text(), observation.exportFictionalComparison(before, after));
  assert.equal(native.link.download, "terrafracta-fictional-comparison.json"); native.settle();
  assert.equal(native.calls.at(-1), "revoke"); assert.deepEqual(codes, []);
});
