import assert from "node:assert/strict";
import test from "node:test";
import { checkDossierContextV2Consistency, materializeDossierContextV2FromRows } from "../src/server/dossier-context-v2.ts";
import { v2ConsistencyCandidate, v2PrivateRows } from "./helpers/dossier_context_v2_fixture.mjs";
const adapters = [[v2ConsistencyCandidate, "contextReviews", checkDossierContextV2Consistency],
  [v2PrivateRows, "context_reviews", materializeDossierContextV2FromRows]];
test("accepted row fields cannot be borrowed from a prototype", () => {
  for (const [factory, key, check] of adapters) {
    const input = factory(); input[key] = input[key].map(row => Object.create(row)); assert.throws(() => check(input));
  }
});
test("review row field accessors cannot synthesize accepted review authority", () => {
  for (const [factory, key, check] of adapters) for (const field of ["publicationId", "revision", "snapshotSha256", "fieldPath", "decision", "reviewedAt"]) {
    const input = factory(), value = input[key][0][field]; let observed = 0;
    Object.defineProperty(input[key][0], field, { enumerable: true, get() { observed++; return value; } });
    assert.throws(() => check(input)); assert.equal(observed, 0, field);
  }
});
test("array entries are captured as own data without inherited rows accessors or custom mapping", () => {
  for (const [factory, key, check] of adapters) for (const kind of ["inherited", "accessor", "mapper"]) {
    const input = factory(), rows = input[key], first = rows[0]; let observed = 0;
    if (kind === "inherited") { delete rows[0]; Object.setPrototypeOf(rows, { 0: first }); }
    if (kind === "accessor") Object.defineProperty(rows, "0", { enumerable: true, get() { observed++; return first; } });
    if (kind === "mapper") rows.map = () => { observed++; return factory()[key]; };
    assert.throws(() => check(input)); assert.equal(observed, 0, kind);
  }
});
test("hidden or symbolic review metadata is refused instead of silently omitted", () => {
  for (const [factory, key, check] of adapters) for (const target of ["array", "row"]) for (const name of ["privateNote", Symbol("privateNote")]) {
    const input = factory(), value = target === "array" ? input[key] : input[key][0];
    Object.defineProperty(value, name, { value: "PRIVATE_REVIEW_CANARY", enumerable: false }); assert.throws(() => check(input));
  }
});
test("ordinary frozen and null-prototype own data rows remain valid and detached", () => {
  for (const [factory, key, check] of adapters) for (const kind of ["frozen", "null-prototype"]) {
    const input = factory(), before = structuredClone(input);
    input[key] = input[key].map(row => kind === "frozen" ? Object.freeze(row) : Object.assign(Object.create(null), row));
    if (kind === "frozen") Object.freeze(input[key]);
    assert.equal(check(input).schemaVersion, 2); assert.deepEqual(structuredClone(input), before);
  }
});
