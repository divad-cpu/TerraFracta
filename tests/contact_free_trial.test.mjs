import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { checkCorrectionRequest, prepareCorrectionRequest } from "../src/correction-request.ts";
import { createInventedContactFreeAdmission } from "../src/invented-contact-free-admission.ts";
import { createInventedContactFreeCustody } from "../src/invented-contact-free-custody.ts";
import { planCorrectionRetention, observeCorrectionBackup } from "../src/contact-free-correction-policy.ts";

const day = 86_400_000, received = Date.parse("2026-10-01T01:02:03.456Z");
const requestId = "d8400000-1111-4111-8111-111111111111", reportId = "d8400000-2222-4222-8222-222222222222";
const reviewerId = "d8400000-3333-4333-8333-333333333333";
const client = "d8400000-4444-4444-8444-444444444444", previous = "d8400000-5555-4555-8555-555555555555";
const current = () => ({ kind: "issue", issue: { ...connectedInput().issue,
  publicationId: "d8400000-6666-4666-8666-666666666666" } });
const request = () => ({ schemaVersion: 1, requestId, draft: { target: deriveCorrectionTarget(current()).target,
  fields: { kind: "incorrect_statement", details: "Invented Unicode assertion: blåbær 日本語.", sourceUrl: "https://example.org/invented-only" } } });
const fixture = selected => ({ lifecycle: { schemaVersion: 1, reportId, receivedAtMs: received,
  closedAtMs: null, erasedAtMs: null, eraseReason: null }, requestId: selected.requestId,
  target: selected.draft.target, payload: { ...selected.draft.fields, resolution: null }, closedReason: null, reviewerId: null });
const admissionInput = (now, bodyBytes) => ({ epoch: Math.floor(now / 900_000), currentKey: client, previousKey: previous, bodyBytes });

test("existing request binding, measured invented bytes and separate private custody cooperate without publication", () => {
  const selected = checkCorrectionRequest(current(), request());
  assert.equal(selected.kind, "prepared");
  const encoded = new TextEncoder().encode(JSON.stringify(selected.request));
  assert.ok(encoded.length > JSON.stringify(selected.request).length); // Native UTF-8, not string length.
  const budget = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => received);
  const reservation = budget.writer.begin(admissionInput(received, encoded.length));
  assert.equal(reservation.kind, "reserved");
  // Fixtures simulate an already observed private write; no actual intake runs.
  const custody = createInventedContactFreeCustody([fixture(selected.request)], () => received);
  const counted = budget.writer.settle(reservation.token, "accepted");
  assert.equal(counted.kind, "counted_accepted");
  assert.equal(custody.reviewer.read(reportId).payload.details, selected.request.draft.fields.details);
  assert.equal(budget.inspection.counts().openReports, 1);
  assert.doesNotMatch(JSON.stringify(budget.inspection.counts()), /details|日本語|example\.org|d840/);
  assert.equal(custody.reviewer.publish, undefined);
  assert.equal(budget.writer.read, undefined);
});

test("a simulated lost reply retains its budget until explicit exact private recovery", () => {
  let now = received;
  const selected = request(), budget = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => now);
  const ticket = budget.writer.begin(admissionInput(now, new TextEncoder().encode(JSON.stringify(selected)).length));
  const custody = createInventedContactFreeCustody([fixture(selected)], () => now);
  assert.equal(budget.writer.settle(ticket.token, "unknown").kind, "uncertain");
  assert.equal(prepareCorrectionRequest(current(), selected.draft, () => { throw Error("unused"); }, selected).reused, true);
  assert.deepEqual(budget.writer.begin(admissionInput(now, 100)), { kind: "held", reason: "uncertain" });
  const changed = current(); changed.issue = { ...changed.issue, revision: changed.issue.revision + 1 };
  assert.equal(checkCorrectionRequest(changed, selected).kind, "held");
  // A checked historical private observation resolves only this original ticket.
  const recovered = custody.custodian.minimalRecord(reportId);
  assert.equal(recovered.record.requestId, selected.requestId);
  assert.deepEqual(recovered.record.target, selected.draft.target);
  assert.equal(budget.recovery.resolve(ticket.token, "accepted").kind, "counted_accepted");
  assert.equal(budget.inspection.counts().openReports, 1);
  assert.equal(budget.inspection.counts().acceptedInHour, 1);
});

