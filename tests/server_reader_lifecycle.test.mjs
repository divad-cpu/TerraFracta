import assert from "node:assert/strict";
import test from "node:test";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { createOperatorAuditReader } from "../src/server/operator-audit-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { audit, scope, bytes } from "./helpers/operator_audit_fixture.mjs";
const cases = [
  { name: "public issue", create: createPublicIssueReader, input: () => sample().requestedRoute, data: () => bytes(sample()), held: { status: 503, cacheControl: "no-store" }, success: value => value.status === 200 },
  { name: "operator audit", create: createOperatorAuditReader, input: scope, data: () => bytes(audit()), held: { kind: "unavailable" }, success: value => value.kind === "ok" },
];
for (const item of cases) for (const phase of ["parent-listener", "deadline"]) test(`${item.name} contains ${phase} setup failure before dispatch and exposes only its fixed fault`, async t => {
  const p = new AbortController(), listeners = new Set(), add = p.signal.addEventListener.bind(p.signal), remove = p.signal.removeEventListener.bind(p.signal);
  let calls = 0; const records = [];
  p.signal.addEventListener = (...args) => { listeners.add(args[1]); add(...args); if (phase === "parent-listener") throw Error("PRIVATE_LISTENER_CANARY"); };
  p.signal.removeEventListener = (...args) => { listeners.delete(args[1]); remove(...args); };
  if (phase === "deadline") t.mock.method(globalThis, "setTimeout", () => { throw Error("PRIVATE_TIMER_CANARY"); });
  const read = item.create(async () => { calls++; return item.data(); }, undefined, async code => { records.push(code); return "unavailable"; });
  try {
    assert.deepEqual(await read(item.input(), p.signal), item.held);
    assert.equal(calls, 0); assert.equal(listeners.size, 0); assert.equal(records.length, 1);
    t.mock.restoreAll(); p.signal.addEventListener = add;
    assert.ok(item.success(await read(item.input(), p.signal))); assert.equal(calls, 1);
  } finally { t.mock.restoreAll(); p.abort(); }
});
for (const item of cases) test(`${item.name} independently retires all resources when timer and listener cleanup both refuse`, async t => {
  const p = new AbortController(), timers = new Set(); let observed, removals = 0;
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout, remove = p.signal.removeEventListener.bind(p.signal);
  t.mock.method(globalThis, "setTimeout", (...args) => { const timer = nativeSet(...args); timers.add(timer); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => { timers.delete(timer); nativeClear(timer); throw Error("PRIVATE_CLEANUP_CANARY"); });
  p.signal.removeEventListener = (...args) => { removals++; remove(...args); throw Error("PRIVATE_LISTENER_CANARY"); };
  const read = item.create(async (_, signal) => { observed = signal; return item.data(); }, undefined, async () => assert.fail("A verified result was reported as a fault"));
  try {
    assert.ok(item.success(await read(item.input(), p.signal)));
    assert.equal(observed.aborted, true); assert.equal(removals, 1); assert.equal(timers.size, 0);
  } finally { t.mock.restoreAll(); p.signal.removeEventListener = remove; for (const timer of timers) nativeClear(timer); p.abort(); }
});
