import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { issueReadingOverview } from "../src/issue-reading-overview.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const View = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url)).IssueEvidence;
const read = () => createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(sample())))(sample().requestedRoute);

test("overview keeps all six types separate, original claim order and exact periods, including conflicting references", async () => {
  const { issue } = await read(); const original = structuredClone(issue);
  const overview = issueReadingOverview(issue);
  assert.deepEqual(overview.map(stage => stage.type), ["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"]);
  assert.equal(overview.reduce((n, stage) => n + stage.claims.length, 0), issue.claims.length);
  assert.equal(overview[0].referenceCount, 3); assert.equal(overview[0].conflictingStatements, 1);
  assert.deepEqual(overview[0].periods, [issue.claims[0].periodLabel]);
  assert.deepEqual(issue, original); assert.ok(overview.slice(1).every(stage => stage.claims.length === 0));
});
test("actual evidence overview preserves claim/source anchors and dates without interpreting missing types as inaction", async () => {
  const { issue } = await read(); const html = renderToStaticMarkup(createElement(View, { issue }));
  for (const text of ["What this dossier contains", "not a progress score", "does not establish absence of action", "Conflicting evidence accompanies", "Source reuse"])
    assert.ok(html.includes(text), text);
  for (const claim of issue.claims) {
    assert.equal((html.match(new RegExp(`id="claim-${claim.id}"`, "g")) ?? []).length, 1);
    assert.ok(html.includes(`href="#claim-${claim.id}"`));
    for (const source of claim.evidence) assert.ok(html.includes(source.locator) && html.includes(source.retrievedAt));
  }
  assert.ok(!html.includes('href="https:'));
});
