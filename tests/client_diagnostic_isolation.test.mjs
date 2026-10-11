import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { observeClientError, createClientErrorReporter } from "../src/client-error-diagnostics.ts";

const turn = () => new Promise(resolve => setImmediate(resolve));
test("caught-action observer passes only a fixed code and contains throws, rejections and stalled reporters", async () => {
  for (const report of [() => { throw new Error('PRIVATE_CANARY'); }, async () => { throw new Error('PRIVATE_CANARY'); }, () => new Promise(() => {})]) {
    const calls = []; assert.equal(observeClientError('update_export', (...args) => { calls.push(args); return report(...args); }), undefined);
    assert.deepEqual(calls, []); await turn(); assert.deepEqual(calls, [['update_export']]);
  }
});
test("an actual reporter clock fault is contained without starting a send", async () => {
  let sends = 0;
  const report = createClientErrorReporter('development', async () => { sends++; throw new Error('Must not send'); },
    () => '11111111-1111-4111-8111-111111111111', () => { throw new Error('PRIVATE_CLOCK_CANARY'); });
  observeClientError('update_request', report); await turn(); assert.equal(sends, 0);
});
function referenceHarness(report) {
  const file = new URL('../app/error-reference.tsx', import.meta.url), native = createRequire(file), exports = {};
  let reference = null, effect, cleanup; const writes = [];
  const hooks = { useState: () => [reference, value => { reference = value; writes.push(value); }], useEffect: callback => { effect = callback; } };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', code)(name => name === 'react' ? hooks : name.endsWith('client-error-diagnostics') ? { reportClientError: report } : native(name), exports);
  return { render: () => exports.ErrorReference(), writes, mount() { exports.ErrorReference(); cleanup = effect(); }, unmount() { cleanup?.(); } };
}
test("page failure reference contains synchronous and asynchronous logger faults without inventing a saved reference", async () => {
  for (const report of [() => { throw new Error('PRIVATE_CANARY'); }, async () => { throw new Error('PRIVATE_CANARY'); }, () => new Promise(() => {})]) {
    const codes = [], ui = referenceHarness(code => { codes.push(code); return report(code); });
    ui.mount(); await turn(); assert.deepEqual(codes, ['page_render']); assert.deepEqual(ui.writes, []);
    assert.equal(ui.render(), null); ui.unmount();
  }
});
test("page failure reference withholds retired acknowledgements and accepts only the surviving observation", async () => {
  let calls = 0, resolve;
  const retired = referenceHarness(() => { calls++; return Promise.resolve('11111111-1111-4111-8111-111111111111'); });
  retired.mount(); retired.unmount(); await turn(); assert.equal(calls, 0); assert.deepEqual(retired.writes, []);
  const late = referenceHarness(() => new Promise(done => { resolve = done; })); late.mount(); await turn(); late.unmount();
  resolve('11111111-1111-4111-8111-111111111111'); await turn(); assert.deepEqual(late.writes, []);
  const current = referenceHarness(async () => '11111111-1111-4111-8111-111111111111'); current.mount(); await turn();
  assert.deepEqual(current.writes, ['11111111-1111-4111-8111-111111111111']); assert.notEqual(current.render(), null); current.unmount();
});
