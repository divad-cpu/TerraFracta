import assert from "node:assert/strict";
import test from "node:test";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { canonicalPublicIssueRoute, createPublicIssueReader } from "../src/server/public-issue-reader.ts";

const expected = sample().requestedRoute;
const bytes = () => new TextEncoder().encode(JSON.stringify(sample()));
function changing(field, first, later) {
  const value = { ...expected }; let calls = 0;
  Object.defineProperty(value, field, { enumerable: true, get() { calls++; return calls === 1 ? first : later(calls); } });
  return { value, calls: () => calls };
}

test("canonical route retains the first checked slug values and never reobserves admitted fields", () => {
  for (const field of ["jurisdictionSlug", "issueSlug"]) for (const form of ["different", "throws"]) {
    const subject = changing(field, expected[field], count => {
      if (form === "throws") throw Error("PRIVATE_REPEAT_CANARY");
      return count < 4 ? expected[field] : "../unadmitted-route";
    });
    const route = canonicalPublicIssueRoute(subject.value);
    assert.deepEqual(route, expected, "only the same values that were checked may become the frozen route");
    assert.ok(Object.isFrozen(route)); assert.notEqual(route, subject.value); assert.equal(subject.calls(), 1);
  }
});

test("native current reader calls its invented provider once with the exact first admitted route", async () => {
  for (const field of ["jurisdictionSlug", "issueSlug"]) {
    const subject = changing(field, expected[field], count => count < 4 ? expected[field] : "../unadmitted-route");
    const calls = [], logs = [];
    const read = createPublicIssueReader(async route => { calls.push(route); return bytes(); }, () => 0, code => logs.push(code));
    const decision = await read(subject.value);
    assert.deepEqual(calls, [expected], "the provider must never receive a slug obtained after validation");
    assert.ok(Object.isFrozen(calls[0])); assert.equal(decision.status, 200); assert.equal(subject.calls(), 1);
    assert.deepEqual(logs, []);
  }
});

test("a first invalid slug cannot become admitted through later property values", async () => {
  for (const field of ["jurisdictionSlug", "issueSlug"]) for (const invalid of ["../unadmitted-route", "Norway", "a".repeat(field === "jurisdictionSlug" ? 81 : 101)]) {
    const subject = changing(field, invalid, () => expected[field]); let providerCalls = 0;
    const read = createPublicIssueReader(async () => { providerCalls++; return bytes(); }, () => 0, () => assert.fail("invalid scope is not a source-read fault"));
    assert.deepEqual(await read(subject.value), { status: 404, cacheControl: "no-store" });
    assert.equal(providerCalls, 0); assert.equal(subject.calls(), 1);
  }
});

test("existing route shape refusals and first-observation exceptions keep their established behavior", async () => {
  for (const value of [null, [], {}, { ...expected, extra: "PRIVATE_SHAPE_CANARY" }]) {
    assert.equal(canonicalPublicIssueRoute(value), null);
    assert.deepEqual(await createPublicIssueReader()(value), { status: 404, cacheControl: "no-store" });
  }
  for (const field of ["jurisdictionSlug", "issueSlug"]) {
    const marker = Error("PRIVATE_FIRST_OBSERVATION_CANARY"), value = { ...expected };
    Object.defineProperty(value, field, { enumerable: true, get() { throw marker; } });
    assert.throws(() => canonicalPublicIssueRoute(value), error => error === marker);
    await assert.rejects(createPublicIssueReader()(value), error => error === marker);
  }
  let issueReads = 0;
  const value = { jurisdictionSlug: null, get issueSlug() { issueReads++; throw Error("PRIVATE_UNRELATED_CANARY"); } };
  assert.equal(canonicalPublicIssueRoute(value), null); assert.equal(issueReads, 0);
});
