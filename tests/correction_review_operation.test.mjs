import assert from "node:assert/strict";
import test from "node:test";
import { parseCorrectionReviewExecution, parseCorrectionReviewOperationStatus } from "../src/correction-review-operation.ts";
import { createCorrectionReviewObserver, correctionReviewObserverEnvironment } from "../src/server/correction-review-operation.ts";
import { correctionReviewExecution } from "./helpers/correction_review_execution.mjs";

const url = "http://127.0.0.1:3000/api/dev/correction-review";
const request = (method = "GET", headers = {}, signal) => new Request(url, { method, signal,
  headers: { "sec-fetch-site": "same-origin", ...headers } });

test("new retained review contract cannot accept legacy results, live claims, private data or coerced counts", () => {
  const value = correctionReviewExecution(); assert.deepEqual(parseCorrectionReviewExecution(value), value);
  for (const changed of [{ evidenceKind: "fresh_invented_retained_custodian_result" }, { realReports: false },
    { privateReports: true }, { closedReports: 2 }, { liveReviewEnabled: true }, { ownedCloneStopped: false },
    { recordedAt: "2026-10-03T05:01:00.0000001Z" }, { recordedAt: "2026-10-03T07:01:00+02:00" },
    { recordedAt: "0000-10-03T05:01:00Z" }, { reportId: "private-canary" }])
    assert.throws(() => parseCorrectionReviewExecution({ ...value, ...changed }));
  assert.throws(() => parseCorrectionReviewOperationStatus({ state: "checked", result: value, privatePath: "canary" }));
});

test("only local development GET observes; production, private selectors, foreign origins and writes do nothing", async () => {
  let reads = 0; const handle = createCorrectionReviewObserver(async () => { reads++; return { state: "idle" }; });
  for (const environment of ["production", "test", undefined])
    assert.equal((await handle(request(), environment)).status, 404);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"])
    assert.equal((await handle(request(method), "development")).status, 405);
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" }]) assert.equal((await handle(request("GET", headers), "development")).status, 403);
  assert.equal((await handle(new Request(url + "?report=private-canary", { headers: { "sec-fetch-site": "same-origin" } }), "development")).status, 403);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await handle(request("GET", {}, cancelled.signal), "development")).status, 409);
  assert.equal(reads, 0);
});

test("concurrent GET reads coalesce; next visit and a new process read the same retained result", async () => {
  let reads = 0, resolve; const pending = new Promise(done => { resolve = done; });
  const saved = { state: "checked", result: correctionReviewExecution() };
  const handle = createCorrectionReviewObserver(async () => { reads++; return pending; });
  const first = handle(request(), "development"), second = handle(request(), "development");
  await Promise.resolve(); assert.equal(reads, 1); resolve(saved);
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), saved);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("allow"), "GET");
  }
  assert.deepEqual(await (await handle(request(), "development")).json(), saved); assert.equal(reads, 2);
  const restarted = createCorrectionReviewObserver(async () => saved);
  assert.deepEqual(await (await restarted(request(), "development")).json(), saved);
});

test("unavailable and malformed private observations withhold diagnostics and do not expose a cached success", async () => {
  for (const fault of [async () => { throw new Error("private-canary"); },
    async () => ({ state: "checked", result: { ...correctionReviewExecution(), password: "private-canary" } }),
    async () => ({ state: "checked", result: { ...correctionReviewExecution(), liveReviewEnabled: true } })]) {
    let good = true;
    const handle = createCorrectionReviewObserver(async () => good ? { state: "checked", result: correctionReviewExecution() } : fault());
    assert.equal((await (await handle(request(), "development")).json()).state, "checked"); good = false;
    const response = await handle(request(), "development");
    assert.deepEqual(await response.json(), { state: "held", reason: "private_test_unavailable" });
  }
  const running = createCorrectionReviewObserver(async () => ({ state: "running" }));
  assert.equal((await running(request(), "development")).status, 202);
});

test("read-only child environment excludes secrets and interpreter or dotenv injection", () => {
  const result = correctionReviewObserverEnvironment({ PATH: "/trusted/bin", HOME: "/private/home",
    SUPABASE_SERVICE_ROLE_KEY: "private-canary", PYTHONPATH: "/injected", NODE_OPTIONS: "injected", UV_ENV_FILE: "/private/.env" });
  assert.deepEqual(result, { PATH: "/trusted/bin", HOME: "/private/home", NODE_ENV: "development", UV_CACHE_DIR: "/tmp/terrafracta-uv-cache",
    PYTHONDONTWRITEBYTECODE: "1", UV_NO_ENV_FILE: "1" });
  assert.doesNotMatch(JSON.stringify(result), /private-canary|injected|\.env/);
});
