import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { audit, id, scope, bytes } from "./helpers/operator_audit_fixture.mjs";
import * as navigation from "../src/operator-audit-navigation.ts";
import { createOperatorAuditReader } from "../src/server/operator-audit-reader.ts";
import { operatorAuditReportSchema } from "../src/operator-audit-report.ts";

const View = loadTsx(new URL("../src/operator-audit-view.tsx", import.meta.url)).OperatorAuditView;
const states = ["candidate", "approved", "suspended", "retired"];
const returnValue = { runId: id(1), cursor: { createdAt: "2026-10-05T09:30:00.000001Z", runId: id(99) }, state: "completed", issueQuery: "housing costs" };
const attributes = text => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2].replaceAll("&amp;", "&")]));
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(match => ({ ...attributes(match[1]), text: match[2] }));
const query = href => Object.fromEntries(new URL(href, "https://example.invalid").searchParams);
const linkQuery = (html, label) => query(links(html).find(row => row.text === label)?.href ?? assert.fail(`Missing ${label}`));
const rows = html => /<ul[^>]*aria-label="Recorded source registrations and checks"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
function sample(cursor = null) {
  const report = audit(); report.requested.cursor = cursor;
  report.sources = states.map((registrationState, index) => ({ ...report.sources[0], registrationId: id(30 + index),
    sourceKey: `invented:source-${registrationState}`, registrationState, allowFetch: index % 2 === 1,
    fetchEnabled: false, outcome: "captured", sourceVersionId: id(100 + index),
  }));
  report.sources.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  if (cursor) {
    report.history.latestRevision = cursor.latestRevision; report.history.headRevision = 22;
    report.history.headPublicationId = cursor.headPublicationId; report.history.publications.forEach(row => { row.isHead = false; });
  }
  return operatorAuditReportSchema.parse(report);
}
const render = (props = {}) => renderToStaticMarkup(View({ decision: { kind: "ok", report: sample() }, runReturn: returnValue, ...props }));

test("closed registration query accepts only existing states and keeps legacy grammar byte-equivalent", () => {
  for (const registration of states) {
    const selected = navigation.auditBrowseSelection({ runId: id(1), issueId: id(2), registration });
    assert.equal(selected?.registrationState, registration); assert.deepEqual(selected.scope, scope());
  }
  for (const registration of ["Approved", " suspended ", "unknown", [], null, false, 0, undefined])
    assert.equal(navigation.auditBrowseSelection({ runId: id(1), issueId: id(2), registration }), null);
  assert.deepEqual(navigation.auditBrowseSelection({ runId: id(1), issueId: id(2) }), { scope: scope(), runReturn: null });
  assert.equal(navigation.auditBrowseHref(scope()), `/editorial-preview/audit?runId=${id(1)}&issueId=${id(2)}`);
});

test("registration rows intersect historical outcome and source search without upgrading captured suspended checks", () => {
  const html = render({ registrationState: "suspended", outcome: "captured", sourceQuery: "source-suspended", publicationKind: "correction" });
  assert.ok(html.includes("Showing 1 of 4 source registrations")); assert.ok(rows(html).includes("invented:source-suspended"));
  assert.ok(!rows(html).includes("invented:source-approved")); assert.ok(rows(html).includes("Captured"));
  assert.ok(rows(html).includes("Suspended")); assert.ok(rows(html).includes("Not allowed"));
  assert.ok(html.includes("Captured: 4")); for (const label of ["Candidate", "Approved", "Suspended", "Retired"]) assert.ok(html.includes(`${label}: 1`));
  assert.ok(html.includes("Revision 2")); assert.ok(html.includes("Neither is a current source health assessment"));
  assert.equal(rows(render({ registrationState: "suspended", outcome: "unchanged" })), "");
  assert.equal(rows(render({ registrationState: "suspended", sourceQuery: "source-approved" })), "");
});

