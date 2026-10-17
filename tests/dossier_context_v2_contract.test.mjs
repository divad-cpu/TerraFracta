import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { checkDossierContextV2Consistency, dossierSnapshotV2Sha256, materializeDossierContextV2FromRows } from "../src/server/dossier-context-v2.ts";
import { dossierSnapshotV2Schema, dossierContextV2Schema, DOSSIER_CONTEXT_V2_BYTES } from "../src/dossier-context-v2.ts";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { checkPublicReadConsistency } from "../src/public-read-consistency.ts";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { canonicalProposalJson } from "../src/operator-proposal-capture.ts";
import { v2ConsistencyCandidate, v2PrivateRows, contextReviews, contextReviewAt } from "./helpers/dossier_context_v2_fixture.mjs";
const check = checkDossierContextV2Consistency;
const snapshot = value => value.envelope.publication.snapshot;
const refresh = value => { value.contextReviews = contextReviews(snapshot(value)); return value; };
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test("v2 retains exact reviewed nullable scope and multiple responsibility roles without mutating input", () => {
  const value = v2ConsistencyCandidate(), before = structuredClone(value); freeze(value);
  const out = check(value); assert.equal(out.schemaVersion, 2); assert.deepEqual(out.dossierContext, snapshot(value).dossierContext);
  assert.equal(out.dossierContext.responsibilities.length, 2); assert.equal(out.dossierContext.responsibilities[0].fields.governmentLevel, null);
  assert.match(out.dossierContext.scope.period.wording, /year precision only/); assert.deepEqual(value, before);
});
test("legacy envelope consistency and private-row materializers continue refusing v2 instead of dropping its context", () => {
  const value = v2ConsistencyCandidate();
  assert.throws(() => parsePublicIssueProjection(value.envelope)); assert.throws(() => checkPublicReadConsistency(value));
  assert.throws(() => materializePublicIssueFromRows(v2PrivateRows()));
  const privatePreparation = { schemaVersion: 1, kind: "issue_scope_preparation", binding: {}, fields: snapshot(value).dossierContext.scope };
  assert.equal(dossierSnapshotV2Schema.safeParse(privatePreparation).success, false);
});
test("full-snapshot hash changes for every relevant base or context edit while key ordering is immaterial", () => {
  const value = snapshot(v2ConsistencyCandidate()), canonical = canonicalProposalJson(value);
  assert.equal(dossierSnapshotV2Sha256(value), createHash("sha256").update(canonical).digest("hex"));
  const reverse = Object.fromEntries(Object.entries(value).reverse()); assert.equal(dossierSnapshotV2Sha256(reverse), dossierSnapshotV2Sha256(value));
  for (const mutate of [v => v.title += " changed", v => v.claims[0].evidence[0].locator += " changed", v => v.dossierContext.scope.population.wording += " changed",
    v => v.dossierContext.scope.period.references[0].relation = "context"]) {
    const clone = structuredClone(value); mutate(clone);
    if (dossierSnapshotV2Schema.safeParse(clone).success) assert.notEqual(dossierSnapshotV2Sha256(clone), dossierSnapshotV2Sha256(value));
    else assert.throws(() => dossierSnapshotV2Sha256(clone));
  }
});
test("each supplied field requires its exact accepted publication revision path and full snapshot digest", () => {
  for (const mutate of [v => v.contextReviews.pop(), v => v.contextReviews.push(v.contextReviews[0]), v => v.contextReviews[0].fieldPath = "/scope/unknown",
    v => v.contextReviews[0].publicationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", v => v.contextReviews[0].revision++,
    v => v.contextReviews[0].snapshotSha256 = "0".repeat(64), v => v.contextReviews[0].decision = "withdrawn",
    v => snapshot(v).dossierContext.scope.population.wording += " without fresh review"]) {
    const value = v2ConsistencyCandidate(); mutate(value); assert.throws(() => check(value));
  }
});
test("unknown context stays unknown with an empty review set and cannot borrow an irrelevant accepted review", () => {
  const value = v2ConsistencyCandidate(); snapshot(value).dossierContext = { scope: { population: null, period: null, selectionRationale: null }, responsibilities: [] };
  const old = value.contextReviews[0]; refresh(value); const out = check(value); assert.equal(out.dossierContext.scope.population, null);
  value.contextReviews.push({ ...old, snapshotSha256: dossierSnapshotV2Sha256(snapshot(value)) }); assert.throws(() => check(value));
});
test("context references require known exact distinct occurrences and explicit support for the new wording", () => {
  for (const mutate of [v => v.dossierContext.scope.population.references[0].referenceNumber = 12,
    v => v.dossierContext.scope.population.references[0].claimId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    v => v.dossierContext.scope.population.references.push({ ...v.dossierContext.scope.population.references[0], relation: "context" }),
    v => v.dossierContext.scope.population.references[0].relation = "context",
    v => v.dossierContext.responsibilities[0].claimId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    v => v.dossierContext.responsibilities.push(structuredClone(v.dossierContext.responsibilities[0]))]) {
    const value = v2ConsistencyCandidate(); mutate(snapshot(value)); assert.throws(() => check(refresh(value)));
  }
});
test("context evidence roles are separately reviewed and never inherited from the original statement role", () => {
  const value = v2ConsistencyCandidate(), out = check(value);
  assert.equal(out.claims[0].evidence[1].relation, "contradicts"); assert.equal(out.dossierContext.scope.period.references[0].relation, "supports");
  snapshot(value).dossierContext.scope.period.references[0].relation = "contradicts"; assert.throws(() => check(refresh(value)));
});
test("review chronology preserves nanosecond ordering equivalent offsets and evidence-review day", () => {
  const value = v2ConsistencyCandidate(); value.contextReviews[0].reviewedAt = "2026-09-25T20:00:00.000000001+02:00"; assert.ok(check(value));
  for (const date of ["2026-09-25T18:00:00.000000003Z", "2026-09-24T18:00:00Z", "2026-09-25T18:00:00.0000000001Z"]) {
    const clone = v2ConsistencyCandidate(); clone.contextReviews[0].reviewedAt = date; assert.throws(() => check(clone));
  }
  assert.equal(contextReviewAt, "2026-09-25T18:00:00.000000001Z");
});
test("context chronology cannot reread a changing final review timestamp after base qualification", () => {
  for (const [factory, materialize, reviewKey, timeKey] of [
    [v2ConsistencyCandidate, check, "publicationReview", "reviewedAt"],
    [v2PrivateRows, materializeDossierContextV2FromRows, "publication_display_review", "reviewed_at"],
  ]) {
    const value = factory(); let reads = 0;
    Object.defineProperty(value[reviewKey], timeKey, { enumerable: true, configurable: true,
      get() { return reads++ === 0 ? "2026-09-25T18:00:00.000000000Z" : "2026-09-25T18:00:00.000000002Z"; } });
    assert.throws(() => materialize(value));
    assert.ok(reads <= 1, "the same final review must never be observed twice");
  }
});
test("context reviews must be an own data-property row bundle instead of inherited or accessor authority", () => {
  for (const [factory, materialize, key] of [[v2ConsistencyCandidate, check, "contextReviews"],
    [v2PrivateRows, materializeDossierContextV2FromRows, "context_reviews"]]) {
    for (const mode of ["inherited", "accessor"]) {
      const value = factory(), rows = value[key]; delete value[key]; let reads = 0;
      if (mode === "inherited") Object.setPrototypeOf(value, { [key]: rows });
      else Object.defineProperty(value, key, { enumerable: true, get() { reads++; return rows; } });
      assert.throws(() => materialize(value)); assert.equal(reads, 0, "an accessor must not supply accepted reviews");
    }
  }
});
test("context review cannot repair a stale head wrong route withdrawn source rights or changed base evidence", () => {
  for (const mutate of [v => v.envelope.currentPublicationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    v => v.dossier.publicSlug = "another-issue", v => v.sources[0].allowPublicDerived = false,
    v => v.sources[0].registrationState = "suspended", v => v.claims[0].assertionReview.decision = "withdrawn",
    v => v.citations[0].locator += " other", v => v.sources[0].publicReview.displayTitle += " changed"]) {
    const value = v2ConsistencyCandidate(); mutate(value); assert.throws(() => check(refresh(value)));
  }
});
test("private-row composition retains private assertion publisher route and unbound-date withholding gates", () => {
  const rows = v2PrivateRows(), before = structuredClone(rows), out = materializeDossierContextV2FromRows(rows);
  assert.ok(out.claims[0].evidence.every(source => source.sourcePublishedOn === null)); assert.deepEqual(rows, before);
  for (const mutate of [v => v.claims[0].assertion += " changed", v => v.sources[0].registration.publisher += " changed",
    v => v.requestedRoute.issueSlug = "another-issue", v => v.sources[0].version.registration_id += " mismatch",
    v => v.publication_display_review = null, v => v.context_reviews = []]) {
    const clone = v2PrivateRows(); mutate(clone); assert.throws(() => materializeDossierContextV2FromRows(clone));
  }
});
test("closed canonical context rejects extra private fields whitespace aliases field overflow and whole UTF8 overflow", () => {
  for (const mutate of [v => v.dossierContext.scope.population.wording = " noncanonical ",
    v => v.dossierContext.captureId = "PRIVATE_CAPTURE", v => v.dossierContext.scope.population.wording = "😀".repeat(1201)]) {
    const value = v2ConsistencyCandidate(); mutate(snapshot(value)); assert.throws(() => check(refresh(value)));
  }
  const value = v2ConsistencyCandidate(), field = snapshot(value).dossierContext.scope.population;
  field.wording = "😀".repeat(1200); assert.ok(check(refresh(value)));
  for (const entry of snapshot(value).dossierContext.responsibilities) for (const name of ["institution", "governmentLevel", "role", "period"])
    entry.fields[name] = { wording: `${name}${"😀".repeat(1190)}`, references: [{ ...field.references[0] }] };
  assert.ok(new TextEncoder().encode(canonicalProposalJson(snapshot(value).dossierContext)).byteLength > DOSSIER_CONTEXT_V2_BYTES);
  assert.equal(dossierContextV2Schema.safeParse(snapshot(value).dossierContext).success, false);
});
