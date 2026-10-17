import assert from "node:assert/strict";
import test from "node:test";
import { loadTsx } from "./helpers/tsx_loader.mjs";
for (const mode of ["current", "retired", "fault"]) test(`custodian ${mode} diagnostic ownership preserves the exact original request failure`, async t => {
  const codes = [], original = new Error("Original controlled request failure"); let calls = 0, checks = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(url, "/api/dev/private-custodian"); assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store"); assert.equal(options.body, undefined); throw original;
  });
  const { requestPrivateCustodianStatus } = loadTsx(new URL("../src/private-custodian-request.ts", import.meta.url),
    name => name === "./client-error-diagnostics.ts" ? { observeClientError: code => codes.push(code) } : undefined);
  await assert.rejects(requestPrivateCustodianStatus("GET", new AbortController().signal, undefined, () => {
    checks++; if (mode === "fault") throw new Error("Private ownership fault"); return mode === "current";
  }), error => error === original);
  assert.equal(calls, 1); assert.equal(checks, 1); assert.deepEqual(codes, mode === "current" ? ["custodian_request"] : []);
});
