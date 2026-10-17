import assert from "node:assert/strict";
import test from "node:test";
import { createInventedContactFreeCustody as create } from "../src/invented-contact-free-custody.ts";
import { planInventedCorrectionRecovery as recover } from "../src/invented-contact-free-recovery.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const received = Date.parse("2026-01-01T12:00:00.123Z"), day = 86_400_000;
const reportId = "b8300000-1111-4111-8111-111111111111";
const held = { kind: "held" };
function fixture(closedAtMs, erasedAtMs, overrides = {}) {
  return { lifecycle: { schemaVersion: 1, reportId, receivedAtMs: received,
    closedAtMs, erasedAtMs, eraseReason: "sensitive_material" },
    requestId: "b8300000-2222-4222-8222-222222222222",
    target: deriveCorrectionTarget({ kind: "issue", issue: connectedInput().issue }).target,
    payload: { kind: "missing_context", details: "INVENTED_PRIVATE_CANARY",
      sourceUrl: "", resolution: null }, closedReason: "unsubstantiated",
    reviewerId: "b8300000-3333-4333-8333-333333333333", ...overrides };
}

test("a seeded closure after erasure cannot create custody authority", () => {
  const model = create([fixture(received + 2 * day, received + day)], () => received + 3 * day);
  assert.deepEqual(model, held);
  assert.doesNotMatch(JSON.stringify(model), /CANARY|reportId|reviewerId|lifecycle/);
});

test("one impossible lifecycle withholds the whole invented custody fixture", () => {
  const first = fixture(received, received + day);
  const second = fixture(received + 2 * day, received + day, {
    requestId: "b8300000-4444-4444-8444-444444444444" });
  second.lifecycle.reportId = "b8300000-5555-4555-8555-555555555555";
  assert.deepEqual(create([first, second], () => received + 3 * day), held);
});

test("closure before or at erasure remains coherent with the existing recovery planner", () => {
  for (const closed of [received, received + day]) {
    const now = received + 2 * day;
    const model = create([fixture(closed, received + day)], () => now);
    assert.equal(model.kind, "ready");
    assert.deepEqual(model.reviewer.read(reportId), held);
    const observation = model.custodian.minimalRecord(reportId);
    assert.equal(observation.kind, "minimal_record");
    assert.equal(observation.record.lifecycle.closedAtMs, closed);
    const backup = { schemaVersion: 1, kind: "invented_backup_inventory", copiedAtMs: now,
      records: [{ record: observation.record, hasPayload: false }] };
    const latest = { schemaVersion: 1, kind: "invented_latest_inventory", complete: true,
      observedAtMs: now, records: [observation.record] };
    const plan = recover(backup, latest, now);
    assert.equal(plan.kind, "planned");
    assert.equal(plan.actions[0].payload, "remove");
    assert.doesNotMatch(JSON.stringify(plan), /CANARY|details|sourceUrl|resolution/);
  }
});

test("an erased unresolved report keeps minimal context without permitting a later close", () => {
  const now = received + 2 * day;
  const model = create([fixture(null, received + day, { closedReason: null, reviewerId: null })], () => now);
  assert.equal(model.kind, "ready");
  assert.deepEqual(model.reviewer.close({ reportId,
    reviewerId: "b8300000-3333-4333-8333-333333333333", reason: "unsubstantiated",
    resolution: null }), held);
  assert.equal(model.custodian.minimalRecord(reportId).record.lifecycle.closedAtMs, null);
});
