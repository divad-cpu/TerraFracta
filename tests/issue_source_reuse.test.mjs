import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { issueSourceIndex } from "../src/issue-source-index.ts";

const file = new URL("../app/issue-evidence.tsx", import.meta.url), exports = {};
const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
new Function("require", "exports", code)(createRequire(file), exports);
const example = () => parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const render = issue => renderToStaticMarkup(createElement(exports.IssueEvidence, { issue }));

test("actual evidence panel reveals three references to two source versions without an independence claim", () => {
  const html = render(example());
  assert.ok(html.includes("3 exact references · 2 recorded source versions"));
  assert.ok(html.includes("Source reuse in this dossier"));
  assert.ok(html.includes("Recorded source version 1"));
  assert.ok(html.includes("2 references across 1 statement"));
  assert.ok(html.includes("Recorded source version 2"));
  assert.ok(html.includes("1 reference across 1 statement"));
  assert.ok(html.includes("These counts do not establish independent confirmation"));
  assert.ok(!html.includes("2 independent sources"));
});
test("every grouped role and location returns to its exact visible citation, with no external link", () => {
  const issue = example(), html = render(issue), id = issue.claims[0].id;
  for (let number = 1; number <= 3; number++) {
    assert.equal(html.split(`href="#reference-${id}-${number}"`).length - 1, 1);
    assert.equal(html.split(`id="reference-${id}-${number}"`).length - 1, 1);
  }
  for (const source of issue.claims[0].evidence) assert.ok(html.includes(source.locator));
  for (const label of ["Supports this wording", "Points to a conflict", "Adds context"]) assert.ok(html.includes(label));
  assert.ok(!html.includes('href="https:'));
});

test("different versions stay distinct at the same URL, publisher and title; reused version keeps both statements", () => {
  const issue = example(), base = issue.claims[0], first = base.evidence[0];
  issue.claims = [
    { ...base, evidence: [first] },
    { ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", assertion: "Second invented statement", evidence: [
      { ...first, locator: "Another cell", relation: "context" },
      { ...first, sourceVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", locator: "Revised cell", relation: "supports" },
    ] },
  ];
  const before = JSON.stringify(issue), index = issueSourceIndex(issue);
  assert.equal(index.referenceCount, 3); assert.equal(index.groups.length, 2);
  assert.deepEqual(index.groups.map(group => group.statementCount), [2, 1]);
  assert.deepEqual(index.groups.map(group => group.references.map(reference => reference.source.locator)), [["Example cell A1", "Another cell"], ["Revised cell"]]);
  assert.equal(JSON.stringify(issue), before);
  const html = render(issue);
  assert.ok(html.includes("2 references across 2 statements"));
  assert.ok(html.includes("Second invented statement"));
});
test("a reused version never collapses differing per-reference titles, dates or conflict roles", () => {
  const issue = example(), first = issue.claims[0].evidence[0];
  issue.claims[0].evidence = [first, { ...first, title: "Different display title", locator: "Other section",
    sourcePublishedOn: null, retrievedAt: "2026-09-26T00:00:00Z", relation: "contradicts" }];
  const index = issueSourceIndex(issue), html = render(issue);
  assert.equal(index.groups.length, 1); assert.equal(index.referenceCount, 2);
  assert.equal(index.groups[0].references[1].source.sourcePublishedOn, null);
  for (const text of ["Different display title", "Other section", "2026-09-26T00:00:00Z", "Source published</dt><dd>No verified source publication date supplied</dd>", "Conflicting evidence is included", "Points to a conflict"])
    assert.ok(html.includes(text), text);
});
test("group labels follow first occurrence, reference anchors stay unique at maximum dossier size, and text stays escaped", () => {
  const issue = example(), base = issue.claims[0];
  issue.claims = Array.from({ length: 30 }, (_, claimNumber) => ({ ...base,
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(claimNumber + 1).padStart(12, "0")}`,
    evidence: Array.from({ length: 12 }, (_, referenceNumber) => ({ ...base.evidence[0],
      sourceVersionId: `bbbbbbbb-bbbb-4bbb-8bbb-${String((claimNumber * 12 + referenceNumber) % 120 + 1).padStart(12, "0")}`,
      title: "<script>title-canary</script>", locator: `Cell ${claimNumber}:${referenceNumber}`,
    })),
  }));
  const index = issueSourceIndex(issue);
  assert.equal(index.referenceCount, 360); assert.equal(index.groups.length, 120);
  assert.equal(new Set(index.groups.flatMap(group => group.references.map(reference => reference.anchor))).size, 360);
  assert.equal(index.groups[0].references[0].source.locator, "Cell 0:0");
  const html = render(issue); assert.ok(html.includes("360 exact references · 120 recorded source versions"));
  assert.ok(html.includes("&lt;script&gt;title-canary")); assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("registrationState")); assert.ok(!html.includes("rawArchivePath"));
});
