import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { operatorAuditReportSchema } from "../src/operator-audit-report.ts";

// Actual TypeScript presenter and shared PageIntro rendered by React SSR. No
// placeholder view, Browser, HTTP, database or operational account is used.
const modules = new Map();
function load(source) {
  if (modules.has(source.href)) return modules.get(source.href);
  const exports = {}, native = createRequire(source);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  modules.set(source.href, exports);
  new Function("require", "exports", compiled)(name => {
    if (name.startsWith(".")) {
      const candidate = new URL(name.endsWith(".tsx") ? name : name + ".tsx", source);
      if (existsSync(candidate)) return load(candidate);
    }
    return native(name);
  }, exports);
  return exports;
}
const { OperatorAuditView } = load(new URL("../src/operator-audit-view.tsx", import.meta.url));
const uuid = n => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function sample() {
  return {
    schemaVersion: 1, status: "ok", requested: { runId: uuid(1), issueId: uuid(2), cursor: null },
    observedAt: "2026-10-05T10:00:00Z",
    run: { runId: uuid(1), jurisdictionId: "invented-jurisdiction", mode: "shadow", runState: "completed", commitState: "committed", visibilityState: "verified", createdAt: "2026-10-05T09:00:00Z", finishedAt: "2026-10-05T09:05:00Z" },
    expectedSourcesKnown: true,
    sources: [{ registrationId: uuid(3), sourceKey: "invented:source", registrationState: "retired", allowFetch: false, fetchEnabled: false, reviewedAt: "2026-10-05T09:30:00Z", outcome: "captured", checkedAt: "2026-10-05T09:01:00Z", sourceVersionId: uuid(4) }],
    history: { issueId: uuid(2), latestRevision: 3, headPublicationId: uuid(5), headRevision: 1,
      publications: [{ publicationId: uuid(6), revision: 3, supersedesPublicationId: uuid(5), publicationKind: "correction", createdAt: "2026-10-05T09:03:00Z", isHead: false },
        { publicationId: uuid(5), revision: 1, supersedesPublicationId: null, publicationKind: "accepted", createdAt: "2026-10-05T09:02:00Z", isHead: true }], nextCursor: null },
  };
}
const checked = input => operatorAuditReportSchema.parse(input);
const render = (decision, selection) => renderToStaticMarkup(createElement(OperatorAuditView, { decision, selection }));

test("actual audit SSR separates query-observed registration and review from historical checks and visibility receipts", () => {
  const value = checked(sample()), html = render({ kind: "ok", report: value });
  for (const text of ["Query-observed registration state", "Retired", "Not allowed", "Disabled", "Historical run check outcome", "Captured", "Verified receipt", "not establish current source health", "not establish current public eligibility or visibility"])
    assert.ok(html.includes(text), text);
  for (const stamp of [value.observedAt, value.sources[0].reviewedAt, value.sources[0].checkedAt, value.run.createdAt, value.run.finishedAt])
    assert.ok(html.includes(`dateTime="${stamp}"`), stamp);
  assert.ok(html.includes('<h1>Recorded source and publication audit</h1>'));
  assert.ok(html.includes('aria-label="Recorded source registrations and checks"'));
  assert.ok(!html.includes("Source healthy")); assert.ok(!html.includes("Currently published"));
});

test("every held decision stays distinct and detail-free; missing access is not healthy or empty data", () => {
  const labels = { invalid_scope: "Choose a recorded run and issue", unconfigured: "Recorded audit connection unavailable", unavailable: "Recorded audit unavailable", not_found: "No matching recorded audit", changed: "Publication ledger changed" };
  for (const [kind, label] of Object.entries(labels)) {
    const html = render({ kind, report: sample(), privateNote: "private-canary" });
    assert.ok(html.includes(label)); assert.ok(html.includes('role="status"'));
    for (const text of ["private-canary", "invented:source", uuid(1), "Stored publication history", "Query observed at (UTC)"])
      assert.ok(!html.includes(text), `${kind}: ${text}`);
  }
  assert.ok(render({ kind: "changed" }).includes("newest revision or stored head changed"));
  assert.ok(render({ kind: "unavailable" }).includes("not an empty or healthy result"));
});