test("registration clear count history and other filter links retain independent search and both cursor selections", () => {
  const cursor = { latestRevision: 22, headPublicationId: id(222), beforeRevision: 3 };
  const html = render({ decision: { kind: "ok", report: sample(cursor) }, registrationState: "suspended", outcome: "captured", sourceQuery: "source", publicationKind: "correction" });
  for (const label of ["Clear source search", "Clear source outcome filter", "Clear publication kind filter", "Clear both audit filters", "Start a fresh audit", "Captured: 4", "Approved: 1"]) {
    const value = linkQuery(html, label); assert.equal(value.registration, label === "Approved: 1" ? "approved" : "suspended");
    assert.equal(value.returnIssueQ, "housing costs"); assert.equal(value.returnRunState, "completed");
    assert.equal(value.returnBeforeRunId, id(99)); assert.ok(navigation.auditBrowseSelection(value));
    if (label !== "Start a fresh audit") assert.equal(value.beforeRevision, "3");
  }
  const cleared = linkQuery(html, "Clear registration state filter"); assert.equal(cleared.registration, undefined);
  assert.equal(cleared.sourceQ, "source"); assert.equal(cleared.outcome, "captured"); assert.equal(cleared.publicationKind, "correction");
  assert.equal(cleared.beforeRevision, "3"); assert.equal(cleared.returnBeforeRunId, id(99));
  assert.equal(linkQuery(html, "Back to selected recorded-run page").registration, undefined);
});

test("all audit GET forms retain registration state except its own select and contain no write overrides", () => {
  const html = render({ registrationState: "suspended", outcome: "captured", sourceQuery: "source", publicationKind: "correction" });
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]; assert.equal(forms.length, 5);
  for (const [, attrs, body] of forms) {
    assert.equal(attributes(attrs).method, "get"); assert.equal(attributes(attrs).action, "/editorial-preview/audit");
    assert.equal([...body.matchAll(/name="registration"/g)].length, 1); assert.doesNotMatch(body, /formaction=|formmethod=|type="file"|method="post"/i);
  }
  assert.match(html, /<option value="suspended" selected="">Suspended<\/option>/);
});

test("actual route observes a registration selector once and invalid states refuse before provider or report access", async () => {
  const calls = [], reader = createOperatorAuditReader(async selected => { calls.push(selected); return bytes(sample(selected.cursor)); }, () => 0, () => assert.fail("unexpected diagnostic"));
  const Page = loadTsx(new URL("../app/editorial-preview/audit/page.tsx", import.meta.url), name => name === "next/navigation" ? { notFound() { assert.fail("production"); }, unstable_rethrow() {} }
    : name.endsWith("operator-audit-reader.ts") ? { readOperatorAudit: reader } : undefined).default;
  let count = 0; const input = { runId: id(1), issueId: id(2) };
  Object.defineProperty(input, "registration", { enumerable: true, get() { count++; return count === 1 ? "suspended" : "PRIVATE_CHANGED_CANARY"; } });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(input) }));
  assert.equal(count, 1); assert.equal(calls.length, 1); assert.deepEqual(calls[0], scope()); assert.ok(html.includes("Showing 1 of 4"));
  assert.doesNotMatch(html, /PRIVATE_CHANGED_CANARY/);
  for (const registration of ["unknown", ["approved"], undefined, "\0", "approved "]) {
    const denied = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ runId: id(1), issueId: id(2), registration }) }));
    assert.ok(denied.includes("Choose a recorded run and issue")); assert.equal(calls.length, 1);
  }
  let observed = 0;
  const denied = render({ registrationState: ["suspended"], decision: { kind: "ok", get report() { observed++; assert.fail("report read"); } } });
  assert.equal(observed, 0); assert.ok(denied.includes("Choose a recorded run and issue"));
});

test("held recovery preserves valid registration but withholds all report details and hidden selectors stay absent", () => {
  for (const kind of ["unconfigured", "unavailable", "not_found", "changed"]) {
    const html = render({ decision: { kind, report: sample() }, selection: scope(), registrationState: "suspended" });
    assert.equal(rows(html), ""); assert.ok(!html.includes("Captured: 4")); assert.equal(linkQuery(html, "Start a fresh audit").registration, "suspended");
  }
  for (const input of [Object.assign(Object.create({ registration: "PRIVATE" }), { runId: id(1), issueId: id(2) }),
    Object.defineProperty({ runId: id(1), issueId: id(2) }, "registration", { value: "PRIVATE", enumerable: false })]) {
    const selected = navigation.auditBrowseSelection(input); assert.ok(selected); assert.equal(Object.hasOwn(selected, "registrationState"), false);
  }
  const empty = sample(); empty.sources = []; empty.expectedSourcesKnown = false;
  const html = render({ decision: { kind: "ok", report: empty }, registrationState: "suspended" });
  assert.ok(html.includes("expected source set is unknown")); assert.ok(html.includes("No source checks returned"));
  assert.ok(html.includes("Suspended: 0")); assert.equal(rows(html), "");
});

