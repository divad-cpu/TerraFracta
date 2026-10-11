import assert from "node:assert/strict";
import test from "node:test";
import { contactFreeCorrectionPolicy as limits, planCorrectionRetention,
  observeCorrectionRetention, observeCorrectionBackup } from "../src/contact-free-correction-policy.ts";

const day = 86_400_000;
const received = Date.parse("2026-01-01T12:34:56.789Z");
const lifecycle = (overrides = {}) => ({ schemaVersion: 1, reportId: "a8100000-1111-4111-8111-111111111111",
  receivedAtMs: received, closedAtMs: null, erasedAtMs: null, eraseReason: null, ...overrides });

test("accepted limits are fixed and cannot be enlarged by a caller", () => {
  assert.equal(limits.payloadLifetimeMs, 90 * day);
  assert.equal(limits.closedPayloadLifetimeMs, 30 * day);
  assert.equal(limits.recordLifetimeMs, 180 * day);
  assert.equal(limits.backupLifetimeMs, 7 * day);
  assert.equal(limits.bodyBytes, 16_384);
  assert.equal(limits.concurrentAdmissions, 2);
  assert.equal(limits.attemptsPerAddress, 5);
  assert.equal(limits.acceptedPerHour, 60);
  assert.equal(limits.openReports, 200);
  assert.throws(() => { limits.openReports = 201; }, TypeError);
});

test("an unresolved report loses payload access at exactly 90 elapsed UTC days", () => {
  for (const [now, expected] of [[received + 90 * day - 1, "available"],
    [received + 90 * day, "expired"], [received + 180 * day, "expired"]]) {
    const result = observeCorrectionRetention(lifecycle(), now);
    assert.equal(result.kind, "observed"); assert.equal(result.payloadAccess, expected);
    assert.equal(result.payloadExpiresAtMs, Date.parse("2026-04-01T12:34:56.789Z"));
  }
});

test("early closure shortens access; late closure can never extend receipt expiry", () => {
  for (const [closedDay, expectedDay] of [[0, 30], [10, 40], [60, 90], [89, 90], [100, 90]]) {
    const value = lifecycle({ closedAtMs: received + closedDay * day });
    assert.equal(planCorrectionRetention(value).payloadExpiresAtMs, received + expectedDay * day);
    const at = Math.max(closedDay, expectedDay) * day + received;
    assert.equal(observeCorrectionRetention(value, at).payloadAccess, "expired");
  }
});

test("minimal records have a separate fixed receipt-bound deadline", () => {
  const value = lifecycle({ closedAtMs: received + day });
  assert.equal(observeCorrectionRetention(value, received + 180 * day - 1).recordAccess, "available");
  assert.equal(observeCorrectionRetention(value, received + 180 * day).recordAccess, "expired");
});

test("explicit early removal restricts payload immediately without renewing minimal records", () => {
  for (const reason of ["reporter_request", "sensitive_material"]) {
    const value = lifecycle({ erasedAtMs: received + day, eraseReason: reason });
    const result = observeCorrectionRetention(value, received + day);
    assert.equal(result.payloadAccess, "expired"); assert.equal(result.recordAccess, "available");
    assert.equal(result.recordExpiresAtMs, received + 180 * day);
  }
});

test("unsupported or inconsistent private context is opaque and held", () => {
  for (const value of [null, [], {}, { ...lifecycle(), details: "PRIVATE_CANARY" },
    lifecycle({ receivedAtMs: NaN }), lifecycle({ closedAtMs: received - 1 }),
    lifecycle({ erasedAtMs: received - 1, eraseReason: "sensitive_material" }),
    lifecycle({ erasedAtMs: received, eraseReason: null }),
    lifecycle({ eraseReason: "reporter_request" }), lifecycle({ eraseReason: "keep_forever" }),
    lifecycle({ erasedAtMs: received + day, eraseReason: "expired" }),
    lifecycle({ receivedAtMs: Number.MAX_SAFE_INTEGER }),
    lifecycle({ reportId: "A8100000-1111-4111-8111-111111111111" })]) {
    assert.deepEqual(planCorrectionRetention(value), { kind: "held", reason: "invalid_context" });
  }
  const hostile = Object.defineProperty({}, "schemaVersion", { enumerable: true,
    get() { throw Error("PRIVATE_CANARY"); } });
  assert.deepEqual(planCorrectionRetention(hostile), { kind: "held", reason: "invalid_context" });
});

