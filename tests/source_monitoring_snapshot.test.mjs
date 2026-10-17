import assert from "node:assert/strict";
import test from "node:test";
import { sourceMonitoringSnapshot } from "../src/source-monitoring-snapshot.ts";
import { source, snapshot, attempt, id } from "./helpers/source_monitoring_fixture.mjs";

test("monitoring due, registration and fetch permission are separate dated observations", () => {
  const result = sourceMonitoringSnapshot(snapshot([
    source({ registrationState: "suspended", fetchPermission: "unresolved", dueAt: "2026-10-14T12:00:00.000002Z", lastAttempt: attempt() }),
    source({ registrationId: id(2), sourceKey: "fictional-two", dueAt: null }),
  ]));
  assert.deepEqual(result.rows.map(row => [row.due, row.check]), [["not_due", "complete_unchanged"], ["unknown", "not_recorded"]]);
  assert.equal(result.rows[0].registrationState, "suspended"); assert.equal(result.rows[0].fetchPermission, "unresolved");
  assert.equal(result.counts.suspended, 1); assert.equal(result.counts.permissionUnresolved, 1); assert.equal(result.counts.complete, 1);
});

test("no attempt, complete changed and complete unchanged are three distinct check states", () => {
  for (const [lastAttempt, expected] of [[null, "not_recorded"], [attempt(), "complete_unchanged"], [attempt({ outcome: "changed" }), "complete_changed"]]) {
    const result = sourceMonitoringSnapshot(snapshot([source({ lastAttempt })]));
    assert.equal(result.rows[0].check, expected); assert.equal(result.rows[0].due, "due");
  }
});

test("HTTP success never upgrades unknown or partial unit coverage", () => {
  for (const [lastAttempt, expected] of [[attempt({ expectedUnits: null }), "coverage_unknown"],
    [attempt({ completedUnits: 1, pendingUnits: 1 }), "incomplete"], [attempt({ completedUnits: 1 }), "incomplete"],
    [attempt({ completedUnits: 0, failedUnits: 2 }), "incomplete"]]) {
    const result = sourceMonitoringSnapshot(snapshot([source({ lastAttempt })]));
    assert.equal(result.rows[0].check, expected); assert.equal(result.counts.complete, 0);
  }
});

test("a failed recorded attempt retains partial effects even after a successful HTTP response", () => {
  const result = sourceMonitoringSnapshot(snapshot([source({ lastAttempt: attempt({ outcome: "failed", completedUnits: 1, failedUnits: 1 }) })]));
  assert.equal(result.rows[0].check, "failed"); assert.equal(result.rows[0].lastAttempt.completedUnits, 1);
  assert.equal(result.counts.failed, 1); assert.equal(result.counts.complete, 0);
});

test("microsecond-future checks and impossible calendars withhold the entire snapshot", () => {
  const bad = [snapshot([source({ lastAttempt: attempt({ checkedAt: "2026-10-14T12:00:00.000002Z" }) })]),
    { ...snapshot(), observedAt: "0000-01-01T00:00:00Z" }, { ...snapshot(), observedAt: "2026-02-29T00:00:00Z" },
    snapshot([source({ dueAt: "2026-04-31T00:00:00Z" })]), { ...snapshot(), observedAt: "2026-10-14T12:00:00+01:00" }];
  for (const value of bad) assert.equal(sourceMonitoringSnapshot(value), null);
  assert.notEqual(sourceMonitoringSnapshot({ ...snapshot(), observedAt: "2024-02-29T12:00:00Z" }), null);
});

test("duplicate UUID aliases and source keys are refused atomically", () => {
  for (const second of [source({ registrationId: id(1).toLowerCase(), sourceKey: "other" }), source({ registrationId: id(2) })])
    assert.equal(sourceMonitoringSnapshot(snapshot([source(), second])), null);
});

test("closed input refuses extra privileged fields, invalid enum and unsafe identity", () => {
  for (const changes of [{ sourceKey: "../private" }, { registrationId: "not-an-id" }, { registrationState: "enabled" },
    { fetchPermission: "public_reuse_allowed" }, { qualified: true }, { label: "" }, { label: "x".repeat(161) },
    { lastAttempt: { ...attempt(), secret: "PRIVATE_VALUE" } }, { lastAttempt: attempt({ outcome: "healthy" }) }])
    assert.equal(sourceMonitoringSnapshot(snapshot([source(changes)])), null);
  assert.equal(sourceMonitoringSnapshot({ ...snapshot(), live: true }), null);
});

test("counter bounds and contradictory transport claims never produce a completed label", () => {
  for (const changes of [{ expectedUnits: 0 }, { completedUnits: -1 }, { completedUnits: true }, { failedUnits: 1001 },
    { pendingUnits: 1 }, { httpStatus: 503 }, { httpStatus: 302 }, { outcome: "changed", httpStatus: 304 }])
    assert.equal(sourceMonitoringSnapshot(snapshot([source({ lastAttempt: attempt(changes) })])), null);
  assert.equal(sourceMonitoringSnapshot(snapshot([source({ lastAttempt: attempt({ httpStatus: 304 }) })])).rows[0].check, "complete_unchanged");
  assert.equal(sourceMonitoringSnapshot(snapshot([source({ lastAttempt: attempt({ httpStatus: null }) })])).rows[0].check, "complete_unchanged");
});

test("empty is an admitted empty invented snapshot and missing is unavailable", () => {
  assert.equal(sourceMonitoringSnapshot(null), null);
  const empty = sourceMonitoringSnapshot(snapshot([])); assert.equal(empty.rows.length, 0); assert.equal(empty.counts.complete, 0);
  assert.equal(sourceMonitoringSnapshot(snapshot(Array.from({ length: 51 }, (_, i) => source({ registrationId: id(i + 1), sourceKey: `source-${i}` })))), null);
});

test("checked source text is detached and arbitrary access faults remain opaque", () => {
  const input = snapshot(), result = sourceMonitoringSnapshot(input); input.sources[0].label = "Changed after check";
  assert.equal(result.rows[0].label, "Invented source one");
  assert.equal(sourceMonitoringSnapshot({ get schemaVersion() { throw new Error("PRIVATE_VALUE"); } }), null);
});
