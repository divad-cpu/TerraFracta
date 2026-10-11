import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/private-custodian-journal.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_journaled_native_integration.json", import.meta.url), "utf8"));
const path = new URL("../src/private-custodian-journal-view.tsx", import.meta.url), native = createRequire(path), exports = {};
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
new Function("require", "exports", compiled)(name => name === "./private-custodian-journal.ts" ? contract : native(name), exports);

test("dated integrated outcomes distinguish a durable finish from an accepted returned result", () => {
  const parsed = contract.parseJournaledNativeIntegration(saved);
  assert.deepEqual(parsed.entries.map(x => [x.savedPairs, x.nativeCloseoutPresent, x.returnedResultAccepted]),
    [[1, true, true], [1, false, false], [1, true, false], [0, false, false]]);
  assert.equal(parsed.liveStatus, false); assert.equal(parsed.remoteRollbackAttested, false);
});

test("server-rendered historical view preserves holds, source limits and existing incomplete examples", () => {
  const markup = renderToStaticMarkup(createElement(exports.PrivateCustodianJournalView));
  for (const text of ["Checking saved results after restart", "Save reply lost", "Finish reply lost",
    "Interrupted before reading", "Result withheld", "Pending private review", "not live status",
    "does not prove remote rollback", "original source transport was never used", "Finish missing", saved.recordedAt])
    assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /<form|<button|privateEvidenceDirectory|rawBody|principal|\/home\/dj|sourceFingerprint|startReceiptSha256/);
});

test("private values, automatic retry and guard attestation claims cannot enter the integration display", () => {
  for (const [key, value] of [["sourceRequests", true], ["sourceRequests", 1], ["liveStatus", true],
    ["remoteRollbackAttested", true], ["creatingParentGuardRequested", false], ["publicationEnabled", true],
    ["automaticRetry", true], ["rawBody", "private-canary"], ["principal", "private-canary"],
    ["privateEvidenceDirectory", "/private/canary"]])
    assert.throws(() => contract.parseJournaledNativeIntegration({ ...saved, [key]: value }));
  for (const mutate of [(x) => x.entries[2].returnedResultAccepted = true,
    (x) => x.entries[1].nativeCloseoutPresent = true, (x) => x.entries[3].savedPairs = 1,
    (x) => x.entries[0].nativeCleanupConfirmed = false, (x) => x.entries[0].error = "private-canary",
    (x) => x.entries.reverse(), (x) => x.entries.pop()]) {
    const changed = structuredClone(saved); mutate(changed);
    assert.throws(() => contract.parseJournaledNativeIntegration(changed));
  }
});

test("integration chronology retains microseconds and separately dated restart observation", () => {
  const changed = structuredClone(saved);
  changed.entries[0].recordedAt = "2026-10-04T05:00:00.000002Z";
  changed.entries[1].recordedAt = "2026-10-04T05:00:00.000001Z";
  assert.throws(() => contract.parseJournaledNativeIntegration(changed));
  changed.entries[0].recordedAt = "2026-10-04T05:00:00.000000Z";
  assert.doesNotThrow(() => contract.parseJournaledNativeIntegration(changed));
  changed.recordedAt = changed.entries[2].recordedAt;
  assert.throws(() => contract.parseJournaledNativeIntegration(changed));
});
