import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCurrentPreparationStatus } from "../src/current-private-preparation.ts";
import { createCurrentPreparationObserver } from "../src/server/current-private-preparation.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/local_private_attempt_readiness_snapshot.json", import.meta.url), "utf8"));
const stamp = "2026-10-03T10:18:00.123456+00:00", now = Date.parse(stamp) + 1000;
const good = () => ({ state: "observed", observation: { ...structuredClone(saved), evidenceKind: "current_local_preparation_observation", recordedAt: stamp, pointInTimeOnly: true } });
const url = "http://127.0.0.1:3000/api/dev/source-readiness";
const request = (method = "GET", headers = {}, signal) => new Request(url, { method, signal, headers: { "sec-fetch-site": "same-origin", ...headers } });

test("current status cannot accept a saved result, selectors, coerced fields or permission claims", () => {
  assert.deepEqual(parseCurrentPreparationStatus(good()), good());
  for (const changes of [{ evidenceKind: saved.evidenceKind }, { privatePath: "canary" }, { sourceRequests: false },
    { collectionPermissionIssued: true }, { state: "ready" }, { pointInTimeOnly: false }, { recordedAt: "2026-10-03T10:18:00.1234567Z" },
    { recordedAt: "0000-10-03T10:18:00Z" }, { recordedAt: "2026-10-03T12:18:00+02:00" }])
    assert.throws(() => parseCurrentPreparationStatus({ state: "observed", observation: { ...good().observation, ...changes } }));
  const reordered = good(); [reordered.observation.checks[0], reordered.observation.checks[1]] = [reordered.observation.checks[1], reordered.observation.checks[0]];
  assert.throws(() => parseCurrentPreparationStatus(reordered));
});

test("only a local development GET starts a read-only observation", async () => {
  let reads = 0; const handle = createCurrentPreparationObserver(async () => { reads++; return good(); }, () => now);
  for (const env of ["production", "test", undefined]) assert.equal((await handle(request(), env)).status, 404);
  for (const method of ["POST", "DELETE", "PUT", "HEAD"]) assert.equal((await handle(request(method), "development")).status, 405);
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await handle(request("GET", headers), "development")).status, 403);
  assert.equal((await handle(new Request(url + "?root=private-canary", { headers: { "sec-fetch-site": "same-origin" } }), "development")).status, 403);
  const abort = new AbortController(); abort.abort();
  assert.equal((await handle(request("GET", {}, abort.signal), "development")).status, 409); assert.equal(reads, 0);
});

test("parallel reads coalesce and refresh is uncached; cancelled readers cannot receive a success", async () => {
  let reads = 0, resolve; const pending = new Promise(done => { resolve = done; });
  const handle = createCurrentPreparationObserver(async () => { reads++; return pending; }, () => now);
  const abort = new AbortController();
  const a = handle(request("GET", {}, abort.signal), "development"), b = handle(request(), "development");
  await Promise.resolve(); assert.equal(reads, 1); abort.abort(); resolve(good());
  assert.equal((await a).status, 409); const response = await b;
  assert.deepEqual(await response.json(), good()); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("allow"), "GET"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  await handle(request(), "development"); assert.equal(reads, 2);
});

test("stale, future, malformed and failed probes withhold an earlier success and private diagnostics", async () => {
  for (const fault of [async () => ({ ...good(), privatePath: "canary" }), async () => { throw new Error("private-canary"); },
    async () => ({ state: "observed", observation: { ...good().observation, recordedAt: "2026-10-03T09:00:00Z" } }),
    async () => ({ state: "observed", observation: { ...good().observation, recordedAt: "2026-10-03T11:00:00Z" } })]) {
    let first = true;
    const handle = createCurrentPreparationObserver(() => first ? Promise.resolve(good()) : fault(), () => now);
    assert.deepEqual(await (await handle(request(), "development")).json(), good()); first = false;
    assert.deepEqual(await (await handle(request(), "development")).json(), { state: "held", reason: "local_observation_unavailable" });
  }
});
