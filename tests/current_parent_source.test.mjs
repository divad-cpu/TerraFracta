import assert from "node:assert/strict";
import test from "node:test";
import { parseCurrentParentSource } from "../src/current-parent-source.ts";
import { createCurrentParentSourceObserver } from "../src/server/current-parent-source.ts";
import { parentSourceHarness } from "./helpers/parent_source_harness.mjs";

const stamp = "2026-10-03T14:00:00.123456+00:00", now = Date.parse(stamp) + 1000;
const good = () => ({ state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_named_parent_source_comparison", recordedAt: stamp,
  preparedAt: "2026-10-03T13:40:22.517416+00:00", pointInTimeOnly: true, preparedFilesOnly: true,
  preparedFiles: 85, comparison: "changed", matchedFiles: 84, changedFiles: 1, unavailableFiles: 0,
  deploymentReviewComplete: false, collectionPermissionIssued: false, candidateModulesImported: false,
  workerExecuted: false, configurationChanged: false, sourceRequests: 0, publicationEnabled: false, scheduleEnabled: false } });
const url = "http://127.0.0.1:3000/api/dev/parent-source";
const request = (method = "GET", headers = {}, signal) => new Request(url, { method, signal, headers: { "sec-fetch-site": "same-origin", ...headers } });

test("source comparison counts, chronology and state cannot imply a complete accepted deployment", () => {
  assert.deepEqual(parseCurrentParentSource(good()), good());
  for (const change of [{ comparison: "matched" }, { matchedFiles: 85 }, { changedFiles: false }, { preparedFiles: 133 },
    { preparedAt: "2026-10-04T00:00:00Z" }, { collectionPermissionIssued: true }, { deploymentReviewComplete: true },
    { sourceRequests: false }, { privatePath: "private-canary" }, { preparedFilesOnly: false }]) {
    assert.throws(() => parseCurrentParentSource({ state: "observed", observation: { ...good().observation, ...change } }));
  }
});

test("fixed development GET refuses selectors, cross-origin and cancelled reads before the observer", async () => {
  let reads = 0; const handle = createCurrentParentSourceObserver(async () => { reads++; return good(); }, () => now);
  for (const env of ["production", "test", undefined]) assert.equal((await handle(request(), env)).status, 404);
  for (const method of ["POST", "PUT", "HEAD", "DELETE"]) assert.equal((await handle(request(method), "development")).status, 405);
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await handle(request("GET", headers), "development")).status, 403);
  assert.equal((await handle(new Request(url + "?pin=canary"), "development")).status, 403);
  const abort = new AbortController(); abort.abort();
  assert.equal((await handle(request("GET", {}, abort.signal), "development")).status, 409); assert.equal(reads, 0);
});

test("coalesced reads cancel independently and later reads observe newly changed code", async () => {
  let reads = 0, resolve; const handle = createCurrentParentSourceObserver(async () => { reads++; return new Promise(done => { resolve = done; }); }, () => now);
  const abort = new AbortController(), first = handle(request("GET", {}, abort.signal), "development"), second = handle(request(), "development");
  await Promise.resolve(); assert.equal(reads, 1); abort.abort(); resolve(good());
  assert.equal((await first).status, 409);
  const response = await second; assert.deepEqual(await response.json(), good());
  assert.equal(response.headers.get("cache-control"), "no-store");
  const later = handle(request(), "development"); await Promise.resolve(); assert.equal(reads, 2);
  resolve({ state: "observed", observation: { ...good().observation, comparison: "unavailable", unavailableFiles: 1, matchedFiles: 83 } });
  assert.equal((await (await later).json()).observation.comparison, "unavailable");
});

test("stale malformed and failed comparisons expose no private diagnostics", async () => {
  for (const inspect of [async () => { throw new Error("private-canary"); }, async () => ({ ...good(), privatePath: "canary" }),
    async () => ({ state: "observed", observation: { ...good().observation, recordedAt: "2026-10-03T13:50:00Z" } }),
    async () => ({ state: "observed", observation: { ...good().observation, recordedAt: "2026-10-03T15:00:00Z" } })]) {
    const handle = createCurrentParentSourceObserver(inspect, () => now);
    assert.deepEqual(await (await handle(request(), "development")).json(), { state: "held", reason: "parent_source_comparison_unavailable" });
  }
});

test("actual source comparison callback starts only on a click and clears earlier results", async () => {
  const original = globalThis.fetch; let reads = 0, resolve;
  globalThis.fetch = async () => { reads++; return new Promise(done => { resolve = done; }); };
  try {
    const ui = parentSourceHarness(); ui.mount(); assert.equal(reads, 0);
    assert.ok(ui.markup().includes("No current source comparison"));
    ui.button().onClick(); ui.button().onClick(); assert.equal(reads, 1);
    resolve(Response.json(good())); await new Promise(done => setTimeout(done, 0));
    assert.ok(ui.markup().includes("Prepared source files have changed"));
    assert.ok(ui.markup().includes("84 matched, 1 changed, 0 unavailable"));
    ui.button().onClick(); assert.ok(!ui.markup().includes("84 matched"));
    resolve(Response.json({ state: "observed", observation: { ...good().observation, comparison: "matched", matchedFiles: 85, changedFiles: 0 } }));
    await new Promise(done => setTimeout(done, 0));
    assert.ok(ui.markup().includes("The prepared file bytes match"));
    assert.ok(ui.markup().includes("does not approve")); ui.unmount();
  } finally { globalThis.fetch = original; }
});

test("unmounted or failed source callbacks never preserve earlier acceptance-looking results", async () => {
  const original = globalThis.fetch; let resolve;
  globalThis.fetch = async () => new Promise(done => { resolve = done; });
  try {
    const ui = parentSourceHarness(); ui.mount(); ui.button().onClick(); ui.unmount();
    resolve(Response.json(good())); await new Promise(done => setTimeout(done, 0));
    assert.ok(!ui.markup().includes("84 matched"));
    const failed = parentSourceHarness(); failed.mount(); failed.button().onClick();
    resolve(Response.json({ ...good(), privatePath: "private-canary" })); await new Promise(done => setTimeout(done, 0));
    assert.ok(failed.markup().includes("current comparison is unavailable"));
    assert.ok(!failed.markup().includes("private-canary")); failed.unmount();
  } finally { globalThis.fetch = original; }
});
