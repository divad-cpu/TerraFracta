import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { connectedInput, suppressionInput } from "./helpers/connected_reader_fixture.mjs";
import { correctionModule } from "./helpers/correction_draft_harness.mjs";

// Compile this project's exact presentation module in memory. No browser,
// HTTP, DOM access, path supplied by the page or generated source is used.
const sourcePath = new URL("../src/connected-preview-view.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
const nativeRequire = createRequire(sourcePath), correction = correctionModule();
new Function("require", "exports", compiled)(name => name === "../app/corrections/draft-form" ? correction : nativeRequire(name), exports);
const { ConnectedPreviewView, connectedViews } = exports;
const render = (outcome, view, query = "") => renderToStaticMarkup(createElement(ConnectedPreviewView, { outcome, view, query }));
const active = (value = "27.4", generation = 1) => ({ kind: "snapshot", snapshot: { ...connectedInput(value), generation } });

test("all four actual React presenters use one edition and one checked claim", () => {
  const outcome = active();
  for (const view of connectedViews) {
    const markup = render(outcome, view, "fictional");
    assert.ok(markup.includes("In 2025, the fictional share was 27.4%."), view);
    assert.ok(markup.includes('data-connected-edition="1"'), view);
    assert.ok(markup.includes(`data-publication-id="${outcome.snapshot.issue.publicationId}"`), view);
    assert.ok(markup.includes("Fictional data"), view);
    assert.ok(markup.includes('?edition=1'), view);
    assert.ok(!markup.includes("privateEvidenceDirectory"), view);
  }
});
test("a checked successor replaces old wording in every presenter", () => {
  for (const view of connectedViews) {
    const markup = render(active("28.1", 2), view, "2025");
    assert.ok(markup.includes("28.1%"), view); assert.ok(!markup.includes("27.4%"), view);
    assert.ok(markup.includes('data-connected-edition="2"'), view);
  }
});
test("source panel and issue display include the exact locator and retrieval instant", () => {
  const outcome = active(), source = outcome.snapshot.issue.claims[0].evidence[0];
  for (const view of ["issue", "sources"]) {
    const markup = render(outcome, view);
    for (const value of [source.locator, source.publisher, source.title, source.url, source.retrievedAt]) assert.ok(markup.includes(value));
    assert.ok(!markup.includes(`href="${source.url}"`), "invented address stays noninteractive");
  }
});
test("suppression withholds the claim and source everywhere, including search", () => {
  const outcome = { kind: "snapshot", snapshot: { ...suppressionInput(), generation: 2 } };
  for (const view of connectedViews) {
    const markup = render(outcome, view, "fictional");
    assert.ok(markup.includes("This update has been withdrawn"));
    assert.ok(!markup.includes("27.4%")); assert.ok(!markup.includes("example.org/fictional-table"));
  }
});
test("absent, broken and replaced editions have distinct safe messages", () => {
  for (const [outcome, message] of [[{ kind: "empty" }, "No connected update yet"], [{ kind: "unavailable" }, "Update temporarily unavailable"], [{ kind: "changed", currentGeneration: 2 }, "A newer update is available"]]) {
    for (const view of connectedViews) { const markup = render(outcome, view); assert.ok(markup.includes(message)); assert.ok(!markup.includes("27.4%")); }
  }
});
test("search renders no result for a missing topic and rejects duplicate query fields", () => {
  assert.ok(render(active(), "search", "absent-topic").includes("No matching visible claim"));
  assert.ok(render(active(), "search", ["2025", "secret"]).includes("Enter up to 80 characters"));
  const markup = render(active(), "search", '<script>alert("canary")</script>');
  assert.ok(!markup.includes("<script>")); assert.ok(markup.includes("&lt;script&gt;"));
});

test("only the active issue view contains a revision-bound local correction exercise", () => {
  assert.ok(render(active(), "issue").includes("Try a correction draft for this edition"));
  for (const view of ["overview", "sources", "search"]) assert.ok(!render(active(), view).includes("Draft details"));
  for (const outcome of [{ kind: "empty" }, { kind: "unavailable" }, { kind: "changed", currentGeneration: 2 },
    { kind: "snapshot", snapshot: { ...suppressionInput(), generation: 2 } }]) {
    assert.ok(!render(outcome, "issue").includes("Draft details"));
  }
});
