import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { createCurrentCopyScopeObserver } from "../src/server/current-copy-scope.ts";
import { createCurrentParentSourceObserver } from "../src/server/current-parent-source.ts";
import { createCurrentPreparationObserver } from "../src/server/current-private-preparation.ts";
import { createWeeklyRehearsalObserver } from "../src/server/weekly-rehearsal-status.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";

const stamp = "2026-10-05T06:15:00Z", clock = Date.parse(stamp) + 1_000;
const saved = JSON.parse(await readFile(new URL("../fixtures/local_private_attempt_readiness_snapshot.json", import.meta.url), "utf8"));
const routes = [
  { name: "copy", code: "copy_scope_observer", create: createCurrentCopyScopeObserver, path: "copy-scope", reason: "copy_observation_unavailable", good: () => ({
    state: "observed", observation: { schemaVersion: 1, evidenceKind: "current_local_copy_scope_observation", recordedAt: stamp,
      pointInTimeOnly: true, state: "held", backupExclusion: "observed", syncSetup: "present", otherCopies: "owner_context_pending",
      allCopyPathsVerified: false, credentialFilesRead: false, rawBodiesRead: false, configurationChanged: false,
      sourceRequests: 0, collectionPermissionIssued: false, publicationEnabled: false } }) },
  { name: "parent", code: "parent_source_observer", create: createCurrentParentSourceObserver, path: "parent-source", reason: "parent_source_comparison_unavailable", good: () => ({
    state: "observed", observation: { schemaVersion: 1, evidenceKind: "current_named_parent_source_comparison", recordedAt: stamp,
      preparedAt: "2026-10-05T05:00:00Z", pointInTimeOnly: true, preparedFilesOnly: true, preparedFiles: 4,
      comparison: "changed", matchedFiles: 3, changedFiles: 1, unavailableFiles: 0, deploymentReviewComplete: false,
      collectionPermissionIssued: false, candidateModulesImported: false, workerExecuted: false, configurationChanged: false,
      sourceRequests: 0, publicationEnabled: false, scheduleEnabled: false } }) },
  { name: "preparation", code: "preparation_observer", create: createCurrentPreparationObserver, path: "source-readiness", reason: "local_observation_unavailable", good: () => ({
    state: "observed", observation: { ...structuredClone(saved), evidenceKind: "current_local_preparation_observation", recordedAt: stamp,
      pointInTimeOnly: true } }) },
  { name: "weekly", code: "weekly_status_observer", create: createWeeklyRehearsalObserver, path: "weekly-rehearsal", reason: "weekly_rehearsal_unavailable", good: () => ({
    state: "observed", observation: { schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: stamp,
      dueAt: "2026-10-05T06:00:00Z", windowKey: "2026-W41", graceMinutes: 60, state: "pending", reason: "within_grace_window",
      coverage: "unknown", totalReceipts: 0, unreadableReceipts: 0, pendingReceipts: 0,
      realScheduleEnabled: false, trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0 } }) },
];
const turn = () => new Promise(resolve => setImmediate(resolve));
const request = (route, options = {}) => new Request(`http://127.0.0.1:3000/api/dev/${route.path}`, {
  headers: { "sec-fetch-site": "same-origin" }, ...options,
});
const held = route => ({ state: "held", reason: route.reason });

