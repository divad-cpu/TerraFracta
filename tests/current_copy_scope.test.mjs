import assert from "node:assert/strict";
import test from "node:test";
import { parseCurrentCopyScopeStatus } from "../src/current-copy-scope.ts";
import { createCurrentCopyScopeObserver } from "../src/server/current-copy-scope.ts";

const stamp = "2026-10-03T13:00:00.123456+00:00", now = Date.parse(stamp) + 1000;
export const good = () => ({ state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_copy_scope_observation", recordedAt: stamp,
  pointInTimeOnly: true, state: "held", backupExclusion: "observed", syncSetup: "present",
  otherCopies: "owner_context_pending", allCopyPathsVerified: false, credentialFilesRead: false,
  rawBodiesRead: false, configurationChanged: false, sourceRequests: 0, collectionPermissionIssued: false, publicationEnabled: false,
} });
const url = "http://127.0.0.1:3000/api/dev/copy-scope";
const request = (method = "GET", headers = {}, signal) => new Request(url, { method, signal, headers: { "sec-fetch-site": "same-origin", ...headers } });

test("strict copy contract cannot turn exclusion or missing sync into complete-copy permission", () => {
  assert.deepEqual(parseCurrentCopyScopeStatus(good()), good());
  for (const changes of [{ allCopyPathsVerified: true }, { credentialFilesRead: true }, { rawBodiesRead: true },
    { collectionPermissionIssued: true }, { sourceRequests: false }, { privatePath: "canary" }, { syncSetup: "cleared" },
    { recordedAt: "0000-10-03T13:00:00Z" }, { recordedAt: "2026-10-03T13:00:00.1234567Z" }, { recordedAt: "2026-10-03T15:00:00+02:00" }])
    assert.throws(() => parseCurrentCopyScopeStatus({ state: "observed", observation: { ...good().observation, ...changes } }));
});
test("only fixed local development GET may observe; no client selector enters the probe", async () => {
  let reads = 0; const handle = createCurrentCopyScopeObserver(async () => { reads++; return good(); }, () => now);
  for (const env of ["production", "test", undefined]) assert.equal((await handle(request(), env)).status, 404);
  for (const method of ["POST", "PUT", "HEAD", "DELETE"]) assert.equal((await handle(request(method), "development")).status, 405);
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await handle(request("GET", headers), "development")).status, 403);
  assert.equal((await handle(new Request(url + "?root=canary"), "development")).status, 403);
  const abort = new AbortController(); abort.abort();
  assert.equal((await handle(request("GET", {}, abort.signal), "development")).status, 409); assert.equal(reads, 0);
});
test("concurrent reads share a probe while cancellation and new visits retain their boundaries", async () => {
  let reads = 0, resolve; const handle = createCurrentCopyScopeObserver(async () => { reads++; return new Promise(done => { resolve = done; }); }, () => now);
  const abort = new AbortController(); const a = handle(request("GET", {}, abort.signal), "development"), b = handle(request(), "development");
  await Promise.resolve(); assert.equal(reads, 1); abort.abort(); resolve(good());
  assert.equal((await a).status, 409); const response = await b; assert.deepEqual(await response.json(), good());
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("allow"), "GET");
  const next = handle(request(), "development"); await Promise.resolve(); assert.equal(reads, 2); resolve(good()); await next;
});
test("failed, malformed, stale and future probes discard earlier success and private diagnostics", async () => {
  for (const fault of [async () => { throw new Error("private-canary"); }, async () => ({ ...good(), privatePath: "canary" }),
    async () => ({ state: "observed", observation: { ...good().observation, recordedAt: "2026-10-03T12:00:00Z" } }),
    async () => ({ state: "observed", observation: { ...good().observation, recordedAt: "2026-10-03T14:00:00Z" } })]) {
    let first = true; const handle = createCurrentCopyScopeObserver(() => first ? Promise.resolve(good()) : fault(), () => now);
    assert.deepEqual(await (await handle(request(), "development")).json(), good()); first = false;
    assert.deepEqual(await (await handle(request(), "development")).json(), { state: "held", reason: "copy_observation_unavailable" });
  }
});
