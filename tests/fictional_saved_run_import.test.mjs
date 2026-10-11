import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { exportFictionalSavedRun } from "../src/fictional-saved-run-export.ts";
import { readFictionalSavedRun, SAVED_RUN_FILE_BYTE_LIMIT } from "../src/fictional-saved-run-import.ts";

const bytes = text => new TextEncoder().encode(text).buffer;
function result(scenario = "standard") {
  const report = JSON.parse(readFileSync(new URL(`../fixtures/${scenario === "revised_value" ? "fictional_revised_update_report" : "fictional_update_report"}.json`, import.meta.url)));
  if (scenario === "missing_source") Object.assign(report, { state: "partial", items: [], coveredSourceKeys: [], fictionalCandidate: null });
  if (scenario === "invalid_citation") {
    const item = report.items.find(item => item.outcome === "shadow_only");
    Object.assign(item, { outcome: "held", source: null, sourceBindingValid: false, reasonCodes: ["source_reference_invalid"] });
    Object.assign(report, { state: "partial", coveredSourceKeys: [], fictionalCandidate: null });
  }
  return { execution: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "local_fictional", scenario,
    executedAt: "2026-10-10T10:00:00.123456789Z", durationMs: 1 }, report };
}
test("complete exported fixed scenarios reopen without changing identities, holds, dates or source-bound drafts", () => {
  for (const scenario of ["standard", "revised_value", "missing_source", "invalid_citation"]) {
    const original = result(scenario), exported = exportFictionalSavedRun(original), buffer = bytes(exported);
    assert.deepEqual(readFictionalSavedRun(buffer, buffer.byteLength), original);
    assert.equal(exportFictionalSavedRun(readFictionalSavedRun(buffer)), exported);
  }
});
test("malformed, nonreceipt, truncated and invalid UTF8 files are refused", () => {
  for (const buffer of [new ArrayBuffer(0), new ArrayBuffer(1), bytes("[]"), bytes("null"), bytes("{}"), bytes("not json"),
    bytes(exportFictionalSavedRun(result()).slice(0, -3)), new Uint8Array([0xc3, 0x28]).buffer])
    assert.throws(() => readFictionalSavedRun(buffer));
});
test("private fields, real-run claims, action grants and contradictory result or source bindings stay refused", () => {
  const original = result();
  const changed = [ { ...original, privatePath: "PRIVATE_FILE" },
    { ...original, execution: { ...original.execution, kind: "live" } },
    ...[{ publicChanges: 1 }, { mode: "publish_eligible" }, { reportKind: "verified_run" }, { enableCollection: true },
      { coveredSourceKeys: [] }, { fictionalCandidate: null }].map(change => ({ ...original, report: { ...original.report, ...change } })) ];
  const wrong = structuredClone(original); wrong.report.fictionalCandidate.decision.locator += " foreign"; changed.push(wrong);
  for (const input of changed) assert.throws(() => readFictionalSavedRun(bytes(JSON.stringify(input))));
});
test("the fixed file limit accepts exact-bound formatting and rejects a native extra byte", () => {
  const body = exportFictionalSavedRun(result());
  const exact = bytes(body + " ".repeat(SAVED_RUN_FILE_BYTE_LIMIT - bytes(body).byteLength));
  assert.equal(exact.byteLength, SAVED_RUN_FILE_BYTE_LIMIT); assert.deepEqual(readFictionalSavedRun(exact), result());
  const tooLarge = new ArrayBuffer(SAVED_RUN_FILE_BYTE_LIMIT + 1);
  Object.defineProperty(tooLarge, "byteLength", { value: 2 });
  assert.throws(() => readFictionalSavedRun(tooLarge));
});
test("captured file size must equal actual native bytes regardless of shadowed properties", () => {
  const buffer = bytes(exportFictionalSavedRun(result())), size = buffer.byteLength;
  Object.defineProperty(buffer, "byteLength", { value: 2 });
  assert.deepEqual(readFictionalSavedRun(buffer, size), result());
  for (const expected of [2, size - 1, size + 1, NaN, -1, 0, 2.5]) assert.throws(() => readFictionalSavedRun(buffer, expected));
});
test("counterfeit array buffers never invoke an iterator or qualify as local evidence", () => {
  let iterated = false; const fake = Object.create(ArrayBuffer.prototype);
  Object.defineProperty(fake, Symbol.iterator, { value() { iterated = true; return [123, 125][Symbol.iterator](); } });
  assert.throws(() => readFictionalSavedRun(fake)); assert.equal(iterated, false);
});
test("read results own their checked fields after the caller changes file bytes", () => {
  const buffer = bytes(exportFictionalSavedRun(result())), opened = readFictionalSavedRun(buffer);
  new Uint8Array(buffer).fill(0); assert.deepEqual(opened, result());
});
