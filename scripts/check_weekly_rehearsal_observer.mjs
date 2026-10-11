// Actual fixed local history -> Python monitor -> in-process GET -> callback.
// No HTTP server, Browser, source request, native operation or archive write.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readAllFictionalReceipts } from "../src/server/fictional-receipt-store.ts";
import { createWeeklyRehearsalObserver, inspectWeeklyRehearsal } from "../src/server/weekly-rehearsal-status.ts";
import { weeklyStatusHarness } from "../tests/helpers/weekly_status_harness.mjs";

const before = await readAllFictionalReceipts();
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const url = "http://127.0.0.1:3000/api/dev/update-rehearsal/status";
let reads = 0;
const handle = createWeeklyRehearsalObserver(async () => { reads++; return inspectWeeklyRehearsal(); });
const request = method => new Request(url, { method, headers: { "sec-fetch-site": "same-origin" } });
assert.equal((await handle(request("GET"), "production")).status, 404);
assert.equal((await handle(request("POST"), "development")).status, 405); assert.equal(reads, 0);
const original = globalThis.fetch, observations = [];
globalThis.fetch = async (path, options) => {
  assert.equal(path, "/api/dev/update-rehearsal/status"); assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  const response = await handle(new Request(url, { method: options.method, signal: options.signal,
    headers: { "sec-fetch-site": "same-origin" } }), "development");
  observations.push(await response.clone().json()); return response;
};
const ui = weeklyStatusHarness();
try {
  ui.mount(); assert.equal(reads, 0);
  for (let visit = 0; visit < 2; visit++) {
    if (visit) { ui.unmount(); ui.mount(); }
    ui.button().onClick(); ui.button().onClick();
    const deadline = Date.now() + 10_000;
    while (ui.button().disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ui.button().disabled, false);
    const value = observations[visit]; assert.equal(value.state, "observed");
    assert.equal(value.observation.totalReceipts, before.totalReceipts);
    assert.equal(value.observation.unreadableReceipts, before.unreadableReceipts);
    assert.equal(value.observation.pendingReceipts, before.pendingReceipts);
    assert.equal(value.observation.realScheduleEnabled, false); assert.equal(value.observation.trustedRunLedger, false);
    assert.equal(value.observation.publicationEnabled, false); assert.equal(value.observation.sourceRequests, 0); assert.equal(value.observation.alertsSent, 0);
    assert.match(ui.markup(), /Observed/); assert.match(ui.markup(), /Fictional history only/);
    assert.doesNotMatch(ui.markup(), /\/home\/dj|privatePath|fingerprint|\b[0-9a-f]{64}\b/);
  }
  assert.equal(reads, 2); assert.notEqual(observations[0].observation.observedAt, observations[1].observation.observedAt);
  const after = await readAllFictionalReceipts(); assert.equal(digest(after), digest(before));
  console.log(JSON.stringify({ evidenceKind: "actual_in_process_weekly_rehearsal_status_bridge",
    pythonObservers: reads, clientReads: observations.length, observations: observations.map(value => value.observation),
    readableInventoryBeforeAfterUnchanged: true, archiveWritten: false, nativeOperationExecuted: false,
    sourceRequests: 0, alertsSent: 0, configurationChanged: false, browserVerified: false, httpServerExecuted: false }, null, 2));
} finally { ui.unmount(); globalThis.fetch = original; }
