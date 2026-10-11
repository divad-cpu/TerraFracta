import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFictionalCompletionSnapshot } from "../src/fictional-completion-snapshot.ts";

const sample = JSON.parse(readFileSync(new URL("../fixtures/fictional_completion_snapshot.json", import.meta.url), "utf8"));
const copy = () => structuredClone(sample);

test("actual saved fictional stages preserve pending visibility and missing work", () => {
  const record = parseFictionalCompletionSnapshot(sample);
  assert.deepEqual(record.cases.map((entry) => [entry.caseKey,entry.runState,entry.storedFacts,entry.visibleFacts]), [
    ["stored_fact","partial",1,0],["held_finished","completed",0,0],["missing_decision","partial",0,0],
  ]);
  assert.equal(record.freshSourceChecks, 3);
  assert.equal(record.unchangedSourceChecks, 2);
  assert.equal(record.sourceContentVersions, 1);
});

test("named outcome cannot swap a stored fact, resolved hold or missing decision", () => {
  for (const [left,right] of [[0,1],[0,2],[1,2]]) {
    const record=copy();
    [record.cases[left].caseKey,record.cases[right].caseKey] = [record.cases[right].caseKey,record.cases[left].caseKey];
    assert.throws(() => parseFictionalCompletionSnapshot(record));
  }
  const falseHold=copy(); falseHold.cases[1].heldItems=0;
  assert.throws(() => parseFictionalCompletionSnapshot(falseHold));
});

test("a stored fact cannot claim completion or visible verification", () => {
  for (const change of [{runState:"completed"},{visibilityState:"verified"},{visibleFacts:2},{commitState:"none"}]) {
    const record = copy(); Object.assign(record.cases[0],change);
    assert.throws(() => parseFictionalCompletionSnapshot(record));
  }
});

test("a missing item cannot disappear behind a completed state or inflated count", () => {
  for (const change of [{runState:"completed"},{decidedItems:2},{heldItems:1},{pendingItems:2},{coveredSources:2}]) {
    const record = copy(); Object.assign(record.cases[2],change);
    assert.throws(() => parseFictionalCompletionSnapshot(record));
  }
});

test("unknown private fields, enabled runtime flags and an altered evidence kind reject", () => {
  for (const field of ["rawSource","workClaimId","ownerCredential"]) {
    const record = copy(); record[field] = "fictional-placeholder";
    assert.throws(() => parseFictionalCompletionSnapshot(record));
    const nested = copy(); nested.cases[0][field] = "fictional-placeholder";
    assert.throws(() => parseFictionalCompletionSnapshot(nested));
  }
  for (const change of [{liveCollectionEnabled:true},{livePublicationEnabled:true},{evidenceKind:"live_run"},{schemaVersion:true}]) {
    assert.throws(() => parseFictionalCompletionSnapshot({...copy(),...change}));
  }
});

test("duplicates, missing trials and timestamps later than recording reject", () => {
  const duplicate = copy(); duplicate.cases[2] = duplicate.cases[1];
  assert.throws(() => parseFictionalCompletionSnapshot(duplicate));
  const missing = copy(); missing.cases.pop();
  assert.throws(() => parseFictionalCompletionSnapshot(missing));
  const future = copy(); future.cases[0].finishedAt = "2099-01-01T00:00:00Z";
  assert.throws(() => parseFictionalCompletionSnapshot(future));
});

test("literal saved totals and bounded integer fields reject impossible snapshots", () => {
  for (const change of [{displayedRuns:4},{sourceContentVersions:2},{freshSourceChecks:4},{unchangedSourceChecks:3}]) {
    assert.throws(() => parseFictionalCompletionSnapshot({...copy(),...change}));
  }
  for (const value of [true,-1,51,1.5,"1"]) {
    const record = copy(); record.cases[0].expectedItems = value;
    assert.throws(() => parseFictionalCompletionSnapshot(record));
  }
});
