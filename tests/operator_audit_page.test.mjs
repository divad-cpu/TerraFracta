import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { canonicalOperatorAuditScope, createOperatorAuditReader, readOperatorAudit } from "../src/server/operator-audit-reader.ts";

const pageSource = new URL("../app/editorial-preview/audit/page.tsx", import.meta.url);
const uuid = n => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = () => ({ runId: uuid(1), issueId: uuid(2) });
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
function report() { return { schemaVersion: 1, status: "ok", requested: { ...query(), cursor: null }, observedAt: "2026-10-05T10:00:00Z",
  run: { runId: uuid(1), jurisdictionId: "invented-jurisdiction", mode: "shadow", runState: "running", commitState: "none", visibilityState: "not_required", createdAt: "2026-10-05T09:00:00Z", finishedAt: null },
  expectedSourcesKnown: false, sources: [], history: { issueId: uuid(2), latestRevision: 0, headPublicationId: null, headRevision: null, publications: [], nextCursor: null } }; }

// Compile the actual page, actual presenter and existing PageIntro; intercept
// only the Next refusal and reader seam. No placeholder presentation or HTTP.
function harness(mode, read = readOperatorAudit) {
  if (arguments.length === 0) mode = "development";
  const marker = new Error("NEXT_NOT_FOUND"), calls = [], modules = new Map();
  function load(source) {
    if (modules.has(source.href)) return modules.get(source.href);
    const exports = {}, native = createRequire(source);
    const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    modules.set(source.href, exports);
    new Function("require", "exports", "process", compiled)(name => {
      if (source.href === pageSource.href && name === "next/navigation") return { unstable_rethrow: native(name).unstable_rethrow, notFound: () => { throw marker; } };
      if (source.href === pageSource.href && name.endsWith("operator-audit-reader.ts")) return {
        canonicalOperatorAuditScope,
        readOperatorAudit: async scope => { calls.push(scope); return read(scope); },
      };
      if (name.startsWith(".")) {
        const candidate = new URL(name.endsWith(".tsx") ? name : name + ".tsx", source);
        if (existsSync(candidate)) return load(candidate);
      }
      return native(name);
    }, exports, { env: { NODE_ENV: mode } });
    return exports;
  }
  const module = load(pageSource);
  return { module, marker, calls, page: module.default, render: async input => renderToStaticMarkup(await module.default(input)) };
}

test("actual audit page refuses production/unknown before props, parameters or provider inspection", async () => {
  for (const mode of ["production", "test", undefined]) {
    const h = harness(mode), poison = new Proxy({}, { get() { assert.fail("Parameters inspected before production refusal"); } });
    await assert.rejects(h.page(poison), error => error === h.marker); assert.equal(h.calls.length, 0);
    assert.equal(h.module.runtime, "nodejs"); assert.equal(h.module.dynamic, "force-dynamic");
    assert.deepEqual(h.module.metadata.robots, { index: false, follow: false });
  }
});

test("empty or invalid query selectors/cursors never read a provider or echo submitted contents", async () => {
  const invalid = [{}, { issueId: uuid(2) }, { ...query(), runId: "private-canary" }, { ...query(), runId: uuid(1).replace("90000000", "9a000000").toUpperCase() },
    { ...query(), issueId: [uuid(2), uuid(2)] }, { ...query(), sql: "private-canary" }, { ...query(), source: "private-canary" }, { ...query(), headPublicationId: "" },
    { ...query(), latestRevision: "25" }, { ...query(), beforeRevision: "6" }, { ...query(), latestRevision: "5", beforeRevision: "6" },
    ...["0", "-1", "+1", "1.2", "01", " 1", "1 ", "NaN", "Infinity", "2147483648"].map(latestRevision => ({ ...query(), latestRevision, beforeRevision: "1" })),
    { ...query(), latestRevision: ["25"], beforeRevision: "6" }, { ...query(), latestRevision: "25", beforeRevision: "6", headPublicationId: "null" },
    { ...query(), latestRevision: "25", beforeRevision: "6", headPublicationId: [uuid(5)] }, { ...query(), unexpected: undefined }, null, []];
  const h = harness();
  for (const value of invalid) {
    const html = await h.render({ searchParams: Promise.resolve(value) });
    assert.ok(html.includes("Choose a recorded run and issue")); assert.ok(!html.includes("private-canary"));
  }
  assert.equal(h.calls.length, 0);
});

