import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { choices, choiceId } from "./helpers/operator_audit_choices_fixture.mjs";
import { operatorAuditChoicesSchema } from "../src/operator-audit-choices.ts";

const View = loadTsx(new URL("../src/operator-audit-choices-view.tsx", import.meta.url)).OperatorAuditChoicesView;
const render = (decision, selection, cursor) => renderToStaticMarkup(View({ decision, selection, cursor }));
function offPage() {
  const report = choices(choiceId(29));
  report.selectedRun = { ...report.runs[0], runId: choiceId(29) };
  report.requestedCursor = { createdAt: report.runs[0].createdAt, runId: choiceId(10) };
  report.issues = [{ issueId: choiceId(30), issueKey: "housing-costs" }];
  return report;
}
const disclosure = html => [...html.matchAll(/<details><summary>Selected recorded run reference<\/summary>([\s\S]*?)<\/details>/g)];

test("checked selected audit run exposes an exact visible reference even outside the listed continuation", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("the recorded selection presenter must not request work"));
  for (const report of [offPage(), choices(choiceId(1))]) {
    assert.equal(operatorAuditChoicesSchema.safeParse(report).success, true);
    const before = JSON.stringify(report), html = render({ kind: "ok", report }, report.requestedRunId, report.requestedCursor);
    const exact = disclosure(html); assert.equal(exact.length, 1, "the issue selector must identify its checked selected run separately from the paged overview");
    assert.equal(exact[0][1], `<code>${report.selectedRun.runId}</code>`);
    assert.ok(html.includes(`<time dateTime="${report.selectedRun.createdAt}">${report.selectedRun.createdAt}</time>`));
    assert.ok(html.includes(`name="runId" value="${report.selectedRun.runId}"`));
    assert.ok(html.includes(`value="${choiceId(30)}"`));
    assert.ok(html.includes("Their presence does not mean this run updated or published them"));
    if (report.requestedCursor) {
      assert.ok(!report.runs.some(run => run.runId === report.selectedRun.runId));
      assert.ok(html.includes("Older recorded runs") && html.includes("Newest recorded runs"));
    }
    assert.equal(JSON.stringify(report), before);
  }
});

test("absent or refused recorded selection never manufactures a visible selected-run reference", () => {
  for (const kind of ["invalid_scope", "unconfigured", "unavailable", "changed"]) {
    const html = render({ kind }, choiceId(29), offPage().requestedCursor);
    assert.equal(disclosure(html).length, 0); assert.ok(!html.includes(`<code>${choiceId(29)}</code>`));
    assert.ok(!html.includes("Stored run state:") && !html.includes("<select"));
  }
  for (const report of [choices(), choices(choiceId(99)), { ...offPage(), privateNote: "PRIVATE_SELECTION_CANARY" }]) {
    const html = render({ kind: "ok", report }, report.requestedRunId, report.requestedCursor);
    assert.equal(disclosure(html).length, 0); assert.ok(!html.includes("PRIVATE_SELECTION_CANARY"));
  }
});
