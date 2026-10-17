import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { currentPreparationHarness as harness } from "./helpers/current_preparation_harness.mjs";

const saved = JSON.parse(readFileSync(new URL("../fixtures/local_private_attempt_readiness_snapshot.json", import.meta.url), "utf8"));
const good = () => ({ state: "observed", observation: { ...saved, evidenceKind: "current_local_preparation_observation", pointInTimeOnly: true,
  recordedAt: "2026-10-03T10:20:00.123456+00:00" } });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("actual user click performs one read; mount and repeated clicks do not add work", async () => {
  const original = globalThis.fetch; let calls = 0, resolve;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, "/api/dev/source-readiness");
    assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store"); assert.ok(!options.body);
    return new Promise(done => { resolve = done; }); };
  const h = harness();
  try {
    h.mount(); assert.equal(calls, 0); h.button().onClick(); h.button().onClick(); assert.equal(calls, 1);
    assert.equal(h.button().disabled, true); assert.match(h.markup(), /Checking local preparation/);
    resolve(Response.json(good())); await settle(); const html = h.markup();
    for (const text of ["Collection held", "Observed <time", "Oslo", "not continuous health monitoring", "Healthy checks cannot grant collection permission"])
      assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /\/home\/dj|privatePath|rclone|credential|<form/); assert.equal(h.button().disabled, false);
  } finally { h.unmount(); globalThis.fetch = original; }
});

test("refresh removes earlier healthy cards; failed or malformed response stays held without private diagnostics", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [Response.json({ ...good(), privatePath: "private-canary" }), new Response("private-canary", { status: 503 }),
      Response.json({ state: "held", reason: "local_observation_unavailable" })]) {
      let first = true, resolve; globalThis.fetch = async () => first ? Response.json(good()) : new Promise(done => { resolve = done; });
      const h = harness();
      try {
        h.mount(); h.button().onClick(); await settle(); assert.match(h.markup(), /Observed <time/); first = false;
        h.button().onClick(); assert.doesNotMatch(h.markup(), /Observed <time|Observed at this check/);
        resolve(response); await settle(); assert.match(h.markup(), /local observation is unavailable/);
        assert.doesNotMatch(h.markup(), /private-canary|Observed at this check/);
      } finally { h.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});

test("old page read is aborted and its late result cannot overwrite the next visit", async () => {
  const original = globalThis.fetch, pending = [];
  globalThis.fetch = async (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const h = harness();
  try {
    h.mount(); h.button().onClick(); h.unmount(); assert.equal(pending[0].signal.aborted, true);
    h.mount(); h.button().onClick(); assert.equal(pending.length, 1); assert.equal(h.button().disabled, true);
    pending[0].resolve(Response.json(good())); await settle();
    assert.doesNotMatch(h.markup(), /Observed <time/);
    h.button().onClick(); pending[1].resolve(Response.json({ state: "held", reason: "local_observation_unavailable" })); await settle();
    assert.match(h.markup(), /local observation is unavailable/); assert.doesNotMatch(h.markup(), /Observed <time/);
  } finally { h.unmount(); globalThis.fetch = original; }
});

test("a new private-preparation mount waits for an ignored-abort predecessor before another GET", async () => {
  const original = globalThis.fetch, pending = [];
  globalThis.fetch = async (_url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal: options.signal }));
  const h = harness();
  try {
    h.mount(); h.button().onClick(); h.remount(); assert.equal(pending[0].signal.aborted, true);
    assert.equal(h.button().disabled, true); h.button().onClick(); assert.equal(pending.length, 1);
    pending[0].resolve(Response.json(good())); await settle();
    assert.doesNotMatch(h.markup(), /Observed <time|Observed at this check/);
    assert.equal(h.button().disabled, false); h.button().onClick(); assert.equal(pending.length, 2);
    pending[1].resolve(Response.json(good())); await settle(); assert.match(h.markup(), /Observed <time/);
  } finally { h.unmount(); globalThis.fetch = original; }
});
