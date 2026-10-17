import assert from "node:assert/strict";
import test from "node:test";
import { captureCurrentIssueIdentity, interpretCurrentIssueStatus } from "../src/current-issue-status.ts";
import { captureConnectedStatusIdentity, interpretConnectedStatus } from "../src/connected-reader-status.ts";
const id = n => `abcdef0${n}-abcd-4abc-8abc-abcdefabcdef`;
const mixed = value => [...value].map((c, i) => i % 2 ? c.toUpperCase() : c).join("");
const current = () => ({ jurisdictionSlug: "invented-country", issueSlug: "invented-issue", issueId: id(1), publicationId: id(2), revision: 1 });
const connected = state => ({ generation: 1, executionId: id(3), observedAt: "2026-10-14T05:00:00.000001Z", state,
  publicationId: state === "active" ? id(2) : null });
const payload = value => ({ schemaVersion: 1, kind: "current", ...value });

test("current status compares admitted UUID values without changing original spelling or route", () => {
  for (const spelling of [value => value, value => value.toUpperCase(), mixed]) {
    const expected = { ...current(), issueId: spelling(id(1)), publicationId: spelling(id(2)) };
    const response = payload({ ...current(), issueId: mixed(id(1)), publicationId: id(2).toUpperCase() });
    const before = JSON.stringify({ expected, response }); assert.ok(captureCurrentIssueIdentity(expected));
    assert.deepEqual(interpretCurrentIssueStatus(response, expected), { kind: "current" });
    assert.equal(JSON.stringify({ expected, response }), before);
  }
});
test("revision growth cannot turn a spelling alias of the same publication UUID into a new edition", () => {
  const expected = current();
  assert.deepEqual(interpretCurrentIssueStatus(payload({ ...expected, publicationId: expected.publicationId.toUpperCase(), revision: 2 }), expected), { kind: "unavailable" });
});
test("current status still rejects foreign identities and requires a distinct successor publication", () => {
  const expected = current();
  for (const change of [{ issueId: id(4) }, { jurisdictionSlug: "foreign-country" }, { issueSlug: "foreign-issue" }, { publicationId: id(5) }, { revision: 0 }, { publicationId: `{${id(2)}}` }]) {
    assert.deepEqual(interpretCurrentIssueStatus(payload({ ...expected, ...change }), expected), { kind: "unavailable" });
  }
  assert.deepEqual(interpretCurrentIssueStatus(payload({ ...expected, publicationId: id(5).toUpperCase(), revision: 2 }), expected), { kind: "changed" });
});
for (const state of ["active", "suppressed"]) test(`${state} connected status treats only UUID letter case as equivalent`, () => {
  for (const spelling of [value => value, value => value.toUpperCase(), mixed]) {
    const expected = { ...connected(state), executionId: spelling(id(3)), publicationId: state === "active" ? spelling(id(2)) : null };
    const response = payload({ ...connected(state), executionId: mixed(id(3)), publicationId: state === "active" ? id(2).toUpperCase() : null });
    const before = JSON.stringify({ expected, response }); assert.ok(captureConnectedStatusIdentity(expected));
    assert.deepEqual(interpretConnectedStatus(response, expected), { kind: "current" });
    assert.equal(JSON.stringify({ expected, response }), before);
  }
});
test("connected status retains exact generation observation state and distinct UUID requirements", () => {
  const expected = connected("active");
  for (const change of [{ generation: 2 }, { executionId: id(4) }, { publicationId: id(5) }, { publicationId: null },
    { state: "suppressed" }, { observedAt: "2026-10-14T05:00:00.000002Z" }, { executionId: `{${id(3)}}` }]) {
    assert.deepEqual(interpretConnectedStatus(payload({ ...expected, ...change }), expected), { kind: "unavailable" });
  }
  assert.deepEqual(interpretConnectedStatus({ schemaVersion: 1, kind: "changed", currentGeneration: 2 }, expected), { kind: "changed", currentGeneration: 2 });
});
test("case comparison uses one admitted identity snapshot rather than reading original getters again", () => {
  for (const [expected, interpret] of [[current(), interpretCurrentIssueStatus], [connected("active"), interpretConnectedStatus]]) {
    const original = { ...expected, publicationId: id(2).toUpperCase() }; let reads = 0;
    Object.defineProperty(original, "publicationId", { enumerable: true, get() { return ++reads === 1 ? id(2).toUpperCase() : id(5); } });
    assert.deepEqual(interpret(payload(expected), original), { kind: "current" }); assert.equal(reads, 1);
  }
});
