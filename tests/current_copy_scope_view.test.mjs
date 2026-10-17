import assert from "node:assert/strict";
import test from "node:test";
import { copyScopeHarness as harness } from "./helpers/copy_scope_harness.mjs";

const good = () => ({ state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_copy_scope_observation", recordedAt: "2026-10-03T13:00:00.123456+00:00",
  pointInTimeOnly: true, state: "held", backupExclusion: "observed", syncSetup: "present",
  otherCopies: "owner_context_pending", allCopyPathsVerified: false, credentialFilesRead: false,
  rawBodiesRead: false, configurationChanged: false, sourceRequests: 0, collectionPermissionIssued: false, publicationEnabled: false,
} });
const settle = () => new Promise(resolve => setImmediate(resolve));
test("mount performs no read; explicit clicks coalesce and render limited dated inference without permission", async () => {
  const original = globalThis.fetch; let calls = 0, resolve;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, "/api/dev/copy-scope"); assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store"); assert.ok(!options.body); return new Promise(done => { resolve = done; }); };
  const h = harness();
  try {
    h.mount(); assert.equal(calls, 0); h.button().onClick(); h.button().onClick(); assert.equal(calls, 1);
    assert.equal(h.button().disabled, true); resolve(Response.json(good())); await settle();
    for (const text of ["Collection held", "Observed <time", "Oslo", "not continuous monitoring", "Its contents were not read", "do not prove", "No complete-copy approval"])
      assert.ok(h.markup().includes(text), text);
    assert.doesNotMatch(h.markup(), /\/home\/dj|privatePath|policySha256|rclone|<form/);
  } finally { h.unmount(); globalThis.fetch = original; }
});
test("refresh clears preceding exclusion; malformed and failed replies stay held with no diagnostics", async () => {
  const original = globalThis.fetch;
  try {
    for (const bad of [Response.json({ ...good(), privatePath: "private-canary" }), new Response("private-canary", { status: 503 }),
      Response.json({ state: "held", reason: "copy_observation_unavailable" })]) {
      let first = true, resolve; globalThis.fetch = async () => first ? Response.json(good()) : new Promise(done => { resolve = done; });
      const h = harness();
      try {
        h.mount(); h.button().onClick(); await settle(); assert.match(h.markup(), /A configured exclusion matched/); first = false;
        h.button().onClick(); assert.doesNotMatch(h.markup(), /Observed <time|A configured exclusion matched/);
        resolve(bad); await settle(); assert.match(h.markup(), /observation is unavailable/); assert.doesNotMatch(h.markup(), /private-canary|A configured exclusion matched/);
      } finally { h.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});
test("old request is aborted and late results cannot overwrite a later visit", async () => {
  const original = globalThis.fetch, pending = [];
  globalThis.fetch = async (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const h = harness();
  try {
    h.mount(); h.button().onClick(); h.unmount(); assert.equal(pending[0].signal.aborted, true);
    h.mount(); h.button().onClick(); assert.equal(pending.length, 1); assert.equal(h.button().disabled, true);
    pending[0].resolve(Response.json(good())); await settle();
    assert.doesNotMatch(h.markup(), /Observed <time/);
    h.button().onClick(); pending[1].resolve(Response.json({ state: "held", reason: "copy_observation_unavailable" })); await settle(); assert.match(h.markup(), /observation is unavailable/);
    assert.doesNotMatch(h.markup(), /Observed <time|A configured exclusion matched/);
  } finally { h.unmount(); globalThis.fetch = original; }
});
test("unsupported exclusion, absent and unavailable sync remain limited holds", async () => {
  const original = globalThis.fetch;
  try {
    for (const state of ["not_found", "unavailable"]) {
      const result = good(); result.observation.backupExclusion = "not_established"; result.observation.syncSetup = state;
      globalThis.fetch = async () => Response.json(result); const h = harness();
      try { h.mount(); h.button().onClick(); await settle(); assert.match(h.markup(), /not established/);
        assert.match(h.markup(), state === "not_found" ? /No entry was found/ : /could not be observed/);
        assert.match(h.markup(), /does not discover every sync/); assert.match(h.markup(), /Collection held/);
      } finally { h.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});

test("a new copy-scope mount waits for an ignored-abort predecessor before another GET", async () => {
  const original = globalThis.fetch, pending = [];
  globalThis.fetch = async (_url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal: options.signal }));
  const h = harness();
  try {
    h.mount(); h.button().onClick(); h.remount(); assert.equal(pending[0].signal.aborted, true);
    assert.equal(h.button().disabled, true); h.button().onClick(); assert.equal(pending.length, 1);
    pending[0].resolve(Response.json(good())); await settle();
    assert.doesNotMatch(h.markup(), /Observed <time|A configured exclusion matched/);
    assert.equal(h.button().disabled, false); h.button().onClick(); assert.equal(pending.length, 2);
    pending[1].resolve(Response.json(good())); await settle(); assert.match(h.markup(), /Observed <time/);
  } finally { h.unmount(); globalThis.fetch = original; }
});
