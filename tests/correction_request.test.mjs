import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { checkCorrectionRequest, prepareCorrectionRequest, parseCorrectionRequestReceipt } from "../src/correction-request.ts";

const ids = ["f8a11111-1111-4111-8111-111111111111", "f8a22222-2222-4222-8222-222222222222"];
const current = () => ({ kind: "issue", issue: { ...connectedInput().issue, publicationId: "92bb9213-05e0-550a-8b99-cbf65e786609" } });
const draft = () => ({ target: deriveCorrectionTarget(current()).target,
  fields: { kind: "missing_context", details: "Invented correction for a retry test.", sourceUrl: "" } });
const request = () => ({ schemaVersion: 1, requestId: ids[0], draft: draft() });
test("a same canonical intent keeps its request identity without a delivery claim", () => {
  const prior = request(), nextDraft = draft();
  nextDraft.fields.details = "  " + nextDraft.fields.details + "  ";
  const next = prepareCorrectionRequest(current(), nextDraft, ids[1], prior);
  assert.deepEqual(next, { kind: "prepared", reused: true, request: prior });
  assert.doesNotMatch(JSON.stringify(next), /pageTitle|claimAssertion|submitted|reviewState/);
});
test("a lazy identity is unnecessary for a validated same canonical intent", () => {
  const prior = request(), nextDraft = draft();
  nextDraft.fields.details = "  " + nextDraft.fields.details + "  ";
  const next = prepareCorrectionRequest(current(), nextDraft, () => { throw new Error("unused identity provider"); }, prior);
  assert.deepEqual(next, { kind: "prepared", reused: true, request: prior });
  // Keep the established eager-ID validation contract for existing callers.
  assert.deepEqual(prepareCorrectionRequest(current(), nextDraft, "invalid", prior), { kind: "held", reason: "invalid_request" });
});
test("changed intent invokes the lazy identity once and preserves conflicting-ID refusal", () => {
  for (const nextDraft of [
    { ...draft(), fields: { ...draft().fields, details: "Another invented explanation." } },
    { ...draft(), fields: { ...draft().fields, kind: "broken_source_link" } },
    { ...draft(), fields: { ...draft().fields, sourceUrl: "https://example.org/changed" } },
    { ...draft(), target: { ...draft().target, claimId: current().issue.claims[0].id } },
  ]) {
    let calls = 0;
    const next = prepareCorrectionRequest(current(), nextDraft, () => { calls++; return ids[1]; }, request());
    assert.equal(calls, 1); assert.equal(next.kind, "prepared");
    assert.equal(next.reused, false); assert.equal(next.request.requestId, ids[1]);
    assert.deepEqual(prepareCorrectionRequest(current(), nextDraft, () => ids[0], request()), { kind: "held", reason: "invalid_request" });
  }
});
test("lazy generation does not authorize a stale or malformed previous request", () => {
  const successor = current(); successor.issue = { ...successor.issue, revision: 2, publicationId: ids[1] };
  const nextDraft = { ...draft(), target: deriveCorrectionTarget(successor).target };
  let calls = 0;
  const next = prepareCorrectionRequest(successor, nextDraft, () => { calls++; return ids[1]; }, request());
  assert.equal(calls, 1); assert.equal(next.kind, "prepared"); assert.equal(next.reused, false);
  assert.deepEqual(prepareCorrectionRequest(successor, nextDraft, () => ids[0], request()), { kind: "held", reason: "invalid_request" });
  const malformed = { ...request(), privateAuthority: true };
  assert.equal(prepareCorrectionRequest(current(), draft(), () => ids[1], malformed).reused, false);
  assert.deepEqual(prepareCorrectionRequest(current(), draft(), () => "invalid", malformed), { kind: "held", reason: "invalid_request" });
});
test("a lazy provider failure still refuses new or changed intent without a substitute identity", () => {
  const changed = { ...draft(), fields: { ...draft().fields, details: "A changed invented explanation." } };
  for (const previous of [null, request()]) {
    assert.throws(() => prepareCorrectionRequest(current(), changed, () => { throw new Error("invented identity failure"); }, previous), /invented identity failure/);
  }
  assert.deepEqual(prepareCorrectionRequest(current(), { ...draft(), fields: { ...draft().fields, details: "short" } },
    () => { throw new Error("unused identity provider"); }, request()), { kind: "held", reason: "invalid_request" });
});
test("changed text, kind, URL or claim obtains the supplied fresh identity", () => {
  for (const nextDraft of [
    { ...draft(), fields: { ...draft().fields, details: "A different invented correction." } },
    { ...draft(), fields: { ...draft().fields, kind: "broken_source_link" } },
    { ...draft(), fields: { ...draft().fields, sourceUrl: "https://example.org/fictional" } },
    { ...draft(), target: { ...draft().target, claimId: current().issue.claims[0].id } },
  ]) {
    const next = prepareCorrectionRequest(current(), nextDraft, ids[1], request());
    assert.equal(next.kind, "prepared"); assert.equal(next.reused, false); assert.equal(next.request.requestId, ids[1]);
    assert.deepEqual(prepareCorrectionRequest(current(), nextDraft, ids[0], request()), { kind: "held", reason: "invalid_request" });
  }
});
test("changed or withdrawn current publication holds an old request", () => {
  assert.deepEqual(checkCorrectionRequest({ kind: "held", reason: "unavailable" }, request()), { kind: "held", reason: "unavailable" });
  const changed = current(); changed.issue = { ...changed.issue, revision: changed.issue.revision + 1 };
  assert.deepEqual(checkCorrectionRequest(changed, request()), { kind: "held", reason: "changed" });
});
test("a new edition cannot reuse the old identity even though the old target is held", () => {
  const successor = current(); successor.issue = { ...successor.issue, revision: 2, publicationId: ids[1] };
  const successorDraft = { ...draft(), target: deriveCorrectionTarget(successor).target };
  assert.deepEqual(prepareCorrectionRequest(successor, successorDraft, ids[0], request()), { kind: "held", reason: "invalid_request" });
  assert.equal(prepareCorrectionRequest(successor, successorDraft, ids[1], request()).kind, "prepared");
});
test("private authority, unknown envelope fields, malformed IDs and invalid drafts refuse", () => {
  for (const input of [null, { ...request(), schemaVersion: true }, { ...request(), requestId: "not-a-uuid" },
    { ...request(), requestId: ids[0].toUpperCase() }, { ...request(), reportId: ids[1] },
    { ...request(), draft: { ...draft(), reviewState: "closed" } },
    { ...request(), draft: { ...draft(), fields: { ...draft().fields, details: "short" } } }]) {
    assert.deepEqual(checkCorrectionRequest(current(), input), { kind: "held", reason: "invalid_request" });
  }
});
test("receipt identity is bound to request, edition and revision, with strict private fields", () => {
  const selected = request(), good = { schemaVersion: 1, status: "recorded_private", requestId: ids[0], reportId: ids[1],
    publicationId: selected.draft.target.publicationId, revision: selected.draft.target.revision, replayed: false };
  assert.deepEqual(parseCorrectionRequestReceipt(good, selected), good);
  assert.equal(parseCorrectionRequestReceipt({ ...good, replayed: true }, selected).replayed, true);
  for (const change of [{ requestId: ids[1] }, { publicationId: ids[1] }, { revision: good.revision + 1 },
    { reviewState: "closed" }, { status: "published" }, { replayed: 1 }, { reportId: null }]) {
    assert.throws(() => parseCorrectionRequestReceipt({ ...good, ...change }, selected));
  }
});