test("actual GET form selections each deliver exactly one registration value and read only the existing private scope", async () => {
  const calls = [], reader = createOperatorAuditReader(async selected => { calls.push(selected); return bytes(sample(selected.cursor)); }, () => 0, () => assert.fail("diagnostic"));
  const Page = loadTsx(new URL("../app/editorial-preview/audit/page.tsx", import.meta.url), name => name === "next/navigation" ? { notFound() { assert.fail("production"); }, unstable_rethrow() {} }
    : name.endsWith("operator-audit-reader.ts") ? { readOperatorAudit: reader } : undefined).default;
  const html = render({ registrationState: "suspended", outcome: "captured", sourceQuery: "source", publicationKind: "correction" });
  for (const [, , body] of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const input = {};
    for (const [, attrs] of body.matchAll(/<input\b([^>]*)>/g)) {
      const value = attributes(attrs); assert.equal(Object.hasOwn(input, value.name), false); input[value.name] = value.value ?? "";
    }
    for (const [, attrs, options] of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const name = attributes(attrs).name; assert.equal(Object.hasOwn(input, name), false);
      input[name] = attributes(/<option\b([^>]*)selected=""[^>]*>/.exec(options)?.[1] ?? "").value ?? "";
    }
    assert.equal(input.registration, "suspended");
    const result = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(input) }));
    assert.ok(result.includes("Showing 1 of 4 source registrations"));
    assert.equal(linkQuery(result, "Start a fresh audit").registration, "suspended");
  }
  assert.equal(calls.length, 5); assert.ok(calls.every(value => JSON.stringify(value) === JSON.stringify(scope())));
});

test("count to older history to changed recovery keeps registration selection through actual successive reads", async () => {
  const report = sample(); report.history.latestRevision = 22; report.history.headRevision = 22; report.history.headPublicationId = id(222);
  report.history.publications = Array.from({ length: 20 }, (_, index) => ({ publicationId: id(222 - index), revision: 22 - index,
    supersedesPublicationId: id(221 - index), publicationKind: "correction", createdAt: "2026-10-05T09:03:00Z", isHead: index === 0 }));
  report.history.nextCursor = { latestRevision: 22, headPublicationId: id(222), beforeRevision: 3 };
  const calls = []; let changed = false;
  const reader = createOperatorAuditReader(async selected => {
    calls.push(selected); return bytes(changed ? { schemaVersion: 1, status: "changed", requested: selected } : selected.cursor ? sample(selected.cursor) : report);
  }, () => 0, () => assert.fail("diagnostic"));
  const Page = loadTsx(new URL("../app/editorial-preview/audit/page.tsx", import.meta.url), name => name === "next/navigation" ? { notFound() { assert.fail("production"); }, unstable_rethrow() {} }
    : name.endsWith("operator-audit-reader.ts") ? { readOperatorAudit: reader } : undefined).default;
  const visit = async input => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(input) }));
  const initial = query(navigation.auditBrowseHref(scope(), returnValue, "captured", "correction", "source", "suspended"));
  const first = await visit(initial), selected = linkQuery(first, "Suspended: 1");
  const counted = await visit(selected), older = linkQuery(counted, "Older stored revisions");
  assert.equal(older.registration, "suspended"); assert.equal(older.sourceQ, "source"); assert.equal(older.returnIssueQ, "housing costs");
  const past = await visit(older); assert.ok(past.includes("Showing 1 of 4 source registrations"));
  changed = true; const held = await visit(older); assert.equal(rows(held), ""); assert.ok(held.includes("Publication ledger changed"));
  const fresh = linkQuery(held, "Start a fresh audit"); assert.equal(fresh.registration, "suspended"); assert.equal(fresh.beforeRevision, undefined);
  assert.equal(fresh.returnBeforeRunId, id(99)); assert.equal(fresh.sourceQ, "source");
  assert.deepEqual(calls, [scope(), scope(), { ...scope(), cursor: report.history.nextCursor }, { ...scope(), cursor: report.history.nextCursor }]);
});
