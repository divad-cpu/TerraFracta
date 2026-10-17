import assert from "node:assert/strict";
import test from "node:test";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { checkedScopeDraftContext, checkScopeDraft, scopeDraftJson, reopenScopeDraftJson, SCOPE_DRAFT_BYTES } from "../src/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture } from "../src/server/proposal-capture.ts";
const candidate = context => ({ schemaVersion: 1, kind: "issue_scope_preparation", binding: context.binding,
  fields: { population: null, period: null, selectionRationale: null } });
const supplied = (context, field = "population", number = 1) => {
 const value = candidate(context); value.fields[field] = { wording: "Invented coverage requiring factual review.", references: [{ claimId: context.claims[0].id, referenceNumber: number }] }; return value;
};
test("missing scope remains three unknown fields with no borrowed denominator, period or approval", () => {
 const report = proposalReport(), before = structuredClone(report), context = capturedScopeDraftContext(report);
 assert.ok(context); const result = checkScopeDraft(candidate(context), context);
 assert.deepEqual(result.fields, { population: null, period: null, selectionRationale: null });
 assert.equal(result.kind, "issue_scope_preparation"); assert.deepEqual(report, before);
 assert.deepEqual(Object.keys(context).sort(), ["binding", "claims"]);
});
test("scope wording binds exact proposed occurrences, preserving contradictory references for investigation", () => {
 const context = capturedScopeDraftContext(proposalReport());
 for (const field of ["population", "period", "selectionRationale"]) {
  const result = checkScopeDraft(supplied(context, field, 2), context); assert.ok(result);
  assert.equal(result.fields[field].references[0].referenceNumber, 2);
  assert.equal(context.claims[0].evidence[1].relation, "contradicts");
 }
 const value = supplied(context); value.fields.population.references.push({ claimId: context.claims[0].id, referenceNumber: 2 });
 assert.equal(checkScopeDraft(value, context).fields.population.references.length, 2);
});
test("foreign binding and duplicate nonexistent or unbounded references cannot carry a scope draft", () => {
 const context = capturedScopeDraftContext(proposalReport());
 for (const key of Object.keys(context.binding)) {
  const value = supplied(context); value.binding = { ...value.binding, [key]: key.endsWith("Sha256") ? "0".repeat(64) : proposalId(99) };
  assert.equal(checkScopeDraft(value, context), null, key);
 }
 for (const alter of [v => v.fields.population.references.push(v.fields.population.references[0]),
  v => v.fields.population.references[0].claimId = proposalId(99), v => v.fields.population.references[0].referenceNumber = 3,
  v => v.fields.population.references[0].referenceNumber = 0, v => v.fields.population.references[0].referenceNumber = 1.5,
  v => v.fields.population.references = [], v => v.fields.population.wording = " ", v => v.fields.population.wording = "x".repeat(1201),
  v => v.fields.population.approved = true, v => v.kind = "accepted", v => v.fields.secret = "PRIVATE_CANARY"]) {
  const value = supplied(context); alter(value); assert.equal(checkScopeDraft(value, context), null);
 }
});
test("changed non-decision source receipt and captured base retire the original scope preparation identity", () => {
 const report = proposalReport(), context = capturedScopeDraftContext(report), original = supplied(context);
 const revised = structuredClone(report); revised.sourceReceipts[1].contentSha256 = "c".repeat(64);
 const successor = capturedScopeDraftContext(revised); assert.ok(successor);
 assert.equal(successor.binding.proposalSha256, context.binding.proposalSha256);
 assert.notEqual(checkedScopeDraftContext(successor).key, checkedScopeDraftContext(context).key);
 assert.equal(checkScopeDraft(original, successor), null);
 const observed = structuredClone(report); observed.observedAt = "2026-09-29T08:00:00.000000Z";
 assert.deepEqual(capturedScopeDraftContext(observed), context, "A dated observation does not rewrite captured content");
 const changedBase = structuredClone(report); changedBase.capture.baseHeadChangedAt = "2026-09-28T05:00:00.000002Z";
 assert.equal(checkScopeDraft(original, capturedScopeDraftContext(changedBase)), null);
});
test("corrupt incomplete extended or changed captured reports cannot initialize preparation", () => {
 for (const alter of [r => r.capture.proposalSha256 = "0".repeat(64), r => r.extra = "PRIVATE_CANARY",
  r => r.sourceReceipts.pop(), r => r.target.issueId = proposalId(99), r => r.base.publicationSha256 = "f".repeat(64)]) {
  const report = proposalReport(); alter(report); assert.equal(capturedScopeDraftContext(report), null);
 }
 for (const status of ["not_found", "capture_missing", "changed"]) assert.equal(capturedScopeDraftContext({ schemaVersion: 1, status, requested: proposalReport().requested }), null);
 assert.equal(capturedScopeDraftContext(new Proxy({}, { get() { throw Error("PRIVATE_CANARY"); } })), null);
 const context = capturedScopeDraftContext(proposalReport()); context.claims.push(structuredClone(context.claims[0]));
 assert.equal(checkedScopeDraftContext(context), null);
});

