import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const parser = require("../src/private-parent-source.ts");
const snapshot = { schemaVersion: 1, evidenceKind: "saved_private_parent_api_source_preparation",
  recordedAt: "2026-10-03T13:18:47.332434+00:00", state: "held", sourceFiles: 85,
  privateApiVersion: 2, sourceBytesVerified: true, candidateModulesImported: false,
  workerExecuted: false, completeRuntimeSealed: false, deploymentReviewComplete: false,
  operationalContextSelected: false, copyCoverageAccepted: false, collectionPermissionIssued: false,
  sourceRequests: 0, publicationEnabled: false, scheduleEnabled: false, externalBackup: false };

test("saved parent projection cannot promote a source review into operational acceptance", () => {
  assert.equal(parser.parsePrivateParentSource(snapshot).sourceFiles, 85);
  for (const key of ["candidateModulesImported", "workerExecuted", "completeRuntimeSealed", "deploymentReviewComplete",
    "operationalContextSelected", "copyCoverageAccepted", "collectionPermissionIssued", "publicationEnabled", "scheduleEnabled", "externalBackup"]) {
    for (const value of [true, 0]) assert.throws(() => parser.parsePrivateParentSource({ ...snapshot, [key]: value }));
  }
  for (const altered of [{ state: "approved" }, { sourceFiles: 133 }, { sourceRequests: 1 },
    { sourceRequests: false }, { sourceBytesVerified: false }, { privateSnapshot: "/private/path" }]) {
    assert.throws(() => parser.parsePrivateParentSource({ ...snapshot, ...altered }));
  }
});

test("saved parent observation requires an actual UTC calendar time", () => {
  for (const recordedAt of ["0000-01-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-03T13:00:00+01:00",
    "2026-10-03T13:00:00", "2026-10-03T13:00:00.1234567Z"]) {
    assert.throws(() => parser.parsePrivateParentSource({ ...snapshot, recordedAt }));
  }
});

test("real server-rendered parent view clearly states its saved and held limits", () => {
  const location = new URL("../src/private-parent-source-view.tsx", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(location, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {}, nativeRequire = createRequire(location);
  new Function("require", "exports", compiled)((name) =>
    name === "../fixtures/private_parent_source_preparation_snapshot.json" ? snapshot :
      name === "./private-parent-source" ? parser : name === "./current-parent-source-view" ? { CurrentParentSourceView: () => null } : nativeRequire(name), exports);
  const html = renderToStaticMarkup(createElement(exports.PrivateParentSourceView));
  for (const text of ["Preparing the collection process for review", "85 source files", "Held",
    "Still to be selected", "not a live service check", "grants no permission", "external backup has not been established"]) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!/<(?:form|input|button|textarea)\b/.test(html));
  assert.ok(!/(?:\/home\/dj|fingerprint|privateSnapshot|password|\b[0-9a-f]{64}\b)/i.test(html));
});
