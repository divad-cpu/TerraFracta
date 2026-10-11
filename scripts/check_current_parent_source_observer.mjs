// Fixed Python comparison -> in-process GET -> actual component callback.
// No HTTP server, Browser, native operation, raw response, worker or source read.
import assert from "node:assert/strict";
import { createCurrentParentSourceObserver, inspectCurrentParentSource } from "../src/server/current-parent-source.ts";
import { parentSourceHarness } from "../tests/helpers/parent_source_harness.mjs";

const url = "http://127.0.0.1:3000/api/dev/parent-source";
let reads = 0;
const handle = createCurrentParentSourceObserver(async () => { reads++; return inspectCurrentParentSource(); });
const original = globalThis.fetch, observations = [];
const request = method => new Request(url, { method, headers: { "sec-fetch-site": "same-origin" } });
assert.equal((await handle(request("GET"), "production")).status, 404);
assert.equal((await handle(request("POST"), "development")).status, 405); assert.equal(reads, 0);
globalThis.fetch = async (path, options) => {
  assert.equal(path, "/api/dev/parent-source"); assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  const response = await handle(new Request(url, { method: options.method, signal: options.signal,
    headers: { "sec-fetch-site": "same-origin" } }), "development");
  observations.push(await response.clone().json()); return response;
};
const ui = parentSourceHarness();
try {
  ui.mount(); assert.equal(reads, 0);
  for (let visit = 0; visit < 2; visit++) {
    if (visit) { ui.unmount(); ui.mount(); }
    ui.button().onClick(); ui.button().onClick();
    const deadline = Date.now() + 10_000;
    while (ui.button().disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ui.button().disabled, false); const value = observations[visit];
    assert.equal(value.state, "observed"); assert.equal(value.observation.comparison, "changed");
    assert.equal(value.observation.preparedFiles, 85); assert.equal(value.observation.matchedFiles, 84);
    assert.equal(value.observation.changedFiles, 1); assert.equal(value.observation.unavailableFiles, 0);
    assert.equal(value.observation.collectionPermissionIssued, false); assert.equal(value.observation.workerExecuted, false);
    assert.match(ui.markup(), /Prepared source files have changed/); assert.match(ui.markup(), /84 matched, 1 changed/);
    assert.doesNotMatch(ui.markup(), /\/home\/dj|privatePath|fingerprint|ssb_execution_inventory|\b[0-9a-f]{64}\b/);
  }
  assert.equal(reads, 2); assert.notEqual(observations[0].observation.recordedAt, observations[1].observation.recordedAt);
  console.log(JSON.stringify({ evidenceKind: "actual_in_process_current_parent_source_comparison_bridge",
    pythonObservers: reads, clientReads: observations.length, observations: observations.map(value => value.observation),
    candidateModulesImported: false, workerExecuted: false, sourceRequests: 0, configurationChanged: false,
    collectionStarted: false, browserVerified: false, httpServerExecuted: false }, null, 2));
} finally { ui.unmount(); globalThis.fetch = original; }
