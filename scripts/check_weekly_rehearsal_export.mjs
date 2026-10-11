// Actual read-only local weekly inspector and a simulated explicit download.
// No Browser/document access, server listener, source call or archive mutation.
import assert from "node:assert/strict";
import { createWeeklyRehearsalObserver, inspectWeeklyRehearsal } from "../src/server/weekly-rehearsal-status.ts";
import { readAllFictionalReceipts } from "../src/server/fictional-receipt-store.ts";
import { weeklyStatusHarness } from "../tests/helpers/weekly_status_harness.mjs";

const original = { fetch: globalThis.fetch, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const before = await readAllFictionalReceipts(); let reads = 0, clicked = 0, removed = 0, blob, anchor, status;
const revoked = [], handle = createWeeklyRehearsalObserver(async () => { reads++; return inspectWeeklyRehearsal(); });
globalThis.fetch = async (path, options) => {
  assert.equal(path, "/api/dev/update-rehearsal/status");
  const response = await handle(new Request("http://127.0.0.1:3000" + path, {
    method: options.method, signal: options.signal, headers: { "sec-fetch-site": "same-origin" },
  }), "development"); status = await response.clone().json(); return response;
};
URL.createObjectURL = value => { blob = value; return "blob:simulated-weekly-assessment"; };
URL.revokeObjectURL = value => revoked.push(value);
globalThis.document = { createElement(tag) { assert.equal(tag, "a"); anchor = { click() { clicked++; }, remove() { removed++; } }; return anchor; },
  body: { append(value) { assert.equal(value, anchor); } } };
const ui = weeklyStatusHarness();
try {
  ui.mount(); assert.equal(ui.buttons().length, 1); assert.equal(reads, 0); assert.equal(clicked, 0);
  ui.button().onClick(); const deadline = Date.now() + 10_000;
  while (ui.button().disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ui.button().disabled, false); assert.equal(status.state, "observed"); assert.equal(ui.buttons().length, 2);
  assert.equal(clicked, 0); const download = ui.buttons()[1].onClick; download();
  assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(reads, 1); assert.equal(blob.type, "application/json");
  const assessment = JSON.parse(await blob.text()); assert.deepEqual(assessment.observation, status.observation);
  assert.equal(assessment.historicalObservation, true); assert.equal(assessment.artifactKind, "fictional_weekly_rehearsal_status");
  assert.equal(anchor.download, `terrafracta-weekly-rehearsal-${status.observation.windowKey}.json`);
  assert.match(ui.markup(), /Download requested/); assert.doesNotMatch(ui.markup(), /download completed|file was saved|\/home\/dj|privatePath|fingerprint/);
  ui.unmount(); download(); assert.equal(clicked, 1);
  await new Promise(resolve => setTimeout(resolve, 1_050)); assert.deepEqual(revoked, ["blob:simulated-weekly-assessment"]);
  assert.deepEqual(await readAllFictionalReceipts(), before);
  console.log(JSON.stringify({ evidenceKind: "actual_local_weekly_assessment_simulated_download_bridge",
    pythonObservers: reads, simulatedAnchorClicks: clicked, exportedFilename: anchor.download, assessment,
    receiptInventoryUnchanged: true, archiveWritten: false, sourceRequests: 0, alertsSent: 0,
    actualBrowserDownloadCompleted: false, browserVerified: false, httpServerExecuted: false }, null, 2));
} finally { ui.unmount(); globalThis.fetch = original.fetch; globalThis.document = original.document;
  URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; }
