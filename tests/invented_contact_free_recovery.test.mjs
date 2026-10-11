import assert from "node:assert/strict";
import test from "node:test";
import { planInventedCorrectionRecovery } from "../src/invented-contact-free-recovery.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
const day = 86_400_000, received = Date.parse("2026-01-01T12:00:00.123Z");
const reportId = "b8200000-1111-4111-8111-111111111111", requestId = "b8200000-2222-4222-8222-222222222222";
const reviewerId = "b8200000-3333-4333-8333-333333333333";
const baseTarget = deriveCorrectionTarget({ kind: "issue", issue: connectedInput().issue }).target;
const record = (overrides = {}) => ({ lifecycle: { schemaVersion: 1, reportId, receivedAtMs: received,
  closedAtMs: null, erasedAtMs: null, eraseReason: null }, requestId, target: { ...baseTarget },
  closedReason: null, reviewerId: null, version: 1, ...overrides });
const backup = (records = [{ record: record(), hasPayload: true }], copiedAtMs = received) =>
  ({ schemaVersion: 1, kind: "invented_backup_inventory", copiedAtMs, records });
const latest = (records = [record()], now = received + day) =>
  ({ schemaVersion: 1, kind: "invented_latest_inventory", complete: true, observedAtMs: now, records });
const plan = (old = backup(), current = latest(), now = current.observedAtMs) => planInventedCorrectionRecovery(old, current, now);

test("an unchanged current record preserves only a still-valid original payload lease", () => {
  const result = plan();
  assert.equal(result.kind, "planned"); assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].payload, "keep"); assert.deepEqual(result.actions[0].latestRecord, record());
  assert.doesNotMatch(JSON.stringify(result), /details|sourceUrl|resolution|digest|IP|email/);
});

test("closure after the backup retains latest minimal state and withholds stale free-text resolution", () => {
  const closed = record({ lifecycle: { ...record().lifecycle, closedAtMs: received + day },
    closedReason: "corrected", reviewerId, version: 2 });
  const result = plan(backup(), latest([closed], received + 2 * day));
  assert.equal(result.kind, "planned"); assert.equal(result.actions[0].payload, "remove");
  assert.deepEqual(result.actions[0].latestRecord, closed);
});

test("early erasure in the newest inventory cannot be undone by a report-bearing backup", () => {
  for (const reason of ["reporter_request", "sensitive_material"]) {
    const erased = record({ lifecycle: { ...record().lifecycle, erasedAtMs: received + day, eraseReason: reason }, version: 2 });
    const result = plan(backup(), latest([erased]));
    assert.equal(result.actions[0].payload, "remove");
    assert.equal(result.actions[0].latestRecord.lifecycle.eraseReason, reason);
  }
});

test("an expired seven-day backup loses its payload even when ordinary source access is live", () => {
  assert.equal(plan(backup(), latest(undefined, received + 7 * day - 1)).actions[0].payload, "keep");
  assert.equal(plan(backup(), latest(undefined, received + 7 * day)).actions[0].payload, "remove");
});

test("a nearly expired original payload never gains seven extra days on restore", () => {
  const copied = received + 89 * day;
  const original = backup(undefined, copied);
  assert.equal(plan(original, latest(undefined, received + 90 * day - 1)).actions[0].payload, "keep");
  assert.equal(plan(original, latest(undefined, received + 90 * day)).actions[0].payload, "remove");
});

test("complete latest absence and receipt-bound record expiry remove old references", () => {
  const absent = plan(backup(), latest([]));
  assert.deepEqual(absent.actions, [{ reportId, backupVersion: 1, latestRecord: null, payload: "remove" }]);
  const expired = plan(backup(), latest(undefined, received + 180 * day));
  assert.equal(expired.actions[0].latestRecord, null); assert.equal(expired.actions[0].payload, "remove");
});

test("newer metadata absent from the backup is preserved without inventing lost report text", () => {
  const newer = record({ lifecycle: { ...record().lifecycle, reportId: "b8200000-4444-4444-8444-444444444444", receivedAtMs: received + day },
    requestId: "b8200000-5555-4555-8555-555555555555" });
  const result = plan(backup(), latest([record(), newer]));
  assert.equal(result.actions.length, 2);
  const action = result.actions.find(value => value.reportId === newer.lifecycle.reportId);
  assert.deepEqual(action, { reportId: newer.lifecycle.reportId, backupVersion: null, latestRecord: newer, payload: "remove" });
});

test("missing, incomplete, stale or future context never authorizes a recovery plan", () => {
  for (const [old, current, now] of [[backup(), null, received + day],
    [backup(), { ...latest(), complete: false }, received + day],
    [backup(), latest(), received + day + 1], [backup(), latest(), received],
    [backup(undefined, received + 2 * day), latest(), received + day],
    [backup(), latest(), NaN], [backup(), latest(), "now"]]) {
    assert.deepEqual(plan(old, current, now), { kind: "held" });
  }
});

