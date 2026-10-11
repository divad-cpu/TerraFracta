import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFictionalResponseSnapshot } from "../src/fictional-response-snapshot.ts";
const sample = JSON.parse(readFileSync(new URL("../fixtures/fictional_response_snapshot.json", import.meta.url), "utf8"));
const copy = () => structuredClone(sample);

test("retained response counts keep a measured result distinct from uncertain capacity", () => {
  const saved=parseFictionalResponseSnapshot(sample);
  assert.deepEqual(saved.cases.map((x)=>[x.caseKey,x.chargedBytes,x.dispatches,x.settlements,x.workClaims]),
    [["shared_limit",101,0,0,1],["measured_replay",3,1,1,1],["crash_takeover",101,1,0,2]]);
  assert.equal(saved.actualSourceFetches,0);
});
test("changed labels cannot disguise a crash as a measured response", () => {
  const record=copy();[record.cases[1].caseKey,record.cases[2].caseKey]=[record.cases[2].caseKey,record.cases[1].caseKey];
  assert.throws(()=>parseFictionalResponseSnapshot(record));
});
test("a crash cannot refund capacity, create a settlement or remove its replacement worker", () => {
  for(const change of [{chargedBytes:0},{settlements:1},{dispatches:0},{workClaims:1}]) {
    const record=copy();Object.assign(record.cases[2],change);assert.throws(()=>parseFictionalResponseSnapshot(record));
  }
});
test("a blocked request or exact repeat cannot claim an additional dispatch", () => {
  for(const [index,change] of [[0,{dispatches:1}],[0,{chargedBytes:100}],[1,{dispatches:2}],[1,{chargedBytes:0}]]) {
    const record=copy();Object.assign(record.cases[index],change);assert.throws(()=>parseFictionalResponseSnapshot(record));
  }
});
test("unknown private fields and active runtime claims reject", () => {
  for(const field of ["runId","workClaimId","reservationId","principal","rawBody","databaseTarget"]) {
    const record=copy();record[field]="fictional-private-field";assert.throws(()=>parseFictionalResponseSnapshot(record));
    const nested=copy();nested.cases[0][field]="fictional-private-field";assert.throws(()=>parseFictionalResponseSnapshot(nested));
  }
  for(const change of [{actualSourceFetches:1},{liveCollectionEnabled:true},{livePublicationEnabled:true},{schemaVersion:true}]) {
    assert.throws(()=>parseFictionalResponseSnapshot({...copy(),...change}));
  }
});
test("duplicate cases, future evidence and invalid numerical values reject", () => {
  const duplicate=copy();duplicate.cases[2]=duplicate.cases[1];assert.throws(()=>parseFictionalResponseSnapshot(duplicate));
  const future=copy();future.cases[0].savedAt="2099-01-01T00:00:00Z";assert.throws(()=>parseFictionalResponseSnapshot(future));
  for(const value of [true,-1,102,1.5,"101"]) {const record=copy();record.cases[0].chargedBytes=value;assert.throws(()=>parseFictionalResponseSnapshot(record));}
});
