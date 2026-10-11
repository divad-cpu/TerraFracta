import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePrivateCustodianJournal } from "../src/private-custodian-journal.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_private_custodian_journal.json", import.meta.url), "utf8"));

test("saved journal examples distinguish missing, held and unconfirmed cleanup without new attempts", () => {
  const parsed = parsePrivateCustodianJournal(saved);
  assert.deepEqual(parsed.entries.map((item) => item.nativeCleanupConfirmed), [null, true, true, false]);
  assert.equal(parsed.nativeQueries, 0); assert.equal(parsed.sourceRequests, 0);
  assert.equal(parsed.actualNativeFailureObserved, false); assert.equal(parsed.automaticRetry, false);
});

test("private identifiers, raw bodies, diagnostic text and live claims are rejected", () => {
  for (const [key, value] of [["principal", "private-canary"], ["rawBody", "private-canary"], ["rawPath", "/private/canary"],
    ["startReceiptSha256", "a".repeat(64)], ["liveStatus", true], ["sourceRequests", 1], ["nativeQueries", 1],
    ["actualNativeFailureObserved", true], ["cleanupUncertaintyInjected", false], ["publicationEnabled", true], ["automaticRetry", true]]) {
    assert.throws(() => parsePrivateCustodianJournal({ ...saved, [key]: value }));
  }
  const changed = structuredClone(saved); changed.entries[3].error = "private-canary";
  assert.throws(() => parsePrivateCustodianJournal(changed));
});

test("missing finish never gains confirmation and unknown cleanup never becomes completed", () => {
  for (const mutate of [(x) => x.entries[0].nativeCleanupConfirmed = true, (x) => x.entries[0].finishRecorded = true,
    (x) => x.entries[3].nativeCleanupConfirmed = true, (x) => x.entries[3].state = "pending_held",
    (x) => x.entries[2].state = "successful", (x) => x.entries[1].nativeCleanupConfirmed = 1,
    (x) => x.entries.reverse(), (x) => x.entries.pop()]) {
    const changed = structuredClone(saved); mutate(changed);
    assert.throws(() => parsePrivateCustodianJournal(changed));
  }
});

test("chronology and exported latest time bind the fixed historical examples", () => {
  const changed = structuredClone(saved); changed.recordedAt = "2026-10-04T00:00:00Z";
  assert.throws(() => parsePrivateCustodianJournal(changed));
  changed.recordedAt = saved.recordedAt; changed.entries[2].recordedAt = "2026-01-01T00:00:00Z";
  assert.throws(() => parsePrivateCustodianJournal(changed));
  const equivalent = structuredClone(saved); equivalent.recordedAt = saved.recordedAt.replace('+00:00', 'Z');
  assert.doesNotThrow(() => parsePrivateCustodianJournal(equivalent));
});

test("a one-microsecond reversal or latest-time mismatch cannot appear checked", () => {
  const changed = structuredClone(saved);
  changed.entries[0].recordedAt = "2026-10-03T17:35:37.138900+00:00";
  changed.entries[1].recordedAt = "2026-10-03T17:35:37.138899+00:00";
  changed.entries[2].recordedAt = "2026-10-03T17:35:37.170000+00:00";
  changed.entries[3].recordedAt = "2026-10-03T17:35:37.170267+00:00";
  changed.recordedAt = changed.entries[3].recordedAt;
  assert.throws(() => parsePrivateCustodianJournal(changed));
  changed.entries[0].recordedAt = changed.entries[1].recordedAt;
  assert.doesNotThrow(() => parsePrivateCustodianJournal(changed));
  changed.recordedAt = "2026-10-03T17:35:37.170268+00:00";
  assert.throws(() => parsePrivateCustodianJournal(changed));
});