test("unknown expected source coverage and absent revision data remain explicit without a success claim", () => {
  const value = sample(); value.expectedSourcesKnown = false; value.sources = [];
  value.history = { issueId: uuid(2), latestRevision: 0, headPublicationId: null, headRevision: null, publications: [], nextCursor: null };
  const html = render({ kind: "ok", report: checked(value) });
  for (const text of ["expected source set is unknown", "complete coverage cannot be inferred", "No source checks returned", "No publication records returned", "No head recorded"])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Older stored revisions"));
});

test("held history preserves only validated caller selection and fresh restart clears the cursor", () => {
  const selection = { runId: uuid(1), issueId: uuid(2), cursor: { latestRevision: 25, headPublicationId: uuid(5), beforeRevision: 6 } };
  for (const kind of ["changed", "unconfigured", "unavailable", "not_found"]) {
    const html = render({ kind, report: sample() }, selection);
    assert.ok(html.includes(`value="${uuid(1)}"`)); assert.ok(html.includes(`value="${uuid(2)}"`));
    const href = html.match(/href="([^"]+)">Start a fresh audit<\/a>/)?.[1]; assert.ok(href);
    const link = new URL(href.replaceAll("&amp;", "&"), "http://example.invalid");
    assert.deepEqual([...link.searchParams.keys()], ["runId", "issueId"]);
    assert.equal(link.searchParams.get("runId"), uuid(1)); assert.equal(link.searchParams.get("issueId"), uuid(2));
    for (const text of ["invented:source", "Stored publication history", "Query observed at (UTC)", "beforeRevision="])
      assert.ok(!html.includes(text), text);
  }
  for (const bad of [{ ...selection, privatePath: "private-canary" }, { ...selection, runId: "private-canary" }, { ...selection, cursor: { ...selection.cursor, beforeRevision: 26 } }]) {
    const html = render({ kind: "changed" }, bad);
    assert.ok(!html.includes(uuid(1))); assert.ok(!html.includes("private-canary"));
  }
  assert.ok(!render({ kind: "invalid_scope" }, selection).includes(uuid(1)));
  const ok = render({ kind: "ok", report: checked(sample()) }, { runId: uuid(9), issueId: uuid(10), cursor: null });
  assert.ok(ok.includes(`value="${uuid(1)}"`)); assert.ok(!ok.includes(`value="${uuid(9)}"`));
});

