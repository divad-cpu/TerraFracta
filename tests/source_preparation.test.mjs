import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function load(relative, replacements = {}) {
  const location = new URL(relative, import.meta.url);
  const source = readFileSync(location, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {}, nativeRequire = createRequire(location);
  new Function("require", "exports", compiled)((name) => replacements[name] ?? nativeRequire(name), exports);
  return exports;
}

const view = load("../src/source-preparation-view.tsx");
const frozenView = load("../src/frozen-source-trial-view.tsx");
const readinessView = load("../src/private-attempt-readiness-view.tsx");
const currentReadinessView = load("../src/current-private-preparation-view.tsx");
const currentCopyScopeView = load("../src/current-copy-scope-view.tsx");
const currentParentSourceView = load("../src/current-parent-source-view.tsx");
const parentSourceView = load("../src/private-parent-source-view.tsx", {
  "./private-parent-source": createRequire(import.meta.url)("../src/private-parent-source.ts"),
  "./current-parent-source-view": currentParentSourceView,
});
const assessmentView = load("../src/private-ssb-assessment-view.tsx");
const custodianView = load("../src/private-custodian-trial-view.tsx");
const custodianJournalView = load("../src/private-custodian-journal-view.tsx");
const recoveryView = load("../src/private-recovery-trial-view.tsx");
const custodianOperationView = load("../src/private-custodian-operation-view.tsx", {
  "./private-custodian-operation": createRequire(import.meta.url)("../src/private-custodian-operation.ts"),
  "./private-custodian-request": createRequire(import.meta.url)("../src/private-custodian-request.ts"),
});
const components = load("../app/components.tsx");
const page = load("../app/source-preview/page.tsx", {
  "../../src/source-preparation-view": view,
  "../../src/frozen-source-trial-view": frozenView,
  "../../src/private-attempt-readiness-view": readinessView,
  "../../src/current-private-preparation-view": currentReadinessView,
  "../../src/current-copy-scope-view": currentCopyScopeView,
  "../../src/private-parent-source-view": parentSourceView,
  "../../src/private-ssb-assessment-view": assessmentView,
  "../../src/private-custodian-trial-view": custodianView,
  "../../src/private-custodian-journal-view": custodianJournalView,
  "../../src/private-recovery-trial-view": recoveryView,
  "../../src/private-custodian-operation-view": custodianOperationView,
  "../components": components,
}).default;

test("production and test modes withhold the actual preparation route", () => {
  const original = process.env.NODE_ENV;
  try {
    for (const mode of ["production", "test", undefined]) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;
      assert.throws(() => page(), (error) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
    }
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

test("actual server markup records review without implying collection or publication", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    const html = renderToStaticMarkup(createElement(page));
    assert.ok(html.includes("Complete for a private attempt"));
    assert.ok(html.includes("Collection has not started"));
    assert.ok(html.includes("Recorded <time"));
    assert.ok(html.includes("not a live service check"));
    assert.ok(html.includes("Automatic private cleanup is installed and has run"));
    assert.ok(html.includes("Application access expires at 30 days"));
    assert.ok(html.includes("Automatic private cleanup is installed and has run on this PC; it does not establish NAS controls"));
    assert.ok(html.includes("unresolved public wording held"));
    assert.ok(html.includes("Checked collection and private saving"));
    assert.ok(html.includes("Saving succeeded, reply lost"));
    assert.ok(html.includes("Outcome held"));
    assert.ok(html.includes("No real source was contacted"));
    assert.ok(html.includes("Before the first private collection"));
    assert.ok(html.includes("Collection held"));
    assert.ok(html.includes("Observed at this check"));
    assert.ok(html.includes("not current live health"));
    assert.ok(html.includes("These saved PC checks do not establish NAS readiness"));
    assert.ok(html.includes("From saved responses to a held result"));
    assert.ok(html.includes("Survey year 2024"));
    assert.ok(html.includes("Survey year 2025"));
    assert.ok(html.includes("Held for clarification"));
    assert.ok(html.includes("What the reported response count measures"));
    assert.ok(html.includes("Saving responses does not make them eligible for publication"));
    assert.ok(html.includes("The connected private collection path"));
    assert.ok(html.includes("Confirmation lost before reading"));
    assert.ok(html.includes("Database finished, worker confirmation lost"));
    assert.ok(html.includes("No automatic attempt to read again"));
    assert.ok(html.includes("Preserving the outcome after an interruption"));
    assert.ok(html.includes("Finish missing"));
    assert.ok(html.includes("Process ending remains unconfirmed"));
    assert.ok(html.includes("The unconfirmed process state was injected"));
    assert.ok(html.includes("current service health requires a separate observation"));
    assert.ok(html.includes("Independent review and the remaining operational checks"));
    assert.ok(html.includes("/update-preview"));
    assert.ok(!/<(?:form|input|textarea)\b/.test(html), "no source/approval selectors exist");
    assert.equal((html.match(/<button\b/g) ?? []).length, 4, "three independent read-only checks and the explicit invented rehearsal action exist");
    assert.ok(html.includes("Backup and sync coverage"));
    assert.ok(html.includes("Check copy settings"));
    assert.ok(html.includes("Preparing the collection process for review"));
    assert.ok(html.includes("Saved collection and recovery trials"));
    assert.ok(html.includes("Compare prepared source now"));
    assert.ok(html.includes("Check local preparation now"));
    assert.ok(html.includes("Healthy checks cannot grant collection permission"));
    assert.ok(html.includes("Run the invented collection test"));
    assert.ok(html.includes("Inspecting a stopped collection"));
    assert.ok(html.includes("An earlier admission is historical evidence"));
    assert.ok(html.includes("Nothing was fetched again, repaired or published"));
    assert.ok(html.includes("No real source is contacted and nothing is published"));
    assert.ok(!/(?:21\.6|18\.5|5,062|5030|5432|source_version|workClaimId|password)/i.test(html), "held numerical and private details are absent");
    assert.ok(!/(?:TerraFracta-private|\/home\/dj|sourceFingerprint|archiveSha256|\b[0-9a-f]{64}\b)/i.test(html), "private launch identifiers are absent");
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
