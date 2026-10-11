import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { interpretPublicReadCandidate } from "../src/public-read-outcome.ts";
import { createPublicIssueReader, createDevelopmentPublicIssueHandler } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";

// Real readers and presenters with invented rows. No DB, transport, renderer,
// Browser or HTTP server. Snapshot dates have no accepted metadata witness.
function load(file) {
  const exports = {}, native = createRequire(file);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)(name => {
    if (name.startsWith(".")) {
      const full = new URL(name, file);
      if (full.pathname.endsWith(".tsx")) return load(full);
      if (existsSync(new URL(full.href + ".tsx"))) return load(new URL(full.href + ".tsx"));
      if (existsSync(new URL(full.href + ".ts"))) return native(name + ".ts");
    }
    return native(name);
  }, exports);
  return exports;
}
const Evidence = load(new URL("../app/issue-evidence.tsx", import.meta.url)).IssueEvidence;
const Navigation = load(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test("unbound earlier snapshot dates are withheld from a fresh projection without changing its retained publication", () => {
  for (const date of ["1999-01-01", "2001-05-14", null]) {
    const candidate = sample();
    for (const source of candidate.publication.snapshot.claims[0].evidence) source.sourcePublishedOn = date;
    const before = JSON.stringify(candidate), issue = materializePublicIssueFromRows(candidate);
    assert.ok(issue.claims[0].evidence.every(source => source.sourcePublishedOn === null));
    assert.equal(JSON.stringify(candidate), before);
    assert.equal(issue.publicationId, candidate.publication.id);
    assert.equal(issue.claims[0].assertion, candidate.claims[0].assertion);
    assert.equal(issue.claims[0].evidence.length, candidate.citations.length);
    for (const source of issue.claims[0].evidence) {
      const retained = candidate.publication.snapshot.claims[0].evidence.find(item => item.locator === source.locator);
      for (const key of ["url", "retrievedAt", "title", "locator", "relation", "publisher"])
        assert.equal(source[key], retained[key]);
    }
  }
});

test("date containment follows existing consistency checks and cannot turn an invalid candidate into eligible content", () => {
  for (const mutate of [
    c => c.publication.snapshot.claims[0].evidence[0].sourcePublishedOn = "2099-01-01",
    c => c.publication.snapshot.claims[0].evidence[0].sourcePublishedOn = "2026-02-30",
    c => c.publication.snapshot.claims[0].evidence[0].title = "Unreviewed title",
    c => c.sources[0].registration.allow_public_derived = false,
    c => c.head.current_publication_id = c.dossier.id,
    c => c.citations.pop(),
    c => c.publication.snapshot.claims[0].evidence[0].originalLanguage = "en",
  ]) {
    const candidate = sample(); mutate(candidate);
    assert.deepEqual(interpretPublicReadCandidate(candidate), { kind: "rejected" });
  }
});

test("raw version dates and translated title language are not accepted metadata provenance", () => {
  const candidate = sample();
  for (const source of candidate.sources) {
    source.version.published_at = "1999-01-01T00:00:00Z";
    source.version.language_code = "private-unqualified-language-canary";
    source.display_review.title_language = "fr";
  }
  const result = interpretPublicReadCandidate(candidate);
  assert.equal(result.kind, "issue");
  assert.ok(result.issue.claims[0].evidence.every(source => source.sourcePublishedOn === null));
  const json = JSON.stringify(result.issue);
  for (const token of ["1999-01-01", "published_at", "language_code", "private-unqualified-language-canary", "title_language"])
    assert.ok(!json.includes(token), token);
});

test("the actual reader and development GET expose only contained public dates and preserve current request binding", async () => {
  const candidate = sample(), before = JSON.stringify(candidate), calls = [];
  const reader = createPublicIssueReader(async (route, signal) => {
    calls.push({ route, aborted: signal.aborted });
    return new TextEncoder().encode(JSON.stringify(candidate));
  });
  const handler = createDevelopmentPublicIssueHandler(reader);
  const response = await handler(new Request("http://127.0.0.1:3100/api/dev/public-issue/imaginary-place/sample-housing-measure",
    { headers: { "sec-fetch-site": "same-origin" } }),
    { params: Promise.resolve({ country: "imaginary-place", issue: "sample-housing-measure" }) }, "development");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.ok(body.issue.claims[0].evidence.every(source => source.sourcePublishedOn === null));
  assert.equal(body.issue.publicationId, candidate.publication.id);
  assert.deepEqual(calls, [{ route: candidate.requestedRoute, aborted: false }]);
  assert.equal(JSON.stringify(candidate), before);
});

test("both actual dossier and source-navigation views disclose unknown date and original language", async () => {
  const candidate = sample();
  const decision = await createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(candidate)))(candidate.requestedRoute);
  assert.equal(decision.status, 200);
  for (const html of [render(Evidence, { issue: decision.issue }), render(Navigation, {
    decision, selection: currentIssueSelection("sources", {}), latestHref: "/reader-preview/imaginary-place/sample-housing-measure/sources",
  })]) {
    assert.ok(html.includes("No verified source publication date supplied"));
    assert.ok(html.includes("Original language"));
    assert.ok(html.includes("Not supplied in this publication"));
    assert.ok(html.includes("English display title does not identify the source"));
    for (const source of candidate.publication.snapshot.claims[0].evidence)
      assert.ok(!html.includes(`dateTime="${source.sourcePublishedOn}"`));
    assert.ok(html.includes(`dateTime="${decision.issue.lastEvidenceReviewOn}"`));
    assert.ok(html.includes(`dateTime="${decision.issue.claims[0].evidence[0].retrievedAt}"`));
  }
});
