import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { connectedEdition } from "../src/connected-fictional-reader.ts";

// Invoke the actual page function in process. Next's routing boundary and the
// filesystem are instrumented; this does not access HTTP, browser or DOM.
const navigation = createRequire(import.meta.url)("next/navigation");
const sourcePath = new URL("../app/connected-preview/[view]/page.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function pageHarness(mode) {
  const calls = [], marker = new Error("NEXT_NOT_FOUND"), exports = {};
  const nativeRequire = createRequire(sourcePath);
  const require = (name) => {
    if (name === "next/navigation") return { notFound: () => { throw marker; }, unstable_rethrow: navigation.unstable_rethrow };
    if (name.endsWith("connected-fictional-reader")) return { connectedEdition };
    if (name.endsWith("connected-preview-view")) return { connectedViews: ["overview", "issue", "sources", "search"], ConnectedPreviewView: () => null };
    if (name.endsWith("connected-fictional-store")) return { connectedFictionalStore: () => ({ current: async (edition) => { calls.push(edition); return { kind: "empty" }; } }) };
    if (name.endsWith("connected-reader-status")) return { connectedStatusIdentity: () => assert.fail("Empty page has no status identity") };
    if (name.endsWith("CurrentConnectedEdition")) return { CurrentConnectedEdition: () => null };
    return nativeRequire(name);
  };
  new Function("require", "exports", "process", compiled)(require, exports, { env: { NODE_ENV: mode } });
  return { page: exports.default, calls, marker };
}
test("production refuses before route promises or the private filesystem are touched", async () => {
  for (const mode of ["production", "test", undefined]) {
    const h = pageHarness(mode);
    const forbidden = { then() { assert.fail("Route parameters touched before development gate"); } };
    await assert.rejects(h.page({ params: forbidden, searchParams: forbidden }), (error) => error === h.marker);
    assert.deepEqual(h.calls, []);
  }
});
test("production refuses before page property getters or null props are touched", async () => {
  for (const mode of ["production", "test", undefined]) {
    for (const input of [null, undefined, new Proxy({}, { get() { assert.fail("Page property accessed before development gate"); } })]) {
      const h = pageHarness(mode);
      await assert.rejects(h.page(input), (error) => error === h.marker);
      assert.deepEqual(h.calls, []);
    }
  }
});
test("unknown routes, duplicated editions and path selection refuse before any read", async () => {
  for (const [view, query] of [["unknown", {}], ["issue", { edition: ["1", "2"] }], ["issue", { path: "/private" }], ["sources", { q: "canary" }], ["overview", { edition: "../1" }]]) {
    const h = pageHarness("development");
    await assert.rejects(h.page({ params: Promise.resolve({ view }), searchParams: Promise.resolve(query) }), (error) => error === h.marker);
    assert.deepEqual(h.calls, []);
  }
});
test("valid development routes read precisely the requested edition once", async () => {
  for (const view of ["overview", "issue", "sources", "search"]) {
    const h = pageHarness("development");
    await h.page({ params: Promise.resolve({ view }), searchParams: Promise.resolve({ edition: "2", ...(view === "search" ? { q: "fictional" } : {}) }) });
    assert.deepEqual(h.calls, [2]);
  }
});
