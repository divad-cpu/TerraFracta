import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { heldBrowseSelection, heldBrowseHref } from "../src/operator-held-browse.ts";
import { canonicalHeldDecisionScope } from "../src/server/operator-held-decisions-reader.ts";
import { heldId, heldScope } from "./helpers/operator_held_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const cursor = { decidedAt: "2026-10-05T09:01:00.000001Z", decisionId: heldId(9) };
const literal = () => ({ runId: heldId(1), beforeDecidedAt: cursor.decidedAt, beforeDecisionId: cursor.decisionId, reason: "material_conflict" });
const selected = () => ({ scope: heldScope(cursor), reason: "material_conflict" });
for (const [field, later] of [["runId", heldId(99)], ["beforeDecidedAt", "2026-10-05T09:01:00.000002Z"],
  ["beforeDecisionId", heldId(99)], ["reason", "shadow_mode"]]) {
  test(`held query captures its own ${field} once before choosing the private scope and filter`, () => {
    const input = literal(), first = input[field]; let reads = 0;
    Object.defineProperty(input, field, { enumerable: true, get() { return ++reads === 1 ? first : later; } });
    const value = heldBrowseSelection(input); assert.equal(reads, 1); assert.deepEqual(value, selected());
    const roundTrip = heldBrowseSelection(Object.fromEntries(new URL(heldBrowseHref(value.scope, value.reason), "https://example.invalid").searchParams));
    assert.deepEqual(roundTrip, selected());
  });
}

test("a hidden optional own reason is not borrowed or observed", () => {
  for (const throwing of [false, true]) {
    const input = { runId: heldId(1) }; let reads = 0;
    Object.defineProperty(input, "reason", { enumerable: false, get() { reads++; if (throwing) throw new Error("PRIVATE_HIDDEN_REASON"); return "material_conflict"; } });
    assert.deepEqual(heldBrowseSelection(input), { scope: heldScope(), reason: "" }); assert.equal(reads, 0);
  }
});

test("closed key refusal happens before admitted getters are read", () => {
  let reads = 0;
  const input = { get runId() { reads++; return heldId(1); }, privatePath: "PRIVATE_QUERY" };
  assert.equal(heldBrowseSelection(input), null); assert.equal(reads, 0);
});

test("literal, frozen and null-prototype queries keep the same exact scope and refusals", () => {
  for (const input of [literal(), Object.freeze(literal()), Object.assign(Object.create(null), literal())]) {
    const before = JSON.stringify(input); assert.deepEqual(heldBrowseSelection(input), selected()); assert.equal(JSON.stringify(input), before);
  }
  const inherited = Object.assign(Object.create({ reason: "material_conflict", beforeDecidedAt: cursor.decidedAt, beforeDecisionId: cursor.decisionId }), { runId: heldId(1) });
  assert.deepEqual(heldBrowseSelection(inherited), { scope: heldScope(), reason: "" });
  const missing = { reason: "material_conflict" }; Object.defineProperty(missing, "runId", { value: heldId(1) });
  const bad = [null, [], {}, missing, { runId: [heldId(1)] }, { ...literal(), reason: undefined },
    { runId: heldId(1), beforeDecidedAt: cursor.decidedAt }, { ...literal(), reason: "PRIVATE_QUERY" }];
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); bad.push(proxy);
  for (const input of bad) assert.equal(heldBrowseSelection(input), null);
  const throws = literal(); Object.defineProperty(throws, "reason", { enumerable: true, get() { throw new Error("PRIVATE_QUERY"); } });
  assert.equal(heldBrowseSelection(throws), null);
});

function page(read, mode = "development") {
  return loadTsx(new URL("../app/editorial-preview/held/page.tsx", import.meta.url), name =>
    name === "next/navigation" ? { notFound() { throw new Error("REFUSED_ROUTE"); } } :
      name.endsWith("operator-held-decisions-reader.ts") ? { readHeldDecisions: read, canonicalHeldDecisionScope } : undefined,
  { env: { NODE_ENV: mode } }).default;
}

test("actual held route reads the captured first run and preserves it in opaque recovery links", async () => {
  let gets = 0; const input = { get runId() { return ++gets === 1 ? heldId(1) : heldId(99); } }, reads = [];
  const actual = page(async scope => { reads.push(structuredClone(scope)); return { kind: "unconfigured" }; });
  const element = await actual({ searchParams: Promise.resolve(input) });
  assert.deepEqual(reads, [heldScope()]); assert.equal(gets, 1);
  const html = renderToStaticMarkup(element);
  assert.match(html, /private connection is not configured/); assert.ok(html.includes(`runId=${heldId(1)}`));
  assert.ok(!html.includes(heldId(99))); assert.doesNotMatch(html, /Recorded holds|<form|PRIVATE_/);
});

test("captured route scope and reason survive caller mutation while its one private read is pending", async () => {
  const input = literal(), reads = []; let resolve;
  const actual = page(scope => { reads.push(structuredClone(scope)); return new Promise(done => { resolve = done; }); });
  const pending = actual({ searchParams: Promise.resolve(input) }); await new Promise(done => setImmediate(done));
  input.runId = heldId(99); input.reason = "shadow_mode"; input.beforeDecisionId = heldId(99);
  resolve({ kind: "unavailable" }); const element = await pending;
  assert.deepEqual(reads, [heldScope(cursor)]);
  assert.deepEqual(element.props.selection, heldScope(cursor)); assert.equal(element.props.reason, "material_conflict");
  assert.doesNotMatch(renderToStaticMarkup(element), /PRIVATE_/);
});

test("production and invalid-key held routes refuse before any private read", async () => {
  let reads = 0;
  const read = async () => { reads++; assert.fail("refused route performed a private read"); };
  await assert.rejects(page(read, "production")(new Proxy({}, { get() { assert.fail("production inspected props"); } })), /REFUSED_ROUTE/);
  const html = renderToStaticMarkup(await page(read)({ searchParams: Promise.resolve({ ...literal(), sql: "PRIVATE_QUERY" }) }));
  assert.match(html, /selection is invalid/); assert.doesNotMatch(html, /PRIVATE_|Recorded holds|<form/); assert.equal(reads, 0);
});
