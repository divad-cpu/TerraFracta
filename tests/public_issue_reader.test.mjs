import assert from "node:assert/strict";
import test from "node:test";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { createPublicIssueReader, canonicalPublicIssueRoute, PUBLIC_CANDIDATE_BYTES,
  DEVELOPMENT_READ_TIMEOUT_MS, readPublicIssue } from "../src/server/public-issue-reader.ts";

const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const route = () => sample().requestedRoute;
const held = { status: 503, cacheControl: "no-store" };

test("canonical slugs refuse selectors before a provider call; default is held", async () => {
  let calls = 0;
  const read = createPublicIssueReader(async () => { calls++; return bytes(sample()); });
  for (const input of [null, [], {}, { ...route(), sql: "canary" }, { ...route(), issueSlug: "../sample" },
    { ...route(), jurisdictionSlug: "Norway" }, { ...route(), issueSlug: " sample-issue " },
    { ...route(), issueSlug: "a".repeat(101) }, { ...route(), jurisdictionSlug: "a".repeat(81) },
    { ...route(), issueSlug: ["one", "two"] }, { ...route(), issueSlug: "one%2ftwo" }]) {
    assert.equal(canonicalPublicIssueRoute(input), null);
    assert.deepEqual(await read(input), { status: 404, cacheControl: "no-store" });
  }
  assert.equal(calls, 0);
  assert.deepEqual(await readPublicIssue(route()), held);
});
test("one current candidate yields only the bounded projection and exact immutable route", async () => {
  let calls = 0, observedSignal;
  const candidate = sample(); candidate.country.private_note = "private-canary";
  const read = createPublicIssueReader(async (requested, signal) => {
    calls++; assert.deepEqual(requested, route()); assert.ok(Object.isFrozen(requested));
    observedSignal = signal; return bytes(candidate);
  });
  const decision = await read(route());
  assert.equal(calls, 1); assert.equal(decision.status, 200); assert.equal(decision.cacheControl, "no-store");
  assert.equal(decision.issue.issueSlug, route().issueSlug);
  assert.equal(decision.issue.claims[0].evidence.length, 3);
  assert.ok(!JSON.stringify(decision).includes("private-canary"));
  assert.ok(!JSON.stringify(decision).includes("registration_state"));
  assert.equal(observedSignal.aborted, true);
});
test("an internally valid candidate for another requested route is withheld", async () => {
  const read = createPublicIssueReader(async () => bytes(sample()));
  assert.deepEqual(await read({ ...route(), jurisdictionSlug: "another-country" }), held);
  assert.deepEqual(await read({ ...route(), issueSlug: "another-issue" }), held);
});
test("SQL null is absent; rejection, malformed JSON, invalid UTF8 and errors are detail-free holds", async () => {
  assert.deepEqual(await createPublicIssueReader(async () => bytes(null))(route()), { status: 404, cacheControl: "no-store" });
  for (const value of [undefined, false, {}, { candidate_state: "rejected", private_note: "canary" },
    new Uint8Array([0xff, 0xff, 0xff, 0xff]), new TextEncoder().encode('{"broken"')]) {
    const result = await createPublicIssueReader(async () => value instanceof Uint8Array ? value : bytes(value))(route());
    assert.deepEqual(result, held);
  }
  assert.deepEqual(await createPublicIssueReader(async () => { throw new Error("private-password-canary"); })(route()), held);
});
test("transport size/type is bounded before candidate interpretation", async () => {
  for (const raw of [JSON.stringify(sample()), new Uint8Array(3), new Uint8Array(PUBLIC_CANDIDATE_BYTES + 1), new ArrayBuffer(4)])
    assert.deepEqual(await createPublicIssueReader(async () => raw)(route()), held);
  const exact = new TextEncoder().encode('null' + ' '.repeat(PUBLIC_CANDIDATE_BYTES - 4));
  assert.deepEqual(await createPublicIssueReader(async () => exact)(route()), { status: 404, cacheControl: "no-store" });
});
test("withdrawn rights and stale head never fall back to an earlier successful read", async () => {
  let candidate = sample(), calls = 0;
  const read = createPublicIssueReader(async () => { calls++; return bytes(candidate); });
  const first = await read(route()); assert.equal(first.status, 200);
  candidate.sources[0].registration.allow_public_derived = false;
  assert.deepEqual(await read(route()), held);
  candidate = sample(); candidate.head.current_publication_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  assert.deepEqual(await read(route()), held);
  assert.equal(calls, 3); assert.equal(first.issue.revision, 1);
});
test("a fresh successor candidate replaces the current revision without mutating earlier output", async () => {
  let candidate = sample();
  const read = createPublicIssueReader(async () => bytes(candidate));
  const first = await read(route());
  candidate.publication.id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  candidate.head.current_publication_id = candidate.publication.id;
  candidate.publication.revision = 2;
  candidate.publication_display_review.publication_id = candidate.publication.id;
  for (const claim of candidate.claims) {
    claim.period_review.publication_id = candidate.publication.id;
    claim.assertion_review.publication_id = candidate.publication.id;
  }
  for (const citation of candidate.citations) citation.publication_id = candidate.publication.id;
  const second = await read(route());
  assert.equal(second.status, 200); assert.equal(second.issue.revision, 2);
  assert.notEqual(second.issue.publicationId, first.issue.publicationId);
  assert.equal(first.issue.revision, 1);
});
test("cancellation before dispatch or during a pending provider never exposes a late candidate", async () => {
  let calls = 0, finish, signal;
  const read = createPublicIssueReader(async (_route, childSignal) => {
    calls++; signal = childSignal; return new Promise(resolve => { finish = resolve; });
  });
  const cancelled = new AbortController(); cancelled.abort();
  assert.deepEqual(await read(route(), cancelled.signal), held); assert.equal(calls, 0);
  const parent = new AbortController(), pending = read(route(), parent.signal);
  await Promise.resolve(); parent.abort();
  assert.deepEqual(await pending, held); assert.equal(calls, 1); assert.equal(signal.aborted, true);
  finish(bytes(sample())); await Promise.resolve();
});
test("a never-settling provider is abandoned at the fixed development deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0, signal;
  const read = createPublicIssueReader(async (_route, childSignal) => {
    calls++; signal = childSignal; return new Promise(() => {});
  });
  const pending = read(route()); await Promise.resolve(); assert.equal(calls, 1);
  t.mock.timers.tick(DEVELOPMENT_READ_TIMEOUT_MS);
  assert.deepEqual(await pending, held); assert.equal(signal.aborted, true);
});
test("late transport or late materialization stays held even when the timer cannot run yet", async () => {
  for (const times of [[0, DEVELOPMENT_READ_TIMEOUT_MS], [0, 0, DEVELOPMENT_READ_TIMEOUT_MS], [0, -1], [0, NaN]]) {
    const read = createPublicIssueReader(async () => bytes(sample()), () => times.shift());
    assert.deepEqual(await read(route()), held);
  }
});
test("concurrent requests have separate calls and cancellation lifetimes", async () => {
  const awaiting = [];
  const read = createPublicIssueReader(async (_route, signal) => new Promise(resolve => awaiting.push({ signal, resolve })));
  const parent = new AbortController();
  const a = read(route(), parent.signal), b = read(route());
  await Promise.resolve(); assert.equal(awaiting.length, 2); parent.abort();
  assert.deepEqual(await a, held); assert.equal(awaiting[0].signal.aborted, true);
  assert.equal(awaiting[1].signal.aborted, false); awaiting[1].resolve(bytes(sample()));
  assert.equal((await b).status, 200); awaiting[0].resolve(bytes(sample()));
});
