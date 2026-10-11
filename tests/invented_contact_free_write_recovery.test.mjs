import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planInventedContactFreeWriteRecovery as plan } from "../src/invented-contact-free-write-recovery.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
const id = n => `e9800000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const NOW = Date.parse("2026-10-08T10:00:00Z"), DAY = 86400000, held = { kind: "held" };
const target = () => ({ issueId: id(1), publicationId: id(2), revision: 1,
  jurisdictionSlug: "fictional-country", issueSlug: "fictional-share", claimId: null });
const record = (n=10) => ({ lifecycle: { schemaVersion: 1, reportId: id(n), receivedAtMs: NOW,
  closedAtMs: null, erasedAtMs: null, eraseReason: null }, requestId: id(n+1000), target: target(),
  closedReason: null, reviewerId: null, version: 1 });
const operation = (n=20,r=10,inserted=true) => ({ operationId: id(n), executionId: id(3),
  requestId: id(r+1000), target: target(), admittedAtMs: NOW, expiresAtMs: NOW+limits.recordLifetimeMs,
  state: "recorded", reportId: id(r), inserted });
const fence = n => ({ ...operation(n), state: "nonwrite", reportId: null, inserted: null });
const backup = () => ({ schemaVersion: 1, kind: "invented_write_backup_inventory", executionId: id(3),
  copiedAtMs: NOW, records: [{ record: record(), hasPayload: true }], operations: [operation()] });
const latest = (at=NOW+DAY) => ({ schemaVersion: 1, kind: "invented_write_latest_inventory", executionId: id(3),
  complete: true, known: true, observedAtMs: at, records: [record()], operations: [operation()] });
const run = (old=backup(), current=latest(), now=current.observedAtMs) => plan(old,current,now);

test("unchanged custody and immutable effect preserve only the original leases", () => {
  const result = run(); assert.equal(result.kind,"planned_invented_write_recovery");
  assert.equal(result.recordActions[0].payload,"keep"); assert.deepEqual(result.operationActions[0].latestOperation,operation());
  assert.doesNotMatch(JSON.stringify(result),/details|sourceUrl|resolution|digest|email|address/);
  assert.equal(result.restartAdmission,undefined); assert.equal(result.restore,undefined);
});
test("newest erasure removes stale text while preserving original effect metadata", () => {
  const current = latest(); current.records[0].lifecycle.erasedAtMs=NOW+DAY;
  current.records[0].lifecycle.eraseReason="reporter_request"; current.records[0].version=2;
  const result=run(backup(),current); assert.equal(result.recordActions[0].payload,"remove");
  assert.equal(result.operationActions[0].latestOperation.inserted,true);
  assert.equal(result.operationActions[0].latestOperation.expiresAtMs,NOW+limits.recordLifetimeMs);
});
test("newest nonwrite fence absent from backup is retained without inventing a report", () => {
  const current=latest(); current.operations.push(fence(21)); const result=run(backup(),current);
  const action=result.operationActions.find(a=>a.operationId===id(21)); assert.equal(action.backupOperation,null);
  assert.deepEqual(action.latestOperation,fence(21)); assert.equal(result.recordActions.length,1);
});
test("complete latest absence removes an old operation rather than reinstating its outcome", () => {
  const current=latest();current.operations=[];const result=run(backup(),current);
  assert.equal(result.operationActions[0].latestOperation,null);assert.equal(result.recordActions[0].payload,"keep");
});
test("many request retries may retain one inserted effect and several repeat outcomes", () => {
  const old=backup(),current=latest();old.operations.push(operation(21,10,false));current.operations.push(operation(21,10,false));
  assert.equal(run(old,current).operationActions.length,2);
  current.operations.push(operation(22,10,true));assert.deepEqual(run(old,current),held);
});
test("a different insertion owner cannot replace the original effect across inventories", () => {
  const current=latest();current.operations=[operation(21)];assert.deepEqual(run(backup(),current),held);
});
test("seven-day backup and original180-day metadata bounds remain independent", () => {
  const at=NOW+7*DAY,result=run(backup(),latest(at));assert.equal(result.recordActions[0].payload,"remove");
  assert.equal(result.operationActions[0].latestOperation.expiresAtMs,NOW+180*DAY);
  const expired=run(backup(),latest(NOW+180*DAY));assert.equal(expired.operationActions[0].latestOperation,null);
  assert.equal(expired.recordActions[0].latestRecord,null);
});
test("expired current receipt can be scrubbed after its original report has already gone", () => {
  const current=latest(NOW+180*DAY);current.records=[];const result=run(backup(),current);
  assert.equal(result.kind,"planned_invented_write_recovery");assert.equal(result.operationActions[0].latestOperation,null);
});
for(const [name,mutate] of [
  ["renewed deadline",op=>op.expiresAtMs++], ["shortened recorded deadline",op=>op.expiresAtMs--],
  ["changed admission",op=>op.admittedAtMs++], ["changed execution",op=>op.executionId=id(4)],
  ["changed request",op=>op.requestId=id(5)], ["changed report",op=>op.reportId=id(6)],
  ["changed target",op=>op.target.revision++], ["inserted converted to repeat",op=>op.inserted=false],
  ["recorded converted to fence",op=>{op.state="nonwrite";op.reportId=null;op.inserted=null;}],
  ["private field",op=>op.details="INVENTED_PRIVATE_CANARY"],
])test(`reconciliation holds ${name}`,()=>{const current=latest();mutate(current.operations[0]);assert.deepEqual(run(backup(),current),held);});
test("nonwrite fences are immutable and cannot acquire report references",()=>{
  const old=backup(),current=latest();old.operations=[fence(21)];current.operations=[fence(21)];
  assert.equal(run(old,current).kind,"planned_invented_write_recovery");current.operations[0].reportId=id(10);assert.deepEqual(run(old,current),held);
});
test("missing unexpired report or duplicate operation invalidates complete context",()=>{
  const current=latest();current.records=[];assert.deepEqual(run(backup(),current),held);
  current.records=[record()];current.operations.push(operation());assert.deepEqual(run(backup(),current),held);
});
test("unknown/incomplete/stale/cross-execution latest context cannot prepare restart",()=>{
  for(const change of [c=>c.known=false,c=>c.complete=false,c=>c.observedAtMs--,c=>c.executionId=id(4)]){
    const current=latest();change(current);assert.deepEqual(run(backup(),current,NOW+DAY),held);
  }
  assert.deepEqual(plan(backup(),null,NOW+DAY),held);
});
test("later inventory accessor cannot rewrite detached backup identity",()=>{
  const old=backup(),current=latest();Object.defineProperty(current,"operations",{get(){old.operations[0].target.revision++;return [operation()];}});
  const result=run(old,current);assert.equal(result.kind,"planned_invented_write_recovery");assert.equal(result.operationActions[0].backupOperation.target.revision,1);
});
test("200records and400minimal operations are bounded without evicting references",()=>{
  const old=backup(),current=latest();old.records=[];old.operations=[];current.records=[];current.operations=[];
  for(let n=0;n<200;n++){const r=10+n;old.records.push({record:record(r),hasPayload:true});current.records.push(record(r));
    for(let k=0;k<2;k++){const op=operation(5000+n*2+k,r,k===0);old.operations.push(op);current.operations.push(structuredClone(op));}}
  const result=run(old,current);assert.equal(result.recordActions.length,200);assert.equal(result.operationActions.length,400);
  current.operations.push(fence(9999));assert.deepEqual(run(old,current),held);
});
const CLI=fileURLToPath(new URL("../scripts/check_contact_free_write_recovery_plan.mjs",import.meta.url));
function wire(input,args=[]){return spawnSync(process.execPath,["--experimental-strip-types",CLI,...args],{input,encoding:"utf8",env:{PATH:"/usr/bin:/bin"},timeout:2000});}
test("canonical native inventory pipe returns only a bounded metadata plan",()=>{
  const result=wire(JSON.stringify({backup:backup(),latest:latest(),nowMs:NOW+DAY}));assert.equal(result.status,0);
  assert.equal(JSON.parse(result.stdout).kind,"planned_invented_write_recovery");assert.doesNotMatch(result.stdout,/CANARY|details|sourceUrl/);
});
for(const [name,input,args] of [
  ["duplicate key",'{"backup":null,"backup":null,"latest":null,"nowMs":0}',[]],
  ["newline",JSON.stringify({backup:backup(),latest:latest(),nowMs:NOW+DAY})+"\n",[]],
  ["extra root",JSON.stringify({backup:backup(),latest:latest(),nowMs:NOW+DAY,email:"INVENTED_PRIVATE_CANARY"}),[]],
  ["invalid UTF8",Buffer.from([0x7b,0xff,0x7d]),[]], ["BOM",Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d]),[]],
  ["over limit","x".repeat(1024*1024+1),[]], ["argument","{}",["INVENTED_PRIVATE_CANARY"]],
])test(`inventory pipe holds ${name} without error/private output`,()=>{
  const result=wire(input,args);assert.equal(result.status,2);assert.deepEqual(JSON.parse(result.stdout),held);
  assert.doesNotMatch(result.stdout+result.stderr,/CANARY/);
});