test("five recorded check outcomes and four registration states retain their separate meanings", () => {
  const value = sample();
  value.sources = ["captured", "unchanged", "failed", "deferred", "not_recorded"].map((outcome, index) => ({
    registrationId: uuid(30 + index), sourceKey: `invented:${index}`, registrationState: ["candidate", "approved", "suspended", "retired", "candidate"][index],
    allowFetch: index === 1, fetchEnabled: index === 1, reviewedAt: index === 1 ? "2026-10-05T09:30:00Z" : null,
    outcome, checkedAt: index === 4 ? null : "2026-10-05T09:01:00Z", sourceVersionId: index < 2 ? uuid(40 + index) : null,
  }));
  const html = render({ kind: "ok", report: checked(value) });
  for (const text of ["Captured", "Unchanged", "Failed", "Deferred", "No check recorded", "Candidate", "Approved", "Suspended", "Retired", "No version recorded", "Not recorded"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes("Missing checks remain explicitly unrecorded"));
});

test("gapped revisions remain descending with a stored head distinct from the newest accepted/correction record", () => {
  const html = render({ kind: "ok", report: checked(sample()) });
  assert.ok(html.indexOf("Revision 3 · Correction") < html.indexOf("Revision 1 · Accepted"));
  assert.ok(!html.includes("Revision 2"));
  assert.ok(html.includes("Stored head: revision 1"));
  assert.ok(html.includes("Stored head for this snapshot"));
  assert.ok(html.includes("Revision numbers may have gaps"));
  assert.ok(html.includes("These issue revisions are not attributed to the selected run"));
  assert.ok(html.includes('aria-label="Stored publication revisions, newest first"'));
});

test("older-page links preserve newest revision and explicit nullable head with the actual last returned cursor", () => {
  for (const nullHead of [false, true]) {
    const value = sample(), head = nullHead ? null : uuid(101);
    value.history = { issueId: uuid(2), latestRevision: 25, headPublicationId: head, headRevision: nullHead ? null : 1,
      publications: Array.from({ length: 20 }, (_, index) => { const revision = 25 - index; return {
        publicationId: uuid(100 + revision), revision, supersedesPublicationId: uuid(99 + revision), publicationKind: revision === 25 ? "suppression" : "draft", createdAt: "2026-10-05T09:03:00Z", isHead: false,
      }; }), nextCursor: { latestRevision: 25, headPublicationId: head, beforeRevision: 6 } };
    const html = render({ kind: "ok", report: checked(value) });
    const href = html.match(/href="([^"]+)">Older stored revisions<\/a>/)?.[1]; assert.ok(href);
    const parsed = new URL(href.replaceAll("&amp;", "&"), "http://example.invalid");
    assert.equal(parsed.pathname, "/editorial-preview/audit");
    assert.deepEqual([...parsed.searchParams.keys()], ["runId", "issueId", "latestRevision", "headPublicationId", "beforeRevision"]);
    assert.equal(parsed.searchParams.get("runId"), uuid(1)); assert.equal(parsed.searchParams.get("issueId"), uuid(2));
    assert.equal(parsed.searchParams.get("latestRevision"), "25"); assert.equal(parsed.searchParams.get("headPublicationId"), head ?? ""); assert.equal(parsed.searchParams.get("beforeRevision"), "6");
    assert.ok(html.includes("Revision 25 · Suppression"));
    assert.equal(html.includes("stored head is outside this page"), !nullHead);
    assert.ok(!html.includes('href="https:'));
  }
});

test("malformed or extended direct report injection withholds every row and source/URL/private canary", () => {
  const variants = [value => { value.privatePath = "private-canary"; }, value => { value.sources[0].endpoint = "https://private-canary.invalid"; },
    value => { value.history.publications[0].rawSnapshot = "private-canary"; }, value => { value.history.headRevision = 3; }, value => { value.sources[0].checkedAt = "2027-01-01T00:00:00Z"; }];
  for (const change of variants) {
    const value = sample(); change(value); const html = render({ kind: "ok", report: value });
    assert.ok(html.includes("Recorded audit unavailable"));
    for (const text of ["private-canary", "invented:source", uuid(1), "Stored publication history", "Captured", "Revision 3"])
      assert.ok(!html.includes(text), text);
  }
});

test("actual React view escapes permitted identifiers and does not mutate a deeply frozen checked report", () => {
  const value = sample(); value.run.jurisdictionId = "<img src=x onerror=identifier-canary>";
  const report = checked(value), before = JSON.stringify(report);
  const freeze = item => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(report); const html = render({ kind: "ok", report });
  assert.ok(html.includes("&lt;img src=x onerror=identifier-canary&gt;")); assert.ok(!html.includes("<img"));
  assert.equal(JSON.stringify(report), before);
  assert.ok(html.includes('method="get"')); assert.ok(html.includes('action="/editorial-preview/audit"'));
  for (const name of ["runId", "issueId"]) assert.ok(html.includes(`name="${name}"`));
  assert.ok(!html.includes('name="sql"')); assert.ok(!html.includes("<textarea"));
});
