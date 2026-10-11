// Actual fixed local Python reader -> in-process handler -> component callback.
// No HTTP server, Browser, source transport, collection entry or native DB call.
import assert from "node:assert/strict";
import { createCurrentPreparationObserver, inspectCurrentPrivatePreparation } from "../src/server/current-private-preparation.ts";
import { currentPreparationHarness } from "../tests/helpers/current_preparation_harness.mjs";

const url = "http://127.0.0.1:3000/api/dev/source-readiness";
let reads = 0;
const handle = createCurrentPreparationObserver(async () => { reads++; return inspectCurrentPrivatePreparation(); });
const request = (method = "GET") => new Request(url, { method, headers: { "sec-fetch-site": "same-origin" } });
assert.equal((await handle(request(), "production")).status, 404);
assert.equal((await handle(request("POST"), "development")).status, 405); assert.equal(reads, 0);
const original = globalThis.fetch, statuses = [];
globalThis.fetch = async (path, options) => {
  assert.equal(path, "/api/dev/source-readiness"); assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  const response = await handle(new Request(url, { method: options.method, signal: options.signal,
    headers: { "sec-fetch-site": "same-origin" } }), "development");
  statuses.push(await response.clone().json()); return response;
};
const h = currentPreparationHarness();
try {
  h.mount(); assert.equal(reads, 0);
  for (let visit = 0; visit < 2; visit++) {
    if (visit) { h.unmount(); h.mount(); }
    h.button().onClick();
    const deadline = Date.now() + 15_000;
    while (h.button().disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.button().disabled, false); const status = statuses[visit];
    assert.equal(status.state, "observed"); assert.equal(status.observation.state, "held");
    assert.equal(status.observation.sourceRequests, 0); assert.equal(status.observation.collectionPermissionIssued, false);
    assert.match(h.markup(), /Observed <time/); assert.doesNotMatch(h.markup(), /\/home\/dj|privatePath|credential|rclone|runId/);
  }
  assert.equal(reads, 2); assert.notEqual(statuses[0].observation.recordedAt, statuses[1].observation.recordedAt);
  console.log(JSON.stringify({ evidenceKind: "actual_in_process_current_preparation_bridge", pythonObservers: reads,
    clientReads: statuses.length, observations: statuses.map(value => value.observation), sourceRequests: 0,
    rawBodiesRead: false, collectionStarted: false, configurationChanged: false, browserVerified: false }, null, 2));
} finally { h.unmount(); globalThis.fetch = original; }
