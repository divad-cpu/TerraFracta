import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as observation from "../src/fictional-observation-comparison.ts";
import { observeClientError } from "../src/client-error-diagnostics.ts";

const before = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url))).fictionalCandidate;
const after = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url))).fictionalCandidate;
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
const turn = () => new Promise(resolve => setImmediate(resolve));

// Actual component/exporter/observer; only hook cells and native download
// facilities are controlled. This does not execute Browser saving or hydration.
function harness(report = async () => null) {
  const file = new URL("../app/update-preview/comparison.tsx", import.meta.url), native = createRequire(file), exports = {};
  let message = null; const codes = [];
  const hooks = { useId: () => "comparison-download", useState: () => [message, next => { message = next; }] };
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", compiled)(name => name === "react" ? hooks :
    name.endsWith("fictional-observation-comparison") ? observation : name.endsWith("client-error-diagnostics.ts") ? {
      observeClientError: code => observeClientError(code, async code => { codes.push(code); return report(code); }),
    } : native(name), exports);
  const render = () => exports.FictionalComparison({ baseline: before, candidate: after });
  return { codes, markup: () => renderToStaticMarkup(render()), download: () => nodes(render()).find(node => node.type === "button").props.onClick() };
}

function nativeDownload(t, fail = "") {
  const calls = [], blobs = [], timers = [];
  const denied = action => { if (fail === action || fail === "click+remove" && ["click", "remove"].includes(action)) throw new Error("PRIVATE_DOWNLOAD_CANARY"); };
  const link = { click() { calls.push("click"); denied("click"); }, remove() { calls.push("remove"); denied("remove"); } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(name) { assert.equal(name, "a"); calls.push("create"); denied("create"); return link; },
    body: { append(value) { assert.equal(value, link); calls.push("append"); denied("append"); } },
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", blob => { calls.push("url"); denied("url"); blobs.push(blob); return "blob:fictional-comparison"; });
  t.mock.method(URL, "revokeObjectURL", url => { assert.equal(url, "blob:fictional-comparison"); calls.push("revoke"); denied("revoke"); });
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { assert.equal(milliseconds, 1000); calls.push("timer"); denied("timer"); timers.push(callback); return 1; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Download unexpectedly dispatched a request"));
  return { calls, blobs, timers, link };
}

test("comparison download retains exact fictional artifact and native delayed revocation", async t => {
  const trap = nativeDownload(t), ui = harness();
  assert.doesNotThrow(ui.download); assert.match(ui.markup(), /Download requested/);
  assert.equal(trap.link.download, "terrafracta-fictional-comparison.json");
  assert.equal(await trap.blobs[0].text(), observation.exportFictionalComparison(before, after));
  assert.deepEqual(trap.calls, ["create", "url", "append", "click", "remove", "timer"]);
  assert.equal(trap.timers.length, 1); assert.doesNotThrow(trap.timers[0]); await turn();
  assert.equal(trap.calls.at(-1), "revoke"); assert.deepEqual(ui.codes, []);
});

for (const failure of ["create", "url", "append", "click"]) {
  test(`native ${failure} refusal preserves the comparison and fixed private export diagnostic`, async t => {
    const trap = nativeDownload(t, failure), ui = harness();
    assert.doesNotThrow(ui.download); await turn();
    assert.match(ui.markup(), /comparison could not be exported/); assert.match(ui.markup(), /27\.4%/); assert.match(ui.markup(), /28\.1%/);
    assert.doesNotMatch(ui.markup(), /PRIVATE_DOWNLOAD_CANARY|Download requested/); assert.deepEqual(ui.codes, ["update_export"]);
    for (const callback of trap.timers) assert.doesNotThrow(callback);
  });
}

for (const failure of ["remove", "click+remove", "revoke", "timer"]) {
  test(`native ${failure} cleanup cannot replace the original export outcome or strand other cleanup`, async t => {
    const trap = nativeDownload(t, failure), ui = harness();
    assert.doesNotThrow(ui.download); for (const callback of trap.timers) assert.doesNotThrow(callback); await turn();
    assert.ok(trap.calls.includes("revoke"));
    assert.match(ui.markup(), failure === "click+remove" ? /comparison could not be exported/ : /Download requested/);
    assert.deepEqual(ui.codes, failure === "click+remove" ? ["update_export"] : []);
    assert.doesNotMatch(ui.markup(), /PRIVATE_DOWNLOAD_CANARY/);
  });
}

test("reporter throw, rejection or stall cannot replace the native export failure notice", async t => {
  const trap = nativeDownload(t, "click");
  for (const report of [() => { throw new Error("PRIVATE_REPORTER_CANARY"); }, async () => { throw new Error("PRIVATE_REPORTER_CANARY"); }, () => new Promise(() => {})]) {
    const ui = harness(report); assert.doesNotThrow(ui.download); await turn();
    assert.match(ui.markup(), /comparison could not be exported/); assert.deepEqual(ui.codes, ["update_export"]);
    assert.doesNotMatch(ui.markup(), /PRIVATE_REPORTER_CANARY/);
  }
  for (const callback of trap.timers) assert.doesNotThrow(callback);
});