test("valid first selection uses canonical fixed IDs, actual shared byte reader and actual audit SSR", async () => {
  let providerCalls = 0;
  const h = harness("development", createOperatorAuditReader(async (scope, signal) => {
    providerCalls++; assert.deepEqual(scope, { ...query(), cursor: null }); assert.equal(signal.aborted, false);
    return bytes(report());
  }));
  const html = await h.render({ searchParams: Promise.resolve(query()) });
  assert.equal(providerCalls, 1); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { ...query(), cursor: null });
  assert.ok(Object.isFrozen(h.calls[0]));
  assert.ok(html.includes("Recorded audit snapshot")); assert.ok(html.includes("expected source set is unknown"));
  assert.ok(html.includes(`value="${uuid(1)}"`)); assert.ok(html.includes(`value="${uuid(2)}"`));
  assert.ok(html.includes('aria-label="Choose a recorded audit"'));
});

test("pagination accepts exact positive integer anchors and nullable head without admitting unrelated selectors", async () => {
  const h = harness();
  for (const headPublicationId of [undefined, "", uuid(5)]) {
    const value = { ...query(), latestRevision: "25", beforeRevision: "6", ...(headPublicationId === undefined ? {} : { headPublicationId }) };
    const html = await h.render({ searchParams: Promise.resolve(value) });
    assert.ok(html.includes("Recorded audit connection unavailable"));
    assert.deepEqual(h.calls.at(-1), { ...query(), cursor: { latestRevision: 25, headPublicationId: headPublicationId || null, beforeRevision: 6 } });
    assert.ok(Object.isFrozen(h.calls.at(-1).cursor));
  }
  assert.equal(h.calls.length, 3);
});

test("default audit remains unconfigured; stored changed/not-found decisions withhold rows", async () => {
  assert.ok((await harness().render({ searchParams: Promise.resolve(query()) })).includes("Recorded audit connection unavailable"));
  const cursor = { latestRevision: 25, headPublicationId: uuid(5), beforeRevision: 6 };
  for (const [status, title] of [["changed", "Publication ledger changed"], ["not_found", "No matching recorded audit"]]) {
    const reader = createOperatorAuditReader(async scope => bytes({ schemaVersion: 1, status, requested: scope }));
    const h = harness("development", reader), input = { ...query(), ...Object.fromEntries(Object.entries(cursor).map(([key, value]) => [key, String(value)])) };
    const html = await h.render({ searchParams: Promise.resolve(input) });
    assert.ok(html.includes(title)); assert.ok(!html.includes("Recorded audit snapshot"));
    assert.ok(html.includes(`value="${uuid(1)}"`)); assert.ok(html.includes(`value="${uuid(2)}"`));
    const href = html.match(/href="([^"]+)">Start a fresh audit<\/a>/)?.[1]; assert.ok(href);
    const fresh = new URL(href.replaceAll("&amp;", "&"), "http://example.invalid");
    assert.deepEqual([...fresh.searchParams.keys()], ["runId", "issueId"]);
    assert.equal(fresh.searchParams.get("runId"), uuid(1));
  }
});

test("rejected query or unexpected reader exception is contained without raw diagnostics or record leakage", async () => {
  const h = harness("development", async () => { throw new Error("private-canary"); });
  const rejected = await h.render({ searchParams: Promise.reject(new Error("private-canary")) });
  assert.ok(rejected.includes("Choose a recorded run and issue")); assert.ok(!rejected.includes("private-canary")); assert.equal(h.calls.length, 0);
  const failed = await h.render({ searchParams: Promise.resolve(query()) });
  assert.ok(failed.includes("Recorded audit unavailable")); assert.ok(!failed.includes("private-canary")); assert.equal(h.calls.length, 1);
  assert.ok(!failed.includes("Recorded audit snapshot"));
});
