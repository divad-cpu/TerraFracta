import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

// Compile the exact presenter and its exact existing evidence component in memory.
// No HTTP, browser/DOM, server startup or private filesystem store is accessed.
function moduleAt(relative, intercept = () => undefined, processValue) {
  const source = new URL(relative, import.meta.url), exports = {}, nativeRequire = createRequire(source);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", "process", compiled)(name => {
    const replacement = intercept(name);
    if (replacement !== undefined) return replacement;
    if (name.startsWith(".") && name.endsWith(".tsx")) return moduleAt(new URL(name, source).href, intercept, processValue);
    return nativeRequire(name);
  }, exports, processValue);
  return exports;
}
const evidence = moduleAt("../app/issue-evidence.tsx");
const { PublicIssueReadView } = moduleAt("../src/public-issue-read-view.tsx", name => name.endsWith("issue-evidence.tsx") ? evidence : undefined);
const render = decision => renderToStaticMarkup(createElement(PublicIssueReadView, { decision }));
const bytes = value => new TextEncoder().encode(JSON.stringify(value));

test("actual server connector output renders adjacent locators, three evidence relations and missing-date wording", async () => {
  const candidate = sample();
  candidate.publication.snapshot.claims[0].evidence[0].sourcePublishedOn = null;
  const decision = await createPublicIssueReader(async () => bytes(candidate))(candidate.requestedRoute);
  assert.equal(decision.status, 200); const markup = render(decision);
  for (const text of [decision.issue.title, decision.issue.claims[0].assertion, "Supports this wording", "Points to a conflict", "Adds context", "Not supplied", "Local reader preview"])
    assert.ok(markup.includes(text), text);
  for (const source of decision.issue.claims[0].evidence) {
    assert.ok(markup.includes(source.locator)); assert.ok(markup.includes(source.retrievedAt));
  }
  assert.ok(!markup.includes("registration_state")); assert.ok(!markup.includes("<form"));
  assert.equal((markup.match(/<h1>/g) ?? []).length, 1);
});
test("absent and held decisions render different messages and withhold every earlier claim/source", async () => {
  const candidate = sample();
  const initial = await createPublicIssueReader(async () => bytes(candidate))(candidate.requestedRoute);
  for (const [decision, message] of [[{ status: 404, cacheControl: "no-store" }, "No eligible issue found"],
    [{ status: 503, cacheControl: "no-store" }, "Issue temporarily unavailable"]]) {
    const markup = render(decision); assert.ok(markup.includes(message)); assert.ok(markup.includes('role="status"'));
    assert.ok(!markup.includes(initial.issue.claims[0].assertion));
    assert.ok(!markup.includes(initial.issue.claims[0].evidence[0].url));
    assert.equal((markup.match(/<h1>/g) ?? []).length, 1);
  }
});
test("actual page refuses production or invalid selectors before reader access", async () => {
  for (const environment of [undefined, "production", "test", "development"]) {
    const calls = [], marker = new Error("NEXT_NOT_FOUND");
    const page = moduleAt("../app/reader-preview/[country]/[issue]/page.tsx", name => {
      if (name === "next/navigation") return { notFound() { throw marker; } };
      if (name.endsWith("public-issue-reader")) return { canonicalPublicIssueRoute: value => value.issueSlug === "valid" ? value : null,
        readPublicIssue: async value => { calls.push(value); return { status: 503, cacheControl: "no-store" }; } };
      if (name.endsWith("public-issue-read-view")) return { PublicIssueReadView };
    }, { env: { NODE_ENV: environment } }).default;
    const forbidden = { then() { assert.fail("Production params touched"); } };
    if (environment !== "development") {
      await assert.rejects(page({ params: forbidden, searchParams: forbidden }), error => error === marker);
      await assert.rejects(page({ get params() { assert.fail("Production params getter touched"); },
        get searchParams() { assert.fail("Production query getter touched"); } }), error => error === marker);
    } else {
      for (const [params, query] of [[{ country: "norway", issue: "../invalid" }, {}],
        [{ country: "norway", issue: "valid" }, { source: "private-canary" }],
        [{ country: "norway", issue: "valid", path: "canary" }, {}]])
        await assert.rejects(page({ params: Promise.resolve(params), searchParams: Promise.resolve(query) }), error => error === marker);
    }
    assert.deepEqual(calls, []);
  }
});
test("actual page routes one checked decision to the actual presenter", async () => {
  const candidate = sample(), read = createPublicIssueReader(async () => bytes(candidate)), calls = [];
  const { canonicalPublicIssueRoute } = await import("../src/server/public-issue-reader.ts");
  const page = moduleAt("../app/reader-preview/[country]/[issue]/page.tsx", name => {
    if (name === "next/navigation") return { notFound() { assert.fail("Valid development page refused"); } };
    if (name.endsWith("public-issue-reader")) return { canonicalPublicIssueRoute, readPublicIssue: async value => { calls.push(value); return read(value); } };
    if (name.endsWith("public-issue-read-view")) return { PublicIssueReadView };
  }, { env: { NODE_ENV: "development" } }).default;
  const element = await page({ params: Promise.resolve({ country: candidate.requestedRoute.jurisdictionSlug, issue: candidate.requestedRoute.issueSlug }), searchParams: Promise.resolve({}) });
  const markup = renderToStaticMarkup(element);
  assert.deepEqual(calls, [candidate.requestedRoute]); assert.ok(markup.includes(candidate.publication.snapshot.title));
  assert.ok(markup.includes(candidate.publication.snapshot.claims[0].assertion));
});
