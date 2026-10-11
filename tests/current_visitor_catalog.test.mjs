import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentCatalogueSelection, currentCatalogueResult, currentCatalogueHref } from "../src/current-visitor-catalog.ts";
import { loadCurrentVisitorCatalogue } from "../src/server/current-visitor-catalog.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const record = sample();
const entry = { ...record.requestedRoute, country: "Imaginary place", countryAliases: ["Imaginary place", "Imaginary"], topic: "housing", topicLabel: "Housing" };
const reader = candidate => createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(candidate)));
const read = query => loadCurrentVisitorCatalogue(query, reader(record), entry);
const View = loadTsx(new URL("../src/current-visitor-catalog-view.tsx", import.meta.url)).CurrentVisitorCatalogueView;
const render = result => renderToStaticMarkup(createElement(View, { result, entry }));

test("closed catalogue selectors reject malformed, repeated, private and unknown values before reading", async () => {
  let calls = 0;
  for (const query of [null, [], "housing", { view: "constructor" }, { view: ["issues"] }, { q: null }, { q: ["x"] },
    { q: "x".repeat(81) }, { q: "x\0" }, { q: "\ufdfa".repeat(5) }, { country: "another-place" }, { country: [entry.jurisdictionSlug] },
    { topic: "political-score" }, { topic: null }, { edition: record.publication.id + "x" }, { edition: [record.publication.id] },
    { role: "private-canary" }, { source: "https://example.org/private" }, { path: "/tmp/private" }]) {
    const result = await loadCurrentVisitorCatalogue(query, async () => { calls++; throw new Error("must not read"); }, entry);
    assert.deepEqual(result, { kind: "invalid" }, JSON.stringify(query));
  }
  assert.equal(calls, 0);
});
test("one actual materializer read drives all three directory views, exact edition links and dossier entry", async () => {
  for (const view of ["overview", "countries", "issues"]) {
    const calls = [];
    const result = await loadCurrentVisitorCatalogue({ view, edition: record.publication.id }, async route => {
      calls.push(route); return reader(record)(route);
    }, entry);
    assert.equal(result.kind, "available"); assert.equal(result.matches, true);
    assert.deepEqual(calls, [record.requestedRoute]);
    const html = render(result);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.ok(html.includes(`edition=${record.publication.id}`));
    assert.ok(html.includes("one selected reader route"));
    if (view !== "countries") assert.ok(html.includes(`/reader-preview/${entry.jurisdictionSlug}/${entry.issueSlug}/issue?edition=${record.publication.id}`));
    assert.ok(!html.includes("registration_id") && !html.includes("qualification_id"));
  }
});
test("available empty search is separate from absence, unknown access and replacement", async () => {
  const empty = await read({ view: "issues", q: "missing-canary" });
  assert.equal(empty.kind, "available"); assert.equal(empty.matches, false);
  assert.ok(render(empty).includes("No match in this selected scope"));
  for (const [decision, expected] of [[{ status: 404, cacheControl: "no-store" }, "absent"], [{ status: 503, cacheControl: "no-store" }, "unavailable"]]) {
    const result = currentCatalogueResult(decision, currentCatalogueSelection({}, entry), entry);
    assert.equal(result.kind, expected);
    const html = render(result); assert.ok(!html.includes(record.publication.snapshot.title));
    assert.ok(!html.includes("1 dossier matches") && !html.includes("0 dossier matches"));
  }
  const changed = await read({ edition: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  assert.equal(changed.kind, "changed"); assert.ok(!render(changed).includes(record.publication.snapshot.title));
});
test("literal normalized discovery covers only country names or dossier place, topic, title and summary", async () => {
  for (const q of ["imaginary housing", "Ｈｏｕｓｉｎｇ", "  imaginary   place  "])
    assert.equal((await read({ view: "issues", q })).matches, true, q);
  assert.equal((await read({ view: "countries", q: "housing" })).matches, false);
  assert.equal((await read({ view: "issues", q: record.publication.snapshot.claims[0].evidence[0].locator })).matches, false);
  const html = render(await read({ view: "issues", q: "<script>canary</script>" }));
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
});
test("wrong route or extended projection withholds the entire result rather than borrowing provider content", async () => {
  const decision = await reader(record)(record.requestedRoute), selection = currentCatalogueSelection({}, entry);
  for (const issue of [{ ...decision.issue, issueSlug: "another-issue" }, { ...decision.issue, privateToken: "private-canary" }]) {
    const result = currentCatalogueResult({ ...decision, issue }, selection, entry);
    assert.equal(result.kind, "unavailable"); assert.ok(!render(result).includes("private-canary"));
  }
});
test("default absent provider has no fixture fallback; unexpected seam failure logs only its fixed operation", async () => {
  assert.equal((await loadCurrentVisitorCatalogue({})).kind, "unavailable");
  const codes = [];
  const failed = await loadCurrentVisitorCatalogue({}, async () => { throw new Error("private-canary"); }, entry,
    async code => { codes.push(code); throw new Error("logger failure"); });
  assert.equal(failed.kind, "unavailable"); assert.deepEqual(codes, ["public_issue_read"]);
  assert.ok(!render(failed).includes("private-canary"));
});
test("actual page refuses production before input getters and any reader invocation", async () => {
  const marker = new Error("not-found"); let reads = 0, observed = 0;
  const intercept = name => name === "next/navigation" ? { notFound() { throw marker; } } : name.includes("server/current-visitor-catalog") ? {
    loadCurrentVisitorCatalogue: async query => { reads++; return read(query); },
  } : undefined;
  const page = loadTsx(new URL("../app/reader-preview/catalogue/page.tsx", import.meta.url), intercept, { env: { NODE_ENV: "production" } }).default;
  await assert.rejects(page(Object.defineProperty({}, "searchParams", { get() { observed++; throw new Error("private"); } })), error => error === marker);
  assert.equal(reads, 0); assert.equal(observed, 0);
});
test("directory links contain only closed presentation scope and an edition, never source or store selectors", () => {
  const href = currentCatalogueHref("issues", record.publication.id, entry.jurisdictionSlug);
  const url = new URL(href, "https://example.org");
  assert.deepEqual([...url.searchParams.keys()], ["view", "edition", "country"]);
  assert.equal(url.pathname, "/reader-preview/catalogue");
});

test("throwing, rejected and nonsettling diagnostics never delay or alter catalogue refusal", async () => {
  for (const record of [() => { throw new Error("private-log-canary"); }, () => Promise.reject(new Error("private-log-canary")), () => new Promise(() => {})]) {
    const result = await Promise.race([loadCurrentVisitorCatalogue({}, async () => { throw new Error("private-reader-canary"); }, entry, record),
      new Promise(resolve => setTimeout(() => resolve("review_timeout"), 30))]);
    assert.notEqual(result, "review_timeout"); assert.equal(result.kind, "unavailable");
    const html = render(result); assert.ok(!html.includes("private-reader-canary") && !html.includes("private-log-canary"));
  }
});