test("copied preparation reopens only in its bounded closed format under the same exact captured evidence", () => {
 const context = capturedScopeDraftContext(proposalReport()), value = supplied(context), json = scopeDraftJson(value, context);
 assert.ok(json); assert.deepEqual(reopenScopeDraftJson(json, context), value);
 for (const changed of [json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
  json.replace('"kind"', '"\\u006bind"'), json + "\n", JSON.stringify(value),
  json.replace('"population": {', '"population": { "approved": true,'), "[]", "null", "{", " ".repeat(SCOPE_DRAFT_BYTES + 1)]) {
  assert.equal(reopenScopeDraftJson(changed, context), null);
 }
 const successor = structuredClone(context); successor.binding.comparisonSha256 = "c".repeat(64);
 assert.equal(reopenScopeDraftJson(json, successor), null);
 assert.equal(reopenScopeDraftJson(new Proxy({}, { get() { throw Error("PRIVATE"); } }), context), null);
});
test("UTF-8 quota constrains the combined preparation, not only each field's character count", () => {
 const context = capturedScopeDraftContext(proposalReport());
 // Twelve distinct occurrences remain individually legal, even when values repeat.
 context.claims[0].evidence = Array.from({ length: 12 }, () => structuredClone(context.claims[0].evidence[0]));
 const value = candidate(context);
 for (const field of Object.keys(value.fields)) value.fields[field] = { wording: "\u0001".repeat(200) + "界".repeat(1000), references: Array.from({ length: 12 }, (_, i) => ({ claimId: context.claims[0].id, referenceNumber: i + 1 })) };
 assert.ok(checkScopeDraft(value, context)); assert.equal(scopeDraftJson(value, context), null);
 const raw = JSON.stringify(value, null, 2); assert.ok(raw.length <= SCOPE_DRAFT_BYTES); assert.ok(new TextEncoder().encode(raw).length > SCOPE_DRAFT_BYTES);
 assert.equal(reopenScopeDraftJson(raw, context), null);
 value.fields.selectionRationale = null; value.fields.period = null; assert.ok(scopeDraftJson(value, context));
});

test("client preparation context contains only needed occurrence labels while omitted full evidence still binds identity", () => {
 const report = proposalReport(), context = capturedScopeDraftContext(report);
 assert.deepEqual(Object.keys(context.claims[0]).sort(), ["evidence", "id", "periodLabel", "type"]);
 assert.deepEqual(Object.keys(context.claims[0].evidence[0]).sort(), ["locator", "relation", "title"]);
 const json = JSON.stringify(context); for (const omitted of ["assertion", "url", "publisher", "sourceVersionId", "retrievedAt", "sourcePublishedOn", "sourceSha256", "basePublicationId"]) assert.ok(!json.includes(`"${omitted}"`), omitted);
 assert.ok(!json.includes(report.capture.proposalJson)); assert.ok(!json.includes(report.base.publicationJson));
 const extra = structuredClone(context); extra.claims[0].evidence[0].url = "https://example.org/unexpected"; assert.equal(checkedScopeDraftContext(extra), null);
 const changed = structuredClone(report); changed.sourceReceipts[1].languageCode = "en";
 const next = capturedScopeDraftContext(changed); assert.deepEqual(next.claims, context.claims); assert.notEqual(next.binding.comparisonSha256, context.binding.comparisonSha256);
 assert.equal(checkScopeDraft(supplied(context), next), null);
});
