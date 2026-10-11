import assert from "node:assert/strict";
import test from "node:test";
import { createInventedContactFreeCustody } from "../src/invented-contact-free-custody.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const day = 86_400_000, received = Date.parse("2026-01-01T12:00:00.123Z");
const reportId = "b8200000-1111-4111-8111-111111111111";
const requestId = "b8200000-2222-4222-8222-222222222222";
const reviewerId = "b8200000-3333-4333-8333-333333333333";
const target = () => deriveCorrectionTarget({ kind: "issue", issue: connectedInput().issue }).target;
const fixture = () => ({ lifecycle: { schemaVersion: 1, reportId, receivedAtMs: received,
  closedAtMs: null, erasedAtMs: null, eraseReason: null }, requestId, target: target(),
  payload: { kind: "missing_context", details: "INVENTED_PRIVATE_TEXT_CANARY", sourceUrl: "https://example.org/INVENTED_URL_CANARY", resolution: null },
  closedReason: null, reviewerId: null });
function setup(fixtures = [fixture()]) {
  let now = received;
  const value = createInventedContactFreeCustody(fixtures, () => now);
  assert.equal(value.kind, "ready");
  return { ...value, at(value) { now = value; } };
}
const close = (overrides = {}) => ({ reportId, reviewerId, reason: "unsubstantiated",
  resolution: "INVENTED_RESOLUTION_CANARY", ...overrides });

test("a private read is detached, has the original deadline and exposes no publishing capability", () => {
  const state = setup(), read = state.reviewer.read(reportId);
  assert.equal(read.kind, "private_copy");
  assert.equal(read.expiresAtMs, received + 90 * day);
  read.payload.details = "changed"; read.target.revision++;
  const again = state.reviewer.read(reportId);
  assert.equal(again.payload.details, "INVENTED_PRIVATE_TEXT_CANARY");
  assert.equal(again.target.revision, target().revision);
  assert.deepEqual(Object.keys(state.reviewer).sort(), ["close", "erase", "exportPrivateCopy", "read"]);
  assert.equal(Object.isFrozen(state.reviewer), true);
});

test("expiry removes text and URL and keeps only bounded minimal recovery information", () => {
  const state = setup();
  state.at(received + 90 * day - 1);
  assert.equal(state.reviewer.read(reportId).kind, "private_copy");
  state.at(received + 90 * day);
  assert.deepEqual(state.custodian.sweep(), { kind: "swept", removedPayloads: 1, removedRecords: 0 });
  assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
  const minimal = state.custodian.minimalRecord(reportId);
  assert.equal(minimal.kind, "minimal_record");
  assert.equal(minimal.record.lifecycle.erasedAtMs, received + 90 * day);
  assert.equal(minimal.record.lifecycle.eraseReason, "expired");
  assert.doesNotMatch(JSON.stringify(minimal), /CANARY|details|sourceUrl|resolution|digest|address|email|name/);
  assert.deepEqual(Object.keys(minimal.record).sort(), ["closedReason", "lifecycle", "requestId", "reviewerId", "target", "version"]);
});

test("an overdue startup observation scrubs first and records actual cleanup time", () => {
  const state = setup();
  state.at(received + 95 * day);
  assert.deepEqual(state.reviewer.exportPrivateCopy(reportId), { kind: "held" });
  assert.equal(state.custodian.minimalRecord(reportId).record.lifecycle.erasedAtMs, received + 95 * day);
  state.at(received + 80 * day);
  assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
});

test("closure expires explanation, URL and free-text resolution together after 30 days", () => {
  const state = setup();
  state.at(received + day);
  assert.deepEqual(state.reviewer.close(close()), { kind: "closed_private", reportId });
  assert.equal(state.reviewer.read(reportId).payload.resolution, "INVENTED_RESOLUTION_CANARY");
  assert.equal(state.reviewer.read(reportId).expiresAtMs, received + 31 * day);
  state.at(received + 31 * day);
  assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
  const record = state.custodian.minimalRecord(reportId).record;
  assert.equal(record.closedReason, "unsubstantiated"); assert.equal(record.reviewerId, reviewerId);
  assert.doesNotMatch(JSON.stringify(record), /CANARY|resolution/);
});

