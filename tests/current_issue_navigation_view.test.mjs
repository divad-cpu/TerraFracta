import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

// Exact pages, view, evidence presenter and materializer, in process. The route
// test substitutes only the current provider and Next's notFound control. No
// server/HTTP/Browser, storage, operational source or primary database is used.
function load(relative, intercept = () => undefined, processValue = { env: { NODE_ENV: "development" } }) {
  const file = new URL(relative, import.meta.url), exports = {}, native = createRequire(file);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", "process", compiled)(name => {
    const replacement = intercept(name); if (replacement !== undefined) return replacement;
    if (name.startsWith(".")) {
      const full = new URL(name, file);
      if (full.pathname.endsWith(".tsx") || existsSync(new URL(full.href + ".tsx")))
        return load(full.pathname.endsWith(".tsx") ? full.href : full.href + ".tsx", intercept, processValue);
      if (existsSync(new URL(full.href + ".ts"))) return native(name + ".ts");
    }
    return native(name);
  }, exports, processValue);
  return exports;
}
const View = load("../src/current-issue-navigation-view.tsx").CurrentIssueNavigationView;
const bytes = candidate => new TextEncoder().encode(JSON.stringify(candidate));
const decisionFor = candidate => createPublicIssueReader(async () => bytes(candidate))(sample().requestedRoute);
const render = (decision, view, query = {}) => renderToStaticMarkup(createElement(View, {
  decision, selection: currentIssueSelection(view, query), latestHref: `/reader-preview/imaginary-place/sample-housing-measure/${view}`,
}));

