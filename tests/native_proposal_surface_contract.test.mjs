import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { canonicalProposalScope } from "../src/server/operator-proposal-reader.ts";
import { parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { proposalReport, proposalScope } from "./helpers/proposal_fixture.mjs";

// Isolate exactly the native trial's actual loader and proposal acceptance.
// Never import its main, stdin protocol, transport or database functions.
const nativeHelperUrl = new URL("../scripts/check_postgres_operator_audit_native.mjs", import.meta.url);
const source = ts.createSourceFile("native-helper.mjs", readFileSync(nativeHelperUrl, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const declaration = name => {
  const node = source.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === name);
  assert.ok(node); return node.getText(source).replaceAll("import.meta.url", "nativeHelperUrl");
};
const hash = value => createHash("sha256").update(value).digest("hex");
const pageSource = new URL("../app/editorial-preview/audit/page.tsx", import.meta.url);
const choicesPageSource = new URL("../app/editorial-preview/audit/select/page.tsx", import.meta.url);
const heldPageSource = new URL("../app/editorial-preview/held/page.tsx", import.meta.url);
const proposalPageSource = new URL("../app/editorial-preview/held/proposal/page.tsx", import.meta.url);
function acceptance(decision, render = renderToStaticMarkup) {
  const events = [], requested = proposalScope();
  const readProposal = async selected => {
    assert.deepEqual(selected, requested);
    if (decision.kind === "unavailable") events.push("operator_audit_read");
    return decision;
  };
  return new Function("assert", "createRequire", "ts", "readFileSync", "existsSync", "pageSource", "choicesPageSource", "heldPageSource", "proposalPageSource", "canonicalProposalScope", "events", "readProposal", "settle", "proposalScope", "renderToStaticMarkup", "createElement", "hash", "nativeHelperUrl",
    `${declaration("load")}\n${declaration("selectedProposal")}\nreturn selectedProposal;`)(
    assert, createRequire, ts, readFileSync, existsSync, pageSource, choicesPageSource, heldPageSource, proposalPageSource, canonicalProposalScope, events, readProposal,
    () => new Promise(resolve => setImmediate(resolve)), requested, render, createElement, hash, nativeHelperUrl);
}
function positive() {
  const report = proposalReport(); report.base = null;
  report.capture.basePublicationId = null; report.capture.baseContentSha256 = null; report.capture.baseHeadChangedAt = null;
  const checked = parseCapturedProposalEnvelope(report); assert.equal(checked.status, "ok");
  return { kind: "ok", report: checked };
}

test("native proposal acceptance preserves exact actual no-base presenter and page with disabled unsent preparation", async () => {
  const result = await acceptance(positive())("ok");
  assert.equal(result.actualPageReaderSeam, true); assert.equal(result.browserVerified, false);
  assert.deepEqual(result.diagnosticCodes, []); assert.match(result.htmlSha256, /^[a-f0-9]{64}$/);
});

for (const kind of ["unconfigured", "unavailable", "not_found", "capture_missing", "changed"])
  test(`native proposal acceptance preserves withheld ${kind} page`, async () => {
    const result = await acceptance({ kind })(kind);
    assert.equal(result.actualPageReaderSeam, true); assert.equal(result.browserVerified, false);
    assert.deepEqual(result.diagnosticCodes, kind === "unavailable" ? ["operator_audit_read"] : []);
  });

test("native proposal acceptance rejects enabled fields, submit controls, foreign labels, forms and private disclosure", async () => {
  for (const mutate of [
    html => html.replace('disabled=""', ""),
    html => html.replace(/(<button\b[^>]*?) disabled=""/, "$1"),
    html => html.replace('type="button"', 'type="submit"'),
    html => html.replace("Review scope draft", "Approve publication"),
    html => html + '<input type="image" disabled=""/>',
    html => html + '<form method="post"></form>',
    html => html + "PRIVATE_CANARY",
  ]) {
    let changed = false;
    const check = acceptance(positive(), element => {
      const html = renderToStaticMarkup(element), altered = mutate(html);
      changed ||= altered !== html; return altered;
    });
    await assert.rejects(check("ok"), assert.AssertionError);
    assert.ok(changed, "The witness must alter actual rendered markup");
  }
});