for (const route of routes) {
  test(`${route.name}: a shared throwing inspector attempts one closed diagnostic and keeps both held responses`, async () => {
    let reads = 0, reject;
    const seen = [], handle = route.create(() => { reads++; return new Promise((_resolve, fail) => { reject = fail; }); },
      () => clock, async (...args) => { seen.push(args); return "saved"; });
    const a = handle(request(route), "development"), b = handle(request(route), "development");
    await turn(); assert.equal(reads, 1); reject(new Error("PRIVATE_CANARY"));
    for (const response of await Promise.all([a, b])) {
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), held(route));
    }
    await turn(); assert.deepEqual(seen, [[route.code]]);
  });
  test(`${route.name}: malformed inspector output logs its technical boundary without leaking data`, async () => {
    const seen = [], handle = route.create(async () => ({ ...route.good(), privatePath: "PRIVATE_CANARY" }), () => clock,
      async (...args) => { seen.push(args); return "saved"; });
    assert.deepEqual(await (await handle(request(route), "development")).json(), held(route));
    await turn(); assert.deepEqual(seen, [[route.code]]);
  });
  test(`${route.name}: valid held/current observations and ordinary freshness refusal are not technical faults`, async () => {
    const stale = route.good(), future = route.good();
    const timeField = route.name === "weekly" ? "observedAt" : "recordedAt";
    stale.observation[timeField] = "2026-10-05T06:14:00Z";
    future.observation[timeField] = "2026-10-05T06:16:00Z";
    for (const input of [held(route), route.good(), stale, future]) {
      const seen = [], handle = route.create(async () => input, () => clock, async code => { seen.push(code); return "saved"; });
      const result = await (await handle(request(route), "development")).json();
      assert.deepEqual(result, input === stale || input === future ? held(route) : input);
      await turn(); assert.deepEqual(seen, []);
    }
  });
  test(`${route.name}: logging throw/rejection/stall cannot delay or replace the failed observation`, async () => {
    for (const record of [() => { throw new Error("PRIVATE_CANARY"); }, async () => { throw new Error("PRIVATE_CANARY"); }, () => new Promise(() => {})]) {
      const handle = route.create(async () => { throw new Error("ORIGINAL_PRIVATE_CANARY"); }, () => clock, record);
      let timeout;
      try {
        const response = await Promise.race([handle(request(route), "development"),
          new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Observer waited for logging")), 300); })]);
        assert.deepEqual(await response.json(), held(route));
      } finally { clearTimeout(timeout); }
      await turn();
    }
  });
  test(`${route.name}: denied and pre-cancelled requests do not inspect or log`, async () => {
    let reads = 0, writes = 0;
    const handle = route.create(async () => { reads++; throw new Error("PRIVATE_CANARY"); }, () => clock, async () => { writes++; return "saved"; });
    const poison = new Proxy({}, { get() { assert.fail("Production inspected the request"); } });
    assert.equal((await handle(poison, "production")).status, 404);
    const abort = new AbortController(); abort.abort();
    assert.equal((await handle(request(route, { signal: abort.signal }), "development")).status, 409);
    assert.equal((await handle(request(route, { method: "POST" }), "development")).status, 405);
    assert.equal((await handle(request(route, { headers: { origin: "https://example.org" } }), "development")).status, 403);
    await turn(); assert.equal(reads, 0); assert.equal(writes, 0);
  });
  test(`${route.name}: a later recovered inspection replaces held without repeating the old diagnostic`, async () => {
    let first = true;
    const seen = [], handle = route.create(async () => { if (first) throw new Error("PRIVATE_CANARY"); return route.good(); }, () => clock,
      async code => { seen.push(code); return "saved"; });
    assert.deepEqual(await (await handle(request(route), "development")).json(), held(route)); first = false;
    assert.deepEqual(await (await handle(request(route), "development")).json(), route.good());
    await turn(); assert.deepEqual(seen, [route.code]);
  });
}

test("actual observer -> private recorder/store -> export -> saved-inspection parser retains only the closed event", { timeout: 1_500 }, async () => {
  const directory = await mkdtemp("/tmp/terrafracta-observer-diagnostic-");
  const store = new ErrorLogStore(join(directory, "log"));
  const record = createDevelopmentErrorRecorder(event => store.append(event), () => "development");
  let saved;
  const settled = new Promise(resolve => { saved = resolve; });
  const handle = createCurrentCopyScopeObserver(async () => { throw new Error("PRIVATE_CANARY"); }, () => clock,
    async code => { const result = await record(code, randomUUID()); saved(result); return result; });
  assert.deepEqual(await (await handle(request(routes[0]), "development")).json(), held(routes[0]));
  assert.equal(await settled, "saved");
  const output = join(directory, "export.json"); await exportErrorLog(join(directory, "log"), output);
  const body = await readFile(output, "utf8"), parsed = readDiagnosticExport(new TextEncoder().encode(body).buffer);
  assert.ok(!body.includes("PRIVATE_CANARY"));
  assert.equal(parsed.events.length, 1); assert.equal(parsed.events[0].code, "copy_scope_observer");
  assert.equal(parsed.captureCompleteness, "unknown");
});

for (const route of routes) {
  test(`${route.name}: midflight caller cancellation is prompt, silent on late success/failure and leaves no abort listener`, async () => {
    for (const fault of [false, true]) {
      let finish, fail, reads = 0, completed = false;
      const wait = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      const seen = [], controller = new AbortController();
      const handle = route.create(() => { reads++; return reads === 1 ? wait : Promise.resolve(route.good()); }, () => clock,
        async code => { seen.push(code); return "saved"; });
      const input = request(route, { signal: controller.signal });
      const pending = handle(input, "development").then(value => { completed = true; return value; });
      await turn(); assert.equal(reads, 1); controller.abort("PRIVATE_CANCEL_CANARY"); await turn();
      assert.equal(completed, true); const value = await pending; assert.equal(value.status, 409);
      assert.deepEqual(await value.json(), { error: "request_cancelled" });
      assert.equal(getEventListeners(input.signal, "abort").length, 0);
      if (fault) fail(Error("PRIVATE_LATE_CANARY")); else finish(route.good());
      await turn(); assert.deepEqual(seen, []);
      assert.deepEqual(await (await handle(request(route), "development")).json(), route.good()); assert.equal(reads, 2);
    }
  });
  test(`${route.name}: a cancelled consumer cannot hide or duplicate a shared fault for active consumers`, async () => {
    let fail, reads = 0; const wait = new Promise((_resolve, reject) => { fail = reject; });
    const seen = [], controller = new AbortController();
    const handle = route.create(() => { reads++; return wait; }, () => clock,
      async (...args) => { seen.push(args); return "saved"; });
    const cancelled = handle(request(route, { signal: controller.signal }), "development");
    const active = [handle(request(route), "development"), handle(request(route), "development")];
    await turn(); controller.abort(); assert.equal((await cancelled).status, 409);
    fail(Error("PRIVATE_SHARED_CANARY"));
    for (const value of await Promise.all(active)) assert.deepEqual(await value.json(), held(route));
    await turn(); assert.equal(reads, 1); assert.deepEqual(seen, [[route.code]]);
  });
  test(`${route.name}: all cancelled consumers keep the inspector slot and a later active consumer can join`, async () => {
    let fail, reads = 0; const wait = new Promise((_resolve, reject) => { fail = reject; });
    const seen = [], a = new AbortController(), b = new AbortController();
    const handle = route.create(() => { reads++; return wait; }, () => clock, async code => { seen.push(code); return "saved"; });
    const first = handle(request(route, { signal: a.signal }), "development"), second = handle(request(route, { signal: b.signal }), "development");
    await turn(); a.abort(); b.abort();
    for (const value of await Promise.all([first, second])) assert.equal(value.status, 409);
    const joined = handle(request(route), "development"); await turn(); assert.equal(reads, 1);
    fail(Error("PRIVATE_JOINED_CANARY")); assert.deepEqual(await (await joined).json(), held(route)); await turn(); assert.deepEqual(seen, [route.code]);
    assert.deepEqual(await (await handle(request(route), "development")).json(), held(route)); await turn(); assert.equal(reads, 2); assert.deepEqual(seen, [route.code, route.code]);
  });
  test(`${route.name}: cancellation at settlement suppresses both parsed success and technical failure`, async () => {
    for (const fault of [false, true]) {
      let finish, fail; const wait = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      const seen = [], controller = new AbortController();
      const handle = route.create(() => wait, () => clock, async code => { seen.push(code); return "saved"; });
      const input = request(route, { signal: controller.signal }), pending = handle(input, "development"); await turn();
      if (fault) fail(Error("PRIVATE_SETTLED_CANARY")); else finish(route.good()); controller.abort();
      const value = await pending; assert.equal(value.status, 409); assert.deepEqual(await value.json(), { error: "request_cancelled" }); await turn();
      assert.deepEqual(seen, []); assert.equal(getEventListeners(input.signal, "abort").length, 0);
    }
  });
  test(`${route.name}: freshness refusal stays ordinary after cancellation repair and active response removes its listener`, async () => {
    const old = route.good(), future = route.good();
    const field = route.name === "weekly" ? "observedAt" : "recordedAt";
    old.observation[field] = "2026-10-05T06:14:00Z"; future.observation[field] = "2026-10-05T06:16:00Z";
    for (const saved of [held(route), route.good(), old, future]) {
      const seen = [], handle = route.create(async () => saved, () => clock, async code => { seen.push(code); return "saved"; });
      const input = request(route), value = await handle(input, "development"); assert.equal(value.status, 200);
      assert.deepEqual(await value.json(), saved === old || saved === future ? held(route) : saved);
      assert.equal(value.headers.get("cache-control"), "no-store"); assert.equal(value.headers.get("allow"), "GET");
      assert.equal(getEventListeners(input.signal, "abort").length, 0); await turn(); assert.deepEqual(seen, []);
    }
  });
}