test("actual current source index retains all locators and relations without counting reused references as independent sources", async () => {
  const decision = await decisionFor(sample()), html = render(decision, "sources", { edition: decision.issue.publicationId });
  for (const text of ["3 exact references", "not a count of independent sources", "Supports this wording", "Points to a conflict", "Adds context"])
    assert.ok(html.includes(text), text);
  for (const source of decision.issue.claims[0].evidence)
    assert.ok(html.includes(source.locator) && html.includes(source.retrievedAt));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.ok(html.includes(`?edition=${decision.issue.publicationId}&amp;returnView=sources#claim-${decision.issue.claims[0].id}`));
  assert.ok(!html.includes('href="https:')); assert.ok(!html.includes("registration_id"));
});
test("actual dossier search retains edition, escaped query and exact claim return target", async () => {
  const decision = await decisionFor(sample());
  const matching = render(decision, "search", { edition: decision.issue.publicationId, q: "cell A1" });
  for (const text of ['method="get"', 'name="edition"', decision.issue.publicationId, "1 statement matches", '#claim-'])
    assert.ok(matching.includes(text), text);
  const empty = render(decision, "search", { q: "<script>private-canary</script>" });
  assert.ok(empty.includes("No matching statement in this dossier")); assert.ok(empty.includes("&lt;script&gt;"));
  assert.ok(!empty.includes("<script>")); assert.ok(!empty.includes(decision.issue.claims[0].assertion));
  assert.ok(empty.includes("does not establish that an action or evidence is absent elsewhere"));
});
test("source filters retain edition, original reference numbers, whole-dossier conflict notices and exact-match explanations", async () => {
  const decision = await decisionFor(sample());
  const html = render(decision, "sources", { edition: decision.issue.publicationId, q: "cell A1", type: "condition", relation: "supports" });
  for (const text of ['method="get"', 'name="edition"', 'name="type"', 'name="relation"', 'Showing 1 of 3 references',
    'Reference 1', 'Matched in: Exact location', 'complete dossier includes conflicting evidence', 'statement also includes conflicting evidence']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Reference 2 ·')); assert.ok(!html.includes('Reference 3 ·'));
  assert.ok(html.includes(`${decision.issue.publicationId}&amp;returnView=sources&amp;returnQ=cell+A1&amp;returnType=condition&amp;returnRelation=supports#claim-${decision.issue.claims[0].id}`));
  assert.ok(!html.includes('href="https:'));
  const context = render(decision, "sources", { relation: "context" });
  assert.ok(context.includes('Reference 3')); assert.ok(!context.includes('Reference 1 ·'));
  const empty = render(decision, "sources", { q: '<script>canary</script>', relation: "supports" });
  assert.ok(empty.includes('No reference matches these filters'));
  assert.ok(empty.includes('does not establish that evidence is absent elsewhere'));
  assert.ok(empty.includes('complete dossier includes conflicting evidence'));
  assert.ok(empty.includes('&lt;script&gt;')); assert.ok(!empty.includes('<script>'));
  assert.ok(!empty.includes(decision.issue.claims[0].assertion));
});
test("statement type filtering cannot turn an empty result into an absence claim and main evidence stays complete", async () => {
  const decision = await decisionFor(sample());
  const search = render(decision, "search", { type: "funding" });
  assert.ok(search.includes('0 statements match')); assert.ok(!search.includes(decision.issue.claims[0].assertion));
  const full = render(decision, "issue");
  for (const source of decision.issue.claims[0].evidence) assert.ok(full.includes(source.locator));
  const found = render(decision, "search", { type: "condition", q: "cell A1" });
  assert.ok(found.includes('Matched in: Exact location'));
  assert.ok(found.includes('statement includes conflicting evidence'));
});
test("a newer checked head and withdrawn rights withhold old statements, references and search results across all views", async () => {
  const first = sample(), oldId = first.publication.id;
  const successor = JSON.parse(JSON.stringify(first).replaceAll(oldId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  const current = await decisionFor(successor); assert.equal(current.status, 200);
  const withdrawn = structuredClone(first); withdrawn.sources[0].registration.allow_public_derived = false;
  const held = await decisionFor(withdrawn); assert.equal(held.status, 503);
  for (const view of ["issue", "sources", "search"]) {
    for (const [decision, message] of [[current, "A newer publication is available"], [held, "Issue temporarily unavailable"]]) {
      const html = render(decision, view, { edition: oldId });
      assert.ok(html.includes(message)); assert.ok(!html.includes(first.publication.snapshot.claims[0].assertion));
      assert.ok(!html.includes(first.publication.snapshot.claims[0].evidence[0].url));
      assert.ok(!html.includes('name="q"')); assert.ok(!html.includes('name="edition"'));
      assert.ok(!html.includes("textarea")); assert.ok(!html.includes("current-issue-correction"));
      assert.ok(!html.includes("current-source-list")); assert.ok(!html.includes('aria-current="page"'));
    }
  }
});
test("absent and unconfigured decisions have recovery links and no inferred source or sample fallback", async () => {
  const unconfigured = await createPublicIssueReader()(sample().requestedRoute);
  for (const decision of [unconfigured, await decisionFor(null)]) {
    const html = render(decision, "issue"); assert.ok(html.includes('role="status"'));
    assert.ok(html.includes('href="/reader-preview/imaginary-place/sample-housing-measure/issue"'));
    assert.ok(!html.includes("claim-sources")); assert.ok(!html.includes("24%"));
  }
});
test("actual multi-view route refuses nondevelopment and invalid selectors before touching the provider", async () => {
  const calls = [], marker = new Error("NOT_FOUND");
  const intercept = name => name === "next/navigation" ? { notFound() { throw marker; } } : name.endsWith("public-issue-reader") ? {
    canonicalPublicIssueRoute, readPublicIssue: async route => { calls.push(route); return decisionFor(sample()); },
  } : undefined;
  for (const environment of [undefined, "production", "test"]) {
    const page = load("../app/reader-preview/[country]/[issue]/[view]/page.tsx", intercept, { env: { NODE_ENV: environment } }).default;
    const forbidden = { then() { assert.fail("Forbidden route parameters observed"); } };
    await assert.rejects(page({ params: forbidden, searchParams: forbidden }), error => error === marker);
    await assert.rejects(page({ get params() { assert.fail("Production params getter touched"); },
      get searchParams() { assert.fail("Production query getter touched"); } }), error => error === marker);
  }
  const page = load("../app/reader-preview/[country]/[issue]/[view]/page.tsx", intercept).default;
  const route = { country: "imaginary-place", issue: "sample-housing-measure", view: "search" };
  for (const [params, query] of [[{ ...route, view: "private" }, {}], [{ ...route, country: "../private" }, {}],
    [{ ...route, path: "private" }, {}], [route, { source: "private-canary" }], [route, { edition: [sample().publication.id] }],
    [route, { type: "constructor" }], [route, { relation: "supports" }], [{ ...route, view: "sources" }, { relation: ["context"] }]])
    await assert.rejects(page({ params: Promise.resolve(params), searchParams: Promise.resolve(query) }), error => error === marker);
  assert.deepEqual(calls, []);
});
test("actual page reads only the current route once and passes the edition solely to the view", async () => {
  const calls = [], record = sample();
  const page = load("../app/reader-preview/[country]/[issue]/[view]/page.tsx", name => name === "next/navigation" ? {
    notFound() { assert.fail("Valid view refused"); },
  } : name.endsWith("public-issue-reader") ? { canonicalPublicIssueRoute, readPublicIssue: async route => {
    calls.push(route); return decisionFor(record);
  } } : undefined).default;
  const element = await page({ params: Promise.resolve({ country: "imaginary-place", issue: "sample-housing-measure", view: "search" }),
    searchParams: Promise.resolve({ edition: record.publication.id, q: "example year" }) });
  const html = renderToStaticMarkup(element);
  assert.deepEqual(calls, [record.requestedRoute]); assert.ok(html.includes("1 statement matches"));
  assert.ok(html.replaceAll("<mark>", "").replaceAll("</mark>", "").includes(record.publication.snapshot.claims[0].assertion));
});
