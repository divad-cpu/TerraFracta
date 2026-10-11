import assert from "node:assert/strict";
import test from "node:test";
import { createInventedContactFreeAdmission } from "../src/invented-contact-free-admission.ts";
const minute = 60_000, day = 86_400_000, window = 15 * minute;
const start = 4 * window + minute;
const key = n => `c8300000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
function setup(overrides = {}) {
  let now = start;
  const model = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0,
    acceptedAtMs: [], ...overrides }, () => now);
  assert.equal(model.kind, "ready");
  return { ...model, at(value) { now = value; }, begin(n = 1, bodyBytes = 100) {
    return model.writer.begin({ epoch: Math.floor(now / window), currentKey: key(n), previousKey: key(n + 10000), bodyBytes });
  } };
}

test("two atomic reservations limit concurrent admissions, and only known nonwrites release them", () => {
  const state = setup(), first = state.begin(1), second = state.begin(2);
  assert.equal(first.kind, "reserved"); assert.equal(second.kind, "reserved");
  assert.deepEqual(state.begin(3), { kind: "held", reason: "busy" });
  assert.deepEqual(state.writer.settle(first.token, "not_written"), { kind: "released" });
  assert.equal(state.begin(3).kind, "reserved");
  assert.equal(state.inspection.counts().reserved, 2);
});

test("an uncertain writer result keeps its reservation and never allows automatic replay", () => {
  for (const final of ["accepted", "not_written"]) {
    const state = setup(), ticket = state.begin();
    assert.deepEqual(state.writer.settle(ticket.token, "unknown"), { kind: "uncertain" });
    state.at(start + 2 * 60 * minute);
    assert.deepEqual(state.begin(50), { kind: "held", reason: "uncertain" });
    assert.deepEqual(state.writer.settle(ticket.token, final), { kind: "held", reason: "invalid_context" });
    assert.deepEqual(state.recovery.resolve(ticket.token, "unknown"), { kind: "held", reason: "invalid_context" });
    assert.equal(state.inspection.counts().reserved, 1);
    assert.equal(state.recovery.resolve(ticket.token, final).kind, final === "accepted" ? "counted_accepted" : "released");
    assert.equal(state.inspection.counts().reserved, 0);
    assert.equal(state.begin(51).kind, "reserved");
  }
});

test("invalid and foreign tickets cannot settle, recover or change a counter", () => {
  const state = setup(), ticket = state.begin(), other = setup();
  for (const token of [null, {}, structuredClone(ticket.token), other.begin().token]) {
    assert.deepEqual(state.writer.settle(token, "accepted"), { kind: "held", reason: "invalid_context" });
  }
  assert.deepEqual(state.writer.settle(ticket.token, "private_body_CANARY"), { kind: "held", reason: "invalid_context" });
  assert.equal(state.inspection.counts().reserved, 1);
  const accepted = state.writer.settle(ticket.token, "accepted");
  assert.equal(accepted.kind, "counted_accepted");
  assert.deepEqual(state.writer.settle(ticket.token, "accepted"), { kind: "held", reason: "invalid_context" });
  assert.deepEqual(state.reviewer.closeCountedReport({}), { kind: "held", reason: "invalid_context" });
  assert.equal(state.reviewer.closeCountedReport(accepted.report).kind, "counted_closed");
  assert.deepEqual(state.reviewer.closeCountedReport(accepted.report), { kind: "held", reason: "invalid_context" });
  assert.equal(state.inspection.counts().openReports, 0);
});

test("five attempts includes rejected oversized bodies and keeps no body or network fields", () => {
  const state = setup();
  for (let i = 0; i < 5; i++) assert.deepEqual(state.begin(1, 16_385), { kind: "held", reason: "body_limit" });
  assert.deepEqual(state.begin(), { kind: "held", reason: "address_limit" });
  state.at(start + window);
  const request = { epoch: 5, currentKey: key(2), previousKey: key(1), bodyBytes: 16_384 };
  assert.equal(state.writer.begin(request).kind, "reserved");
  assert.doesNotMatch(JSON.stringify(state.inspection.counts()), /c830|body|ip|addressKey|CANARY/);
});

test("rotation preserves the sliding window across the epoch boundary and expires identifiers within 30 minutes", () => {
  const state = setup();
  state.at(5 * window - 1);
  for (let i = 0; i < 5; i++) state.begin(1, 16_385);
  state.at(5 * window);
  const next = { epoch: 5, currentKey: key(2), previousKey: key(1), bodyBytes: 100 };
  assert.deepEqual(state.writer.begin(next), { kind: "held", reason: "address_limit" });
  state.at(6 * window - 1);
  const ticket = state.writer.begin(next);
  assert.equal(ticket.kind, "reserved");
  state.writer.settle(ticket.token, "not_written");
  assert.equal(state.inspection.counts().addressBuckets, 2);
  state.at(6 * window);
  assert.equal(state.inspection.counts().addressBuckets, 1);
  state.at(7 * window);
  assert.equal(state.inspection.counts().addressBuckets, 0);
});

test("sixty hourly acceptances include reserved capacity and use the exact rolling boundary", () => {
  const state = setup({ acceptedAtMs: Array(59).fill(start) });
  const first = state.begin(1);
  assert.equal(first.kind, "reserved");
  assert.deepEqual(state.begin(2), { kind: "held", reason: "global_limit" });
  assert.equal(state.writer.settle(first.token, "accepted").kind, "counted_accepted");
  state.at(start + 60 * minute - 1);
  assert.deepEqual(state.begin(3), { kind: "held", reason: "global_limit" });
  state.at(start + 60 * minute);
  assert.equal(state.begin(4).kind, "reserved");
  assert.equal(state.inspection.counts().acceptedInHour, 0);
});

test("200 open reports include reservations, and closure releases only the owned accepted report", () => {
  const state = setup({ openReports: 199 }), ticket = state.begin(1);
  assert.deepEqual(state.begin(2), { kind: "held", reason: "open_limit" });
  const recorded = state.writer.settle(ticket.token, "accepted");
  assert.equal(state.inspection.counts().openReports, 200);
  assert.deepEqual(state.begin(3), { kind: "held", reason: "open_limit" });
  assert.equal(state.reviewer.closeCountedReport(recorded.report).kind, "counted_closed");
  assert.equal(state.begin(4).kind, "reserved");
});

test("unknown or lost limiter context stays closed even after clocks and windows advance", () => {
  const state = setup(), token = state.begin().token;
  state.recovery.invalidateForTrial(); state.at(start + 180 * day);
  for (const result of [state.begin(), state.writer.settle(token, "not_written"),
    state.recovery.resolve(token, "accepted"), state.inspection.counts()]) {
    assert.deepEqual(result, { kind: "held", reason: "invalid_context" });
  }
  assert.deepEqual(createInventedContactFreeAdmission({ kind: "restarted" }, () => start), { kind: "held", reason: "invalid_context" });
});

test("invalid keys, epochs, clocks, fixtures and private authority refuse without leaking inputs", () => {
  const state = setup();
  const valid = { epoch: 4, currentKey: key(1), previousKey: key(2), bodyBytes: 100 };
  for (const input of [null, {}, { ...valid, body: "BODY_CANARY" }, { ...valid, address: "IP_CANARY" },
    { ...valid, epoch: 3 }, { ...valid, currentKey: key(2) }, { ...valid, bodyBytes: -1 }]) {
    assert.deepEqual(state.writer.begin(input), { kind: "held", reason: "invalid_context" });
  }
  for (const now of [NaN, Infinity, -1, 1.5, "now", null]) {
    state.at(now); assert.deepEqual(state.writer.begin(valid), { kind: "held", reason: "invalid_clock" });
  }
  state.at(start); assert.equal(state.begin().kind, "reserved");
  state.at(start - 1); assert.deepEqual(state.begin(), { kind: "held", reason: "invalid_clock" });
  const future = setup({ acceptedAtMs: [start + 1] });
  assert.deepEqual(future.begin(), { kind: "held", reason: "invalid_clock" });
  for (const input of [null, { kind: "fresh_invented_trial", openReports: 201, acceptedAtMs: [] },
    { kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [], rawIP: "CANARY" }]) {
    assert.deepEqual(createInventedContactFreeAdmission(input, () => start), { kind: "held", reason: "invalid_context" });
  }
});

test("clock reentry cannot reserve extra work, and context loss during a callback withholds admission", () => {
  let model, reentered;
  const input = { epoch: 4, currentKey: key(1), previousKey: key(2), bodyBytes: 100 };
  model = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => {
    reentered = model.writer.begin(input); return start;
  });
  assert.equal(model.writer.begin(input).kind, "reserved");
  assert.deepEqual(reentered, { kind: "held", reason: "invalid_clock" });
  let second;
  second = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => {
    second.recovery.invalidateForTrial(); return start;
  });
  assert.deepEqual(second.writer.begin(input), { kind: "held", reason: "invalid_context" });
});

test("temporary bucket exhaustion holds new clients and never evicts active rate history", () => {
  const state = setup();
  for (let i = 1; i <= 400; i++) assert.equal(state.begin(i, 16_385).reason, "body_limit");
  assert.deepEqual(state.begin(401), { kind: "held", reason: "capacity" });
  for (let i = 0; i < 4; i++) state.begin(1, 16_385);
  assert.equal(state.begin(1).reason, "address_limit");
  state.at(6 * window);
  assert.equal(state.inspection.counts().addressBuckets, 0);
  assert.equal(state.begin(401).kind, "reserved");
});

test("counted report capability ends at the minimal-record maximum without resetting global limits", () => {
  const state = setup(), token = state.begin().token;
  const counted = state.writer.settle(token, "accepted");
  state.at(start + 180 * day);
  assert.equal(state.inspection.counts().openReports, 0);
  assert.deepEqual(state.reviewer.closeCountedReport(counted.report), { kind: "held", reason: "invalid_context" });
});

for (const recovery of [false, true]) test(`${recovery ? "Unknown recovery" : "Late settlement"} cannot renew an admission-bound reference`, () => {
  const state = setup(), token = state.begin().token;
  if (recovery) state.writer.settle(token, "unknown");
  state.at(start + 180 * day);
  const result = recovery ? state.recovery.resolve(token, "accepted") : state.writer.settle(token, "accepted");
  assert.equal(result.kind, "counted_accepted");
  assert.equal(state.inspection.counts().acceptedInHour, 1); // Conservative current-hour accounting remains.
  assert.equal(state.inspection.counts().openReports, 0);
  assert.equal(state.inspection.counts().reserved, 0);
  assert.deepEqual(state.reviewer.closeCountedReport(result.report), { kind: "held", reason: "invalid_context" });
});
