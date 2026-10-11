import assert from "node:assert/strict";
import test from "node:test";
import { parseCorrectionReviewOperationStatus, parseSupervisedCorrectionReviewOperationStatus } from "../src/correction-review-operation.ts";
import { createSupervisedCorrectionReviewObserver } from "../src/server/supervised-correction-review-operation.ts";
import { correctionReviewExecution, supervisedCorrectionReviewExecution } from "./helpers/correction_review_execution.mjs";

const url = "http://127.0.0.1:3000/api/dev/supervised-correction-review";
const request = (signal) => new Request(url, { signal, headers: { "sec-fetch-site": "same-origin" } });
const saved = () => ({ state: "checked", result: supervisedCorrectionReviewExecution() });

test("strict supervised result requires all three exact completion controls and refuses cross-contract promotion", () => {
  assert.deepEqual(parseSupervisedCorrectionReviewOperationStatus(saved()), saved());
  assert.throws(() => parseCorrectionReviewOperationStatus(saved()));
  assert.throws(() => parseSupervisedCorrectionReviewOperationStatus({ state: "checked", result: correctionReviewExecution() }));
  for (const changed of [{ workerExitObserved: false }, { custodianRolesRetired: false }, { custodianCloneStopped: false },
    { workerExitObserved: 1 }, { privateReports: true }, { password: "private-canary" }])
    assert.throws(() => parseSupervisedCorrectionReviewOperationStatus({ state: "checked", result: { ...saved().result, ...changed } }));
});

test("supervised observer refuses production, writes, selectors, foreign origins and early cancellation before reading", async () => {
  let reads = 0; const handle = createSupervisedCorrectionReviewObserver(async () => { reads++; return saved(); });
  assert.equal((await handle(request(), "production")).status, 404);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"])
    assert.equal((await handle(new Request(url, { method }), "development")).status, 405);
  for (const denied of [new Request(url + "?journal=private-canary"), new Request(url, { headers: { origin: "https://example.org" } }),
    new Request(url, { headers: { "sec-fetch-site": "cross-site" } })])
    assert.equal((await handle(denied, "development")).status, 403);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await handle(request(cancelled.signal), "development")).status, 409); assert.equal(reads, 0);
});

test("concurrent supervised reads share one observation and the next visit withholds malformed private output", async () => {
  let resolve, reads = 0; const pending = new Promise(done => { resolve = done; });
  const handle = createSupervisedCorrectionReviewObserver(async () => { reads++; return pending; });
  const first = handle(request(), "development"), second = handle(request(), "development");
  await Promise.resolve(); assert.equal(reads, 1); resolve(saved());
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("allow"), "GET");
    assert.deepEqual(await response.json(), saved());
  }
  assert.deepEqual(await (await handle(request(), "development")).json(), saved()); assert.equal(reads, 2);
  let good = true; const fresh = createSupervisedCorrectionReviewObserver(async () => good ? saved() : ({ ...saved(), privatePath: "private-canary" }));
  assert.equal((await (await fresh(request(), "development")).json()).state, "checked"); good = false;
  assert.deepEqual(await (await fresh(request(), "development")).json(), { state: "held", reason: "private_test_unavailable" });
});