test("missing invented write evidence releases only an explicitly recovered nonwrite", () => {
  const budget = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => received);
  const ticket = budget.writer.begin(admissionInput(received, 100));
  const custody = createInventedContactFreeCustody([], () => received);
  budget.writer.settle(ticket.token, "unknown");
  assert.deepEqual(custody.custodian.minimalRecord(reportId), { kind: "held" });
  assert.deepEqual(budget.writer.settle(ticket.token, "not_written"), { kind: "held", reason: "invalid_context" });
  // Absence is not a real nonwrite proof. This is a deliberately supplied fixture result.
  assert.equal(budget.recovery.resolve(ticket.token, "not_written").kind, "released");
  assert.equal(budget.inspection.counts().openReports, 0);
});

test("closure, early erasure and current backup authority hold across the combined model", () => {
  let now = received;
  const selected = request(), custody = createInventedContactFreeCustody([fixture(selected)], () => now);
  const budget = createInventedContactFreeAdmission({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => now);
  const ticket = budget.writer.begin(admissionInput(now, 100)), counted = budget.writer.settle(ticket.token, "accepted");
  const before = custody.custodian.backup(reportId);
  now += day;
  assert.equal(custody.reviewer.close({ reportId, reviewerId, reason: "corrected", resolution: "Invented private resolution only." }).kind, "closed_private");
  assert.equal(budget.reviewer.closeCountedReport(counted.report).kind, "counted_closed");
  assert.equal(budget.inspection.counts().openReports, 0);
  const after = custody.custodian.backup(reportId);
  custody.custodian.losePayloadForTrial(reportId);
  assert.deepEqual(custody.custodian.restore(before.backup), { kind: "held" });
  assert.equal(custody.custodian.restore(after.backup).kind, "restored_private");
  assert.equal(custody.reviewer.read(reportId).expiresAtMs, received + 31 * day);
  now += day;
  custody.reviewer.erase({ reportId, reason: "sensitive_material" });
  assert.deepEqual(custody.custodian.restore(after.backup), { kind: "held" });
  assert.doesNotMatch(JSON.stringify(custody.custodian.minimalRecord(reportId)), /details|sourceUrl|resolution|日本語|example\.org/);
  now = received + 180 * day;
  assert.deepEqual(custody.custodian.minimalRecord(reportId), { kind: "held" });
});

test("retention and backup envelopes satisfy independent extrema over many receipt/closure combinations", () => {
  const dates = ["2026-01-31T23:59:59.999Z", "2026-03-28T23:15:17.123Z", "2026-10-24T23:15:17.123Z", "2028-02-29T12:00:00.000Z"];
  for (const date of dates) for (const closureDay of [null, 0, 1, 59, 60, 61, 89, 90, 180]) {
    const receipt = Date.parse(date), closedAtMs = closureDay === null ? null : receipt + closureDay * day;
    const lifecycle = { schemaVersion: 1, reportId, receivedAtMs: receipt, closedAtMs, erasedAtMs: null, eraseReason: null };
    const expected = closureDay === null || closureDay >= 60 ? receipt + 90 * day : receipt + (closureDay + 30) * day;
    const plan = planCorrectionRetention(lifecycle);
    assert.equal(plan.payloadExpiresAtMs, expected); assert.equal(plan.recordExpiresAtMs, receipt + 180 * day);
    const now = closedAtMs ?? receipt;
    if (now >= expected) continue;
    const copy = observeCorrectionBackup(lifecycle, now, now);
    assert.ok(copy.backupExpiresAtMs <= expected);
    assert.ok(copy.backupExpiresAtMs <= now + 7 * day);
    assert.equal(observeCorrectionBackup(lifecycle, now, copy.backupExpiresAtMs).restoredPayloadAccess, "expired");
  }
});
