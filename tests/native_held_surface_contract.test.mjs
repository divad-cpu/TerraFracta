import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import test from "node:test";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { heldReport, heldScope } from "./helpers/operator_held_fixture.mjs";
import { canonicalHeldDecisionScope } from "../src/server/operator-held-decisions-reader.ts";

// Exercise exactly the native trial's presenter acceptance function against the
// actual page/view. The line protocol, DB, Browser, HTTP and default readers do
// not run here; TypeScript's parser selects one exact named declaration.
const path = process.env.TF_NATIVE_HELD_ORACLE_SOURCE ?? new URL("../scripts/check_postgres_operator_audit_native.mjs", import.meta.url);
const text = readFileSync(path, "utf8"), source = ts.createSourceFile("native-helper.mjs", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const node = source.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "heldSurfaces");
assert.ok(node);
const pageSource = new URL("../app/editorial-preview/held/page.tsx", import.meta.url);
const load = (file, read) => loadTsx(file, name => name.endsWith("operator-held-decisions-reader.ts") && read ? { canonicalHeldDecisionScope, readHeldDecisions: read } : undefined);
const hash = value => createHash("sha256").update(value).digest("hex");
const attribute = (value, name) => value.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
// The selected declaration keeps its original relative URL base. A finite
// renderer seam lets negative probes alter the actual emitted HTML, without
// changing a presenter or executing the native line protocol/database trial.
const acceptance = (render = renderToStaticMarkup) => new Function("assert", "load", "renderToStaticMarkup", "createElement", "heldPageSource", "hash", "attribute", "nativeHelperUrl", `${node.getText(source).replaceAll("import.meta.url", "nativeHelperUrl")}; return heldSurfaces;`)(assert, load, render, createElement, pageSource, hash, attribute, new URL("../scripts/check_postgres_operator_audit_native.mjs", import.meta.url).href);
const check = acceptance();

for (const [name, mutate] of [
  ["a write method", html => html.replace('method="get"', 'method="post"')],
  ["a foreign form target", html => html.replace('action="/editorial-preview/held"', 'action="https://foreign.invalid/write"')],
  ["an extra submit action", html => html + '<button type="submit">Approve publication</button>'],
  ...["submit", "image", "button", "reset"].map(type =>
    [`an extra ${type} input`, html => html.replace('</form>', `<input type="${type}" value="Approve publication"/></form>`)]),
]) test(`native held-page acceptance refuses ${name} while preserving GET inspection`, async () => {
  let changed = false;
  const reject = acceptance(element => { const html = renderToStaticMarkup(element), altered = mutate(html); changed ||= altered !== html; return altered; });
  await assert.rejects(reject({ kind: "ok", report: heldReport() }, heldScope()), assert.AssertionError);
  assert.ok(changed, "The rejection witness must change actual rendered markup");
});

test("native held-page acceptance agrees with the approved current list and exact captured-proposal links", async () => {
  const result = await check({ kind: "ok", report: heldReport() }, heldScope());
  assert.equal(result.page.readerCalls, 1); assert.equal(result.view.sha256, result.page.sha256);
  assert.ok(result.view.html.includes("Proposal details are read separately"));
  assert.ok(result.view.html.includes("A missing conflict dossier does not mean there is no conflict"));
  assert.ok(!result.view.html.includes("Proposal comparison unavailable"));
});

test("native held-page acceptance still withholds records and proposal links after reader refusal", async () => {
  const result = await check({ kind: "unavailable" }, heldScope());
  assert.equal(result.page.readerCalls, 1); assert.equal(result.view.sha256, result.page.sha256);
  assert.ok(!result.view.html.includes("Inspect captured proposal")); assert.ok(!result.view.html.includes("Recorded holds"));
});

for (const [name, mutate] of [
  ["an extra query parameter", href => `${href}&amp;unexpected=1`],
  ["a foreign HTTP origin", href => `http://foreign.invalid${href}`],
  ["a same-origin absolute URL", href => `https://terrafracta.invalid${href}`],
]) test(`native held-page acceptance rejects ${name} on an actual proposal anchor`, async () => {
  let changed = 0;
  const reject = acceptance(element => renderToStaticMarkup(element).replace(/href="(\/editorial-preview\/held\/proposal\?[^"]+)"/g,
    (_, href) => { changed++; return `href="${mutate(href)}"`; }));
  await assert.rejects(reject({ kind: "ok", report: heldReport() }, heldScope()), assert.AssertionError);
  assert.ok(changed > 0, "The probe must alter an actual emitted proposal link");
});

test("native held-page acceptance rejects data-href camouflage in place of actual navigation", async () => {
  let changed = 0;
  const reject = acceptance(element => renderToStaticMarkup(element).replace(/href="(\/editorial-preview\/held\/proposal\?[^"]+)"/g,
    (_, href) => { changed++; return `data-href="${href}"`; }));
  await assert.rejects(reject({ kind: "ok", report: heldReport() }, heldScope()), assert.AssertionError);
  assert.ok(changed > 0);
});

test("native held-page acceptance rejects missing proposal controls", async () => {
  let changed = 0;
  const reject = acceptance(element => renderToStaticMarkup(element).replace(/<a href="\/editorial-preview\/held\/proposal\?[^"]+">Inspect captured proposal<\/a>/g,
    () => { changed++; return ""; }));
  await assert.rejects(reject({ kind: "ok", report: heldReport() }, heldScope()), assert.AssertionError);
  assert.ok(changed > 0);
});