test("invalid or backward clocks and future transitions withhold all access", () => {
  for (const now of [undefined, null, NaN, Infinity, -1, 1.5, "2026-01-01", received - 1]) {
    assert.deepEqual(observeCorrectionRetention(lifecycle(), now), { kind: "held", reason: "invalid_clock" });
  }
  for (const value of [lifecycle({ closedAtMs: received + 1 }),
    lifecycle({ erasedAtMs: received + 1, eraseReason: "sensitive_material" })]) {
    assert.deepEqual(observeCorrectionRetention(value, received), { kind: "held", reason: "invalid_clock" });
  }
});

test("a seven-day backup cannot extend a nearly expired or closed payload", () => {
  const copied = received + 89 * day;
  const result = observeCorrectionBackup(lifecycle(), copied, copied);
  assert.equal(result.backupExpiresAtMs, received + 90 * day);
  assert.equal(result.backupResidency, "within_limit");
  assert.equal(observeCorrectionBackup(lifecycle(), copied, received + 90 * day).backupResidency, "expired");
  const closed = lifecycle({ closedAtMs: received + day });
  assert.equal(observeCorrectionBackup(closed, received + 30 * day, received + 30 * day).backupExpiresAtMs, received + 31 * day);
});

test("earlier erasure may leave a restricted backup copy but forbids restored payload access", () => {
  const value = lifecycle({ erasedAtMs: received + day, eraseReason: "reporter_request" });
  const result = observeCorrectionBackup(value, received, received + day);
  assert.equal(result.backupResidency, "within_limit");
  assert.equal(result.restoredPayloadAccess, "expired");
  assert.equal(result.backupExpiresAtMs, received + 7 * day);
  assert.equal(observeCorrectionBackup(value, received + day, received + day).kind, "held");
});

test("unknown erasure state and invalid copy chronology cannot authorize a restore", () => {
  for (const args of [[null, received, received], [lifecycle(), received - 1, received],
    [lifecycle(), received + 1, received], [lifecycle(), NaN, received],
    [lifecycle(), received + 90 * day, received + 90 * day]]) {
    assert.deepEqual(observeCorrectionBackup(...args), { kind: "held" });
  }
});

test("independent calendar witnesses preserve milliseconds and elapsed days across DST", () => {
  const dates = [["2026-03-28T23:15:17.123Z", "2026-06-26T23:15:17.123Z"],
    ["2026-10-24T23:15:17.123Z", "2027-01-22T23:15:17.123Z"]];
  for (const [start, end] of dates) {
    const result = planCorrectionRetention(lifecycle({ receivedAtMs: Date.parse(start) }));
    assert.equal(result.payloadExpiresAtMs, Date.parse(end));
  }
});

test("returned lifecycle is detached from the caller's mutable object", () => {
  const value = lifecycle(), result = planCorrectionRetention(value);
  value.receivedAtMs += day;
  assert.equal(result.lifecycle.receivedAtMs, received);
});

test("a backup uses one parsed lifecycle snapshot even when input getters change", () => {
  let reads = 0;
  const value = lifecycle({ eraseReason: "reporter_request" });
  Object.defineProperty(value, "erasedAtMs", { enumerable: true,
    get() { reads++; return reads === 1 ? received + day : null; } });
  assert.equal(observeCorrectionBackup(value, received, received + day).restoredPayloadAccess, "expired");
  assert.equal(reads, 1);
});

test("an expired backup cannot be restored while the original report is still live", () => {
  assert.equal(observeCorrectionRetention(lifecycle(), received + 7 * day).payloadAccess, "available");
  assert.equal(observeCorrectionBackup(lifecycle(), received, received + 7 * day - 1).restoredPayloadAccess, "available");
  const expired = observeCorrectionBackup(lifecycle(), received, received + 7 * day);
  assert.equal(expired.backupResidency, "expired");
  assert.equal(expired.restoredPayloadAccess, "expired");
});
