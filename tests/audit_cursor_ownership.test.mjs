import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { canonicalOperatorAuditScope } from "../src/server/operator-audit-reader.ts";

const uuid = n => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const selection = () => ({ runId: uuid(1), issueId: uuid(2) });
const cursor = () => ({ latestRevision: "25", beforeRevision: "6" });
function harness(mode = "development") {
  const calls = [], marker = new Error("NOT_FOUND");
  const page = loadTsx(new URL("../app/editorial-preview/audit/page.tsx", import.meta.url), name => {
    if (name === "next/navigation") return { notFound() { throw marker; } };
    if (name.endsWith("operator-audit-reader.ts")) return { canonicalOperatorAuditScope,
      readOperatorAudit: async scope => { calls.push(scope); return { kind: "unconfigured" }; } };
  }, { env: { NODE_ENV: mode } }).default;
  return { calls, marker, page, render: async query => renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) })) };
}

test("a partial own cursor cannot borrow either required numeric field from its prototype", async () => {
  for (const missing of ["latestRevision", "beforeRevision"]) {
    const own = { ...selection(), ...cursor() }; delete own[missing];
    const h = harness(), html = await h.render(Object.assign(Object.create({ [missing]: cursor()[missing] }), own));
    assert.equal(h.calls.length, 0, missing);
    assert.ok(html.includes("Choose a recorded run and issue"));
    assert.ok(!html.includes(`value="${uuid(1)}"`));
  }
});

test("an omitted optional head ignores a prototype value and remains a null head", async () => {
  const h = harness();
  const html = await h.render(Object.assign(Object.create({ headPublicationId: uuid(5) }), { ...selection(), ...cursor() }));
  assert.deepEqual(h.calls, [{ ...selection(), cursor: { latestRevision: 25, beforeRevision: 6, headPublicationId: null } }]);
  assert.ok(html.includes("Recorded audit connection unavailable"));
  assert.ok(!html.includes(uuid(5)));
});

test("inherited numeric cursor getters are never observed to complete an incomplete tuple", async () => {
  for (const missing of ["latestRevision", "beforeRevision"]) {
    let reads = 0; const prototype = {};
    Object.defineProperty(prototype, missing, { get() { reads++; return cursor()[missing]; } });
    const own = { ...selection(), ...cursor() }; delete own[missing];
    const h = harness(), html = await h.render(Object.assign(Object.create(prototype), own));
    assert.equal(reads, 0, missing); assert.equal(h.calls.length, 0);
    assert.ok(html.includes("Choose a recorded run and issue"));
  }
});

test("an inherited or non-enumerable optional head getter cannot reject a valid own cursor", async () => {
  for (const ownHidden of [false, true]) {
    let reads = 0; const target = {};
    Object.defineProperty(target, "headPublicationId", { get() { reads++; throw new Error("private-canary"); } });
    const query = ownHidden ? Object.assign(target, { ...selection(), ...cursor() })
      : Object.assign(Object.create(target), { ...selection(), ...cursor() });
    const h = harness(), html = await h.render(query);
    assert.equal(reads, 0); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].cursor.headPublicationId, null);
    assert.ok(html.includes("Recorded audit connection unavailable")); assert.ok(!html.includes("private-canary"));
  }
});

test("complete own enumerable cursor values retain exact nullable-head and frozen-scope semantics", async () => {
  for (const head of [undefined, "", uuid(5)]) {
    const h = harness(), own = { ...selection(), ...cursor(), ...(head === undefined ? {} : { headPublicationId: head }) };
    const html = await h.render(Object.assign(Object.create({ latestRevision: "999", beforeRevision: "999", headPublicationId: uuid(9) }), own));
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0], { ...selection(), cursor: { latestRevision: 25, beforeRevision: 6, headPublicationId: head || null } });
    assert.ok(Object.isFrozen(h.calls[0]) && Object.isFrozen(h.calls[0].cursor));
    assert.ok(html.includes("Recorded audit connection unavailable"));
  }
});

test("a first-page own selection ignores all inherited cursor fields", async () => {
  let reads = 0; const prototype = {};
  for (const key of ["latestRevision", "beforeRevision", "headPublicationId"])
    Object.defineProperty(prototype, key, { get() { reads++; throw new Error("private-canary"); } });
  const h = harness(), html = await h.render(Object.assign(Object.create(prototype), selection()));
  assert.equal(reads, 0); assert.deepEqual(h.calls, [{ ...selection(), cursor: null }]);
  assert.ok(html.includes("Recorded audit connection unavailable")); assert.ok(!html.includes("private-canary"));
});

test("non-enumerable required numeric fields cannot complete an enumerable partial cursor", async () => {
  for (const missing of ["latestRevision", "beforeRevision"]) {
    const query = { ...selection(), ...cursor() }; delete query[missing];
    Object.defineProperty(query, missing, { value: cursor()[missing] });
    const h = harness(), html = await h.render(query);
    assert.equal(h.calls.length, 0); assert.ok(html.includes("Choose a recorded run and issue"));
  }
});
