// Actual fixed Python observer -> in-process GET -> actual component callback.
// No HTTP server, Browser, native database, backup/sync or source operation.
import assert from "node:assert/strict";
import { createCurrentCopyScopeObserver, inspectCurrentCopyScope } from "../src/server/current-copy-scope.ts";
import { copyScopeHarness } from "../tests/helpers/copy_scope_harness.mjs";

const url = "http://127.0.0.1:3000/api/dev/copy-scope";
let reads = 0;
const handle = createCurrentCopyScopeObserver(async () => { reads++; return inspectCurrentCopyScope(); });
const original = globalThis.fetch, observations = [];
const request = method => new Request(url, { method, headers: { "sec-fetch-site": "same-origin" } });
assert.equal((await handle(request("GET"), "production")).status, 404);
assert.equal((await handle(request("POST"), "development")).status, 405); assert.equal(reads, 0);
globalThis.fetch = async (path, options) => {
  assert.equal(path, "/api/dev/copy-scope"); assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  const response = await handle(new Request(url, { method: options.method, signal: options.signal,
    headers: { "sec-fetch-site": "same-origin" } }), "development");
  observations.push(await response.clone().json()); return response;
};
const h = copyScopeHarness();
try {
  h.mount(); assert.equal(reads, 0);
  for (let visit = 0; visit < 2; visit++) {
    if (visit) { h.unmount(); h.mount(); }
    h.button().onClick(); h.button().onClick();
    const deadline = Date.now() + 10_000;
    while (h.button().disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.button().disabled, false); const value = observations[visit];
    assert.equal(value.state, "observed"); assert.equal(value.observation.state, "held");
    assert.equal(value.observation.sourceRequests, 0); assert.equal(value.observation.allCopyPathsVerified, false);
    assert.equal(value.observation.credentialFilesRead, false); assert.equal(value.observation.collectionPermissionIssued, false);
    assert.match(h.markup(), /Observed <time/); assert.match(h.markup(), /Collection held/);
    assert.doesNotMatch(h.markup(), /\/home\/dj|privatePath|policySha256|rclone|runId/);
  }
  assert.equal(reads, 2); assert.notEqual(observations[0].observation.recordedAt, observations[1].observation.recordedAt);
  console.log(JSON.stringify({ evidenceKind: "actual_in_process_current_copy_scope_bridge", pythonObservers: reads,
    clientReads: observations.length, observations: observations.map(value => value.observation), sourceRequests: 0,
    rawBodiesRead: false, credentialFilesRead: false, configurationChanged: false,
    collectionStarted: false, browserVerified: false, httpServerExecuted: false }, null, 2));
} finally { h.unmount(); globalThis.fetch = original; }