test("renewed receipt time, reassigned target/request and rollback version or transitions refuse", () => {
  const changed = [record({ requestId: reviewerId }), record({ target: { ...baseTarget, revision: baseTarget.revision + 1 } }),
    record({ lifecycle: { ...record().lifecycle, receivedAtMs: received + 1 } }),
    record({ version: 0 }), record({ lifecycle: { ...record().lifecycle, closedAtMs: received }, closedReason: "corrected", reviewerId })];
  for (const value of changed) assert.deepEqual(plan(backup(), latest([value])), { kind: "held" });
  const closed = record({ lifecycle: { ...record().lifecycle, closedAtMs: received }, closedReason: "corrected", reviewerId, version: 2 });
  assert.deepEqual(plan(backup([{ record: closed, hasPayload: true }]), latest([record({ version: 3 })])), { kind: "held" });
  const erased = record({ lifecycle: { ...record().lifecycle, erasedAtMs: received, eraseReason: "reporter_request" }, version: 2 });
  assert.deepEqual(plan(backup([{ record: erased, hasPayload: false }]), latest([record({ version: 3 })])), { kind: "held" });
});

test("duplicate report or request references, unexpected private fields and invalid original copies refuse", () => {
  const another = record({ lifecycle: { ...record().lifecycle, reportId: "b8200000-4444-4444-8444-444444444444" } });
  for (const [old, current] of [[backup([{ record: record(), hasPayload: true }, { record: record(), hasPayload: false }]), latest()],
    [backup(), latest([record(), another])],
    [backup(), latest([{ ...record(), details: "PRIVATE_CANARY" }])],
    [backup([{ record: { ...record(), payload: "PRIVATE_CANARY" }, hasPayload: true }]), latest()],
    [backup([{ record: record({ lifecycle: { ...record().lifecycle, erasedAtMs: received, eraseReason: "reporter_request" }, version: 2 }), hasPayload: true }]), latest()]]) {
    assert.deepEqual(plan(old, current), { kind: "held" });
  }
});

test("issued recovery plan is detached and hostile accessors yield no exception/body", () => {
  const current = latest(), result = plan(backup(), current);
  current.records[0].target.revision++; current.records[0].lifecycle.receivedAtMs++;
  assert.equal(result.actions[0].latestRecord.target.revision, baseTarget.revision);
  assert.equal(result.actions[0].latestRecord.lifecycle.receivedAtMs, received);
  const hostile = Object.defineProperty({}, "schemaVersion", { get() { throw Error("PRIVATE_CANARY"); } });
  assert.deepEqual(plan(hostile, latest()), { kind: "held" });
});

test("a metadata-only copy never manufactures a payload even under an unchanged live record", () => {
  const result = plan(backup([{ record: record(), hasPayload: false }]), latest());
  assert.equal(result.kind, "planned"); assert.equal(result.actions[0].payload, "remove");
});

test("one request cannot move to another report across complete inventories", () => {
  const reassigned = record({ lifecycle: { ...record().lifecycle,
    reportId: "b8200000-4444-4444-8444-444444444444" } });
  assert.deepEqual(plan(backup(), latest([reassigned])), { kind: "held" });
});

test("new closure and erasure cannot contradict an already captured open inventory", () => {
  const copiedAtMs = received + day;
  const earlier = received + day - 1;
  const closed = record({ lifecycle: { ...record().lifecycle, closedAtMs: earlier },
    closedReason: "corrected", reviewerId, version: 2 });
  const erased = record({ lifecycle: { ...record().lifecycle, erasedAtMs: earlier,
    eraseReason: "reporter_request" }, version: 2 });
  for (const changed of [closed, erased]) {
    assert.deepEqual(plan(backup(undefined, copiedAtMs), latest([changed], received + 2 * day)), { kind: "held" });
  }
  const simultaneous = record({ lifecycle: { ...record().lifecycle, closedAtMs: copiedAtMs },
    closedReason: "corrected", reviewerId, version: 2 });
  assert.equal(plan(backup(undefined, copiedAtMs), latest([simultaneous], received + 2 * day)).kind, "planned");
});

test("a later inventory accessor cannot rewrite a lifecycle already read from a backup", () => {
  const erased = record({ lifecycle: { ...record().lifecycle, erasedAtMs: received,
    eraseReason: "reporter_request" }, version: 2 });
  const old = backup([{ record: erased, hasPayload: false }]);
  const current = latest([record({ version: 2 })]);
  Object.defineProperty(current, "schemaVersion", { get() {
    erased.lifecycle.erasedAtMs = null; erased.lifecycle.eraseReason = null;
    return 1;
  } });
  assert.deepEqual(plan(old, current), { kind: "held" });
});

test("an already erased report cannot acquire a later closure", () => {
  const erased = record({ lifecycle: { ...record().lifecycle, erasedAtMs: received,
    eraseReason: "reporter_request" }, version: 2 });
  const changed = { ...erased, lifecycle: { ...erased.lifecycle, closedAtMs: received + day },
    closedReason: "corrected", reviewerId, version: 3 };
  assert.deepEqual(plan(backup([{ record: erased, hasPayload: false }]), latest([changed])), { kind: "held" });
});

test("two newly observed transitions must permit close then erase, never erase then close", () => {
  for (const [closedOffset, erasedOffset, expected] of [[1, 2, "planned"], [1, 1, "planned"], [2, 1, "held"]]) {
    const changed = record({ lifecycle: { ...record().lifecycle, closedAtMs: received + closedOffset * day,
      erasedAtMs: received + erasedOffset * day, eraseReason: "reporter_request" },
      closedReason: "corrected", reviewerId, version: 3 });
    assert.equal(plan(backup(undefined, received + day), latest([changed], received + 3 * day)).kind, expected);
  }
});
