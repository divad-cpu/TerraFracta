import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";

const id = n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const outcome of ["saved", "unavailable"]) test(`server logger preserves its ${outcome} result when deadline cleanup refuses`, async t => {
  let saves = 0;
  const record = createDevelopmentErrorRecorder(async event => { saves++; assert.equal(event.eventId, id(saves)); return outcome; }, () => "development", () => 0);
  t.mock.method(globalThis, "clearTimeout", () => { throw Error("PRIVATE_TIMER_RETIREMENT"); });
  assert.equal(await record("server_route", id(1)), outcome);
  assert.equal(await record("server_route", id(2)), outcome);
  assert.equal(saves, 2);
});

test("server logger caller timeout still retains physical save ownership after cleanup refusal", async t => {
  let expire, finish, saves = 0;
  t.mock.method(globalThis, "setTimeout", callback => { expire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => { throw Error("PRIVATE_TIMER_RETIREMENT"); });
  const record = createDevelopmentErrorRecorder(() => { saves++; return new Promise(resolve => { finish = resolve; }); }, () => "development", () => 0);
  const pending = record("server_route", id(1)); await tick(); expire();
  assert.equal(await pending, "unavailable"); assert.equal(await record("server_route", id(2)), "busy"); assert.equal(saves, 1);
  finish("saved"); await tick();
  const next = record("server_route", id(2)); await tick(); finish("saved"); assert.equal(await next, "saved"); assert.equal(saves, 2);
});

test("actual intake keeps its stored acknowledgement when the supplied server recorder cannot retire its timer", async t => {
  const saved = [];
  const record = createDevelopmentErrorRecorder(async event => { saved.push(event); return "saved"; }, () => "development", () => 0);
  const intake = createDiagnosticIntake(record, () => 0);
  t.mock.method(globalThis, "clearTimeout", () => { throw Error("PRIVATE_TIMER_RETIREMENT"); });
  const req = new Request("http://127.0.0.1/api/dev/error-log", { method: "POST", body: JSON.stringify({ eventId: id(1), code: "browser_runtime" }),
    headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "sec-fetch-site": "same-origin", "content-type": "application/json" } });
  const reply = await intake(req, "development");
  assert.equal(reply.status, 204); assert.equal(await reply.text(), ""); assert.equal(req.body.locked, false);
  assert.equal(saved.length, 1); assert.equal(saved[0].eventId, id(1)); assert.equal(saved[0].code, "browser_runtime");
  assert.deepEqual(Object.keys(saved[0]).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
});