test("late closure and repeated decisions never extend expiry or replace the first reviewer", () => {
  const state = setup();
  state.at(received + 89 * day);
  assert.equal(state.reviewer.close(close()).kind, "closed_private");
  assert.equal(state.reviewer.read(reportId).expiresAtMs, received + 90 * day);
  assert.deepEqual(state.reviewer.close(close({ reason: "corrected" })), { kind: "held" });
  assert.equal(state.custodian.minimalRecord(reportId).record.closedReason, "unsubstantiated");
});

test("early erasure is immediate, idempotent, and destroys all report-bearing fields", () => {
  for (const reason of ["reporter_request", "sensitive_material"]) {
    const state = setup(); state.at(received + day);
    assert.deepEqual(state.reviewer.erase({ reportId, reason }), { kind: "erased_private", reportId });
    const first = state.custodian.minimalRecord(reportId);
    assert.equal(first.record.lifecycle.eraseReason, reason);
    state.at(received + 2 * day);
    assert.equal(state.reviewer.erase({ reportId, reason }).kind, "erased_private");
    assert.deepEqual(state.custodian.minimalRecord(reportId), first);
    assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
    assert.deepEqual(state.reviewer.close(close()), { kind: "held" });
    assert.deepEqual(state.custodian.backup(reportId), { kind: "held" });
  }
});

test("minimal records are removed at 180 days, including closed and erased records", () => {
  const state = setup();
  state.reviewer.close(close()); state.reviewer.erase({ reportId, reason: "reporter_request" });
  state.at(received + 180 * day - 1);
  assert.equal(state.custodian.minimalRecord(reportId).kind, "minimal_record");
  state.at(received + 180 * day);
  assert.deepEqual(state.custodian.sweep(), { kind: "swept", removedPayloads: 0, removedRecords: 1 });
  assert.deepEqual(state.custodian.minimalRecord(reportId), { kind: "held" });
});

test("a current issued backup recovers simulated payload loss without renewing its deadline", () => {
  const state = setup(), copy = state.custodian.backup(reportId);
  assert.equal(copy.kind, "private_backup"); assert.equal(copy.expiresAtMs, received + 7 * day);
  assert.equal(Object.isFrozen(copy.backup.payload), true);
  assert.throws(() => { copy.backup.payload.details = "forged"; }, TypeError);
  state.at(received + day);
  state.custodian.losePayloadForTrial(reportId);
  assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
  assert.deepEqual(state.custodian.restore(copy.backup), { kind: "restored_private", reportId });
  assert.equal(state.reviewer.read(reportId).expiresAtMs, received + 90 * day);
  assert.deepEqual(state.custodian.restore(copy.backup), { kind: "held" });
});

test("decoded, edited, unknown-owner and expired backups cannot restore payloads", () => {
  const state = setup(), copy = state.custodian.backup(reportId);
  state.custodian.losePayloadForTrial(reportId);
  for (const input of [null, structuredClone(copy.backup), { ...copy.backup, version: 2 },
    { ...copy.backup, payload: { ...copy.backup.payload, details: "FORGED_CANARY" } }]) {
    assert.deepEqual(state.custodian.restore(input), { kind: "held" });
  }
  const other = setup(); other.custodian.losePayloadForTrial(reportId);
  assert.deepEqual(other.custodian.restore(copy.backup), { kind: "held" });
  state.at(received + 7 * day);
  assert.deepEqual(state.custodian.restore(copy.backup), { kind: "held" });
  assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
});

test("latest closure, erasure or missing context always overrides a report-bearing backup", () => {
  for (const transition of ["close", "erase", "unknown", "forget"]) {
    const state = setup(), copy = state.custodian.backup(reportId);
    state.at(received + day);
    if (transition === "close") state.reviewer.close(close());
    if (transition === "erase") state.reviewer.erase({ reportId, reason: "reporter_request" });
    if (transition === "unknown") state.custodian.loseContextForTrial();
    if (transition === "forget") state.at(received + 180 * day);
    state.custodian.losePayloadForTrial(reportId);
    assert.deepEqual(state.custodian.restore(copy.backup), { kind: "held" });
    assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
  }
});

