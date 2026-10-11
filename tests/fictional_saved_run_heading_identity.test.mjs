import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { fictionalUpdateResultSchema } from "../src/fictional-update-result.ts";

const candidate = loadTsx(new URL("../app/update-preview/candidate.tsx", import.meta.url)).FictionalCandidate;
const saved = loadTsx(new URL("../src/fictional-saved-run-view.tsx", import.meta.url)).FictionalSavedRunView;
const receipt = later => ({ execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "local_fictional", scenario: later ? "revised_value" : "standard", executedAt: later ? "2026-10-10T10:01:00Z" : "2026-10-10T10:00:00Z", durationMs: 1 },
  report: JSON.parse(readFileSync(new URL(`../fixtures/${later ? "fictional_revised_update_report" : "fictional_update_report"}.json`, import.meta.url))) });
const markup = (type, inputs) => renderToStaticMarkup(createElement(Fragment, null,
  ...inputs.map((props, key) => createElement(type, { ...props, key }))));
function checkHeadings(html, expected) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const refs = [...html.matchAll(/\saria-labelledby="([^"]+)"/g)].map(match => match[1]);
  const headings = [...html.matchAll(/<h[1-6]\s+id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(headings.length, expected); assert.equal(new Set(ids).size, ids.length, "Displayed targets reused an ID");
  assert.equal(refs.length, expected); assert.deepEqual(refs, headings, "A section did not name its own displayed heading");
}
test("two actual draft presenters have distinct matching accessible headings", () => {
  const html = markup(candidate, [false, true].map(later => ({ candidate: receipt(later).report.fictionalCandidate })));
  checkHeadings(html, 2); assert.match(html, /27\.4/); assert.match(html, /28\.1/);
});
test("two whole checked saved runs keep all review, export and draft headings distinct", () => {
  const html = markup(saved, [false, true].map(later => ({ input: receipt(later) })));
  checkHeadings(html, 6); assert.equal((html.match(/Current publication unavailable/g) ?? []).length, 2);
  assert.equal((html.match(/Download saved run/g) ?? []).length, 2);
});
test("valid absent drafts and invalid private inputs retain their established disclosure boundaries", () => {
  const missing = receipt(false); missing.execution.scenario = "missing_source";
  missing.report = { ...missing.report, state: "partial", coveredSourceKeys: [], items: [], fictionalCandidate: null };
  assert.equal(fictionalUpdateResultSchema.safeParse(missing).success, true);
  const html = markup(saved, [{ input: missing }]);
  assert.match(html, /No checked page draft/); assert.match(html, /Zero published/);
  assert.doesNotMatch(html, /Inspect the proposed fact/);
  const invalid = { ...receipt(true), privatePath: "PRIVATE_PATH" };
  const refused = markup(saved, [{ input: invalid }]);
  assert.match(refused, /Saved rehearsal unavailable/);
  assert.doesNotMatch(refused, /PRIVATE_PATH|28\.1|Download saved run|proposed fact/);
});
