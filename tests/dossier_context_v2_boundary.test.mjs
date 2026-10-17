import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPublicIssueReader, createDevelopmentPublicIssueHandler, readPublicIssue } from "../src/server/public-issue-reader.ts";
import { fictionalPublicationDraftSchema } from "../src/fictional-publication-draft.ts";
import { dossierSnapshotV2Schema } from "../src/dossier-context-v2.ts";
import { checkDossierContextV2Consistency, materializeDossierContextV2FromRows } from "../src/server/dossier-context-v2.ts";
import { v2ConsistencyCandidate, v2PrivateRows } from "./helpers/dossier_context_v2_fixture.mjs";
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const noRecord = () => {};
function request(route) {
  return new Request(`http://127.0.0.1:3100/api/dev/public-issue/${route.jurisdictionSlug}/${route.issueSlug}`, { headers: { "sec-fetch-site": "same-origin" } });
}
const context = route => ({ params: Promise.resolve({ country: route.jurisdictionSlug, issue: route.issueSlug }) });

test("both complete and key-trimmed v2 row bundles remain opaque held responses through the actual v1 reader", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Native injection only, no network"));
  const full = v2PrivateRows(); assert.equal(materializeDossierContextV2FromRows(full).schemaVersion, 2);
  const trimmed = structuredClone(full); delete trimmed.context_reviews;
  for (const rows of [full, trimmed]) {
    let calls = 0; const codes = [];
    const read = createPublicIssueReader(async () => { calls++; return bytes(rows); }, () => 0, code => codes.push(code));
    const result = await read(rows.requestedRoute);
    assert.deepEqual(result, { status: 503, cacheControl: "no-store" }); assert.equal(calls, 1); assert.deepEqual(codes, []);
    assert.doesNotMatch(JSON.stringify(result), /fictional|dossierContext|context_reviews|snapshot|publicationId/);
  }
});
test("the actual v1 handler holds v2 bytes and separately refuses a forged successful v2 projection from a custom reader", async () => {
  const rows = v2PrivateRows(), route = rows.requestedRoute;
  const readers = [createPublicIssueReader(async () => bytes(rows), () => 0, noRecord),
    async () => ({ status: 200, cacheControl: "no-store", issue: materializeDossierContextV2FromRows(rows) })];
  for (const read of readers) {
    const handle = createDevelopmentPublicIssueHandler(read, noRecord), response = await handle(request(route), context(route), "development");
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(await response.json(), { error: "read_unavailable" });
  }
});
test("default read stays unconfigured and nondevelopment handler refusal occurs before any v2 observation", async () => {
  const route = v2PrivateRows().requestedRoute;
  assert.deepEqual(await readPublicIssue(route), { status: 503, cacheControl: "no-store" });
  let calls = 0; const handle = createDevelopmentPublicIssueHandler(async () => { calls++; return { status: 200, cacheControl: "no-store", issue: checkDossierContextV2Consistency(v2ConsistencyCandidate()) }; }, noRecord);
  for (const environment of [undefined, "test", "production"])
    assert.equal((await handle(request(route), { params: { then() { assert.fail("No parameter observation"); } } }, environment)).status, 404);
  assert.equal(calls, 0);
});
test("the existing validated fictional draft contract rejects an otherwise shape-valid v2 snapshot", () => {
  const draft = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8")).fictionalCandidate;
  assert.ok(fictionalPublicationDraftSchema.parse(draft));
  draft.publication.snapshot.schemaVersion = 2;
  draft.publication.snapshot.dossierContext = { scope: { population: null, period: null, selectionRationale: null }, responsibilities: [] };
  assert.ok(dossierSnapshotV2Schema.parse(draft.publication.snapshot));
  assert.equal(fictionalPublicationDraftSchema.safeParse(draft).success, false);
});