test("invalid, throwing and backward clocks expose no private body or exception", () => {
  for (const value of [NaN, Infinity, -1, 1.1, received - 1, "now", null]) {
    const state = setup(); state.at(value);
    assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
    assert.deepEqual(state.custodian.minimalRecord(reportId), { kind: "held" });
    assert.deepEqual(state.reviewer.close(close()), { kind: "held" });
  }
  const state = createInventedContactFreeCustody([fixture()], () => { throw Error("CLOCK_CANARY"); });
  assert.deepEqual(state.reviewer.read(reportId), { kind: "held" });
});

test("unsupported fixture authority, ambiguous identities and silently trimmed stored text refuse", () => {
  for (const fixtures of [null, [fixture(), fixture()], [{ ...fixture(), ip: "PRIVATE_IP_CANARY" }],
    [{ ...fixture(), payload: { ...fixture().payload, details: "  INVENTED_PRIVATE_TEXT_CANARY  " } }],
    [{ ...fixture(), payload: { ...fixture().payload, sourceUrl: " https://example.org/ " } }],
    [{ ...fixture(), closedReason: "corrected" }],
    [{ ...fixture(), payload: { ...fixture().payload, resolution: "unclosed" } }],
    [{ ...fixture(), lifecycle: { ...fixture().lifecycle, reportId: "not-an-id" } }]]) {
    assert.deepEqual(createInventedContactFreeCustody(fixtures, () => received), { kind: "held" });
  }
  const hostile = Object.defineProperty({}, "payload", { get() { throw Error("INPUT_CANARY"); } });
  assert.deepEqual(createInventedContactFreeCustody([hostile], () => received), { kind: "held" });
});

test("fixture mutation and detached minimal observations cannot modify authority", () => {
  const input = fixture(), state = setup([input]);
  input.payload.details = "forged"; input.lifecycle.erasedAtMs = received;
  const record = state.custodian.minimalRecord(reportId); record.record.lifecycle.receivedAtMs = 0;
  assert.equal(state.reviewer.read(reportId).payload.details, "INVENTED_PRIVATE_TEXT_CANARY");
  assert.equal(state.custodian.minimalRecord(reportId).record.lifecycle.receivedAtMs, received);
});

test("malformed review actions withhold private data and cannot assign public or lifecycle authority", () => {
  const state = setup();
  for (const input of [null, { ...close(), publish: true }, { ...close(), closedAtMs: 0 },
    close({ reviewerId: "not-an-id" }), close({ reason: "publish_now" }), close({ resolution: "x".repeat(1001) })]) {
    assert.deepEqual(state.reviewer.close(input), { kind: "held" });
  }
  for (const input of [null, { reportId, reason: "expired" }, { reportId, reason: "reporter_request", ip: "CANARY" }]) {
    assert.deepEqual(state.reviewer.erase(input), { kind: "held" });
  }
  assert.equal(state.reviewer.read(reportId).kind, "private_copy");
});

test("context lost during a clock callback withholds the in-progress private read", () => {
  let model;
  model = createInventedContactFreeCustody([fixture()], () => {
    model.custodian.loseContextForTrial(); return received;
  });
  assert.deepEqual(model.reviewer.read(reportId), { kind: "held" });
  assert.deepEqual(model.custodian.minimalRecord(reportId), { kind: "held" });
});

test("a clock callback cannot reenter custody to erase or expose another private copy", () => {
  let model, read, erase;
  model = createInventedContactFreeCustody([fixture()], () => {
    read = model.reviewer.read(reportId);
    erase = model.reviewer.erase({ reportId, reason: "reporter_request" });
    return received;
  });
  assert.equal(model.reviewer.read(reportId).kind, "private_copy");
  assert.deepEqual(read, { kind: "held" }); assert.deepEqual(erase, { kind: "held" });
});
