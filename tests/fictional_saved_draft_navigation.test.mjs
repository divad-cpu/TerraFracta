import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { fictionalUpdateResultSchema } from "../src/fictional-update-result.ts";

const source = new URL("../src/fictional-saved-run-view.tsx", import.meta.url);
const Saved = loadTsx(source).FictionalSavedRunView;
const Review = loadTsx(new URL("../src/fictional-run-review.tsx", import.meta.url)).FictionalRunReview;
function receipt(later = false) {
  return { execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "local_fictional", scenario: later ? "revised_value" : "standard",
    executedAt: later ? "2026-10-10T10:01:00Z" : "2026-10-10T10:00:00Z", durationMs: 1 },
    report: JSON.parse(readFileSync(new URL(`../fixtures/${later ? "fictional_revised_update_report" : "fictional_update_report"}.json`, import.meta.url))) };
}
const html = input => renderToStaticMarkup(createElement(Saved, { input }));
function navigation(markup, input) {
  const forward = [...markup.matchAll(/<a href="#([^"]+)">Inspect this item’s checked draft<\/a>/g)];
  const back = [...markup.matchAll(/<a href="#([^"]+)">Return to checked item ([0-9]+)<\/a>/g)];
  assert.equal(forward.length, 1, "The checked origin has no exact draft navigation");
  assert.equal(back.length, 1, "The displayed draft has no exact item return");
  const index = input.report.items.findIndex(item => item.itemKey === input.report.fictionalCandidate.itemKey);
  assert.equal(Number(back[0][2]), index + 1);
  const origin = [...markup.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].find(match => match[1].includes(`id="${back[0][1]}"`));
  assert.ok(origin, "Return has no actual decision target");
  assert.ok(origin[2].includes(forward[0][0]), "Forward link belongs to another decision");
  assert.ok(markup.includes(`<div id="${forward[0][1]}"><section class="update-candidate"`), "Draft target does not wrap the actual presenter");
  assert.match(origin[2], /Passed the rehearsal checks/);
  assert.equal((markup.match(/Inspect this item’s checked draft/g) ?? []).length, 1);
  assert.equal((markup.match(/Return to checked item/g) ?? []).length, 1);
  return { draft: forward[0][1], item: back[0][1] };
}
test("the actual complete standard result connects the exact checked item and its draft both ways", () => {
  const input = receipt(); assert.equal(fictionalUpdateResultSchema.safeParse(input).success, true);
  navigation(html(input), input);
});
test("revised and reordered results retain the original item ordinal rather than assuming the first item", () => {
  const input = receipt(true); input.report.items.reverse();
  assert.equal(fictionalUpdateResultSchema.safeParse(input).success, true);
  const links = navigation(html(input), input); assert.ok(links.item.endsWith("-item-3"));
});
test("navigation targets use local instance identity and ordinal instead of raw item key characters", () => {
  const input = receipt(); const origin = input.report.items.find(item => item.itemKey === input.report.fictionalCandidate.itemKey);
  origin.itemKey = 'odd key : / ? # < & "'; input.report.fictionalCandidate.itemKey = origin.itemKey;
  assert.equal(fictionalUpdateResultSchema.safeParse(input).success, true);
  const links = navigation(html(input), input);
  assert.match(links.item, /^[A-Za-z0-9_:-]+-item-0$/); assert.match(links.draft, /^[A-Za-z0-9_:-]+-draft$/);
});
test("simultaneous and same-object saved displays keep every link within its own result", () => {
  const input = receipt(), later = receipt(true);
  const markup = renderToStaticMarkup(createElement(Fragment, null, ...[input, later, input].map((value, key) => createElement(Saved, { input: value, key }))));
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  const forwards = [...markup.matchAll(/href="#([^"]+)">Inspect this item’s checked draft/g)].map(match => match[1]);
  const returns = [...markup.matchAll(/href="#([^"]+)">Return to checked item/g)].map(match => match[1]);
  assert.equal(forwards.length, 3); assert.equal(new Set(forwards).size, 3); assert.equal(new Set(returns).size, 3);
  for (let i = 0; i < 3; i++) assert.equal(forwards[i].replace(/-draft$/, ""), returns[i].replace(/-item-0$/, ""));
  for (const target of [...forwards, ...returns]) assert.equal(ids.filter(id => id === target).length, 1);
});
test("no-draft and refused results expose no draft navigation or reconstructed private data", () => {
  const missing = receipt(); missing.execution.scenario = "missing_source";
  Object.assign(missing.report, { state: "partial", coveredSourceKeys: [], items: [], fictionalCandidate: null });
  const invalid = receipt(); invalid.execution.scenario = "invalid_citation";
  Object.assign(invalid.report.items[0], { outcome: "held", reasonCodes: ["source_reference_invalid"], source: null, sourceBindingValid: false });
  Object.assign(invalid.report, { state: "partial", coveredSourceKeys: [], fictionalCandidate: null });
  for (const value of [missing, invalid]) { assert.equal(fictionalUpdateResultSchema.safeParse(value).success, true);
    const markup = html(value); assert.match(markup, /No checked page draft/); assert.doesNotMatch(markup, /Inspect this item|Return to checked item|id="[^"]+-draft"/); }
  for (const value of [{ ...receipt(), rawBody: "PRIVATE_CANARY" }, { ...receipt(), report: { ...receipt().report, publicChanges: 1 } }]) {
    const markup = html(value); assert.match(markup, /Saved rehearsal unavailable/); assert.doesNotMatch(markup, /PRIVATE_CANARY|Inspect this item|Return to checked item|27\.4/); }
});
test("standalone review HTML stays byte-identical when no paired draft context is supplied", () => {
  // Actual pre-change static HTML hashes, captured once for the fixed fixtures.
  const expected = ["cbe47cbfc367d48bfd7475591f9d4c464f1211738c48b2ba074ae912fba1d533", "62f89cbcd46d36501eb8453c221ccac3530a18a9c738a9cdb99893e09f37891b"];
  for (const [index, input] of [receipt(), receipt(true)].entries()) {
    const markup = renderToStaticMarkup(createElement(Review, { input }));
    assert.equal(createHash("sha256").update(markup).digest("hex"), expected[index]);
  }
});
