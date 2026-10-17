import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentCatalogueSelection, currentCatalogueResult } from "../src/current-visitor-catalog.ts";
import { loadCurrentVisitorCatalogue } from "../src/server/current-visitor-catalog.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const rows = sample(), entry = { ...rows.requestedRoute, country: "Imaginary place",
  countryAliases: ["Imaginary place"], topic: "housing", topicLabel: "Housing" };
const read = createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)), () => performance.now(), () => {});
const decision = await read(rows.requestedRoute);
assert.equal(decision.status, 200);
const edition = decision.issue.publicationId;
const View = loadTsx(new URL("../src/current-visitor-catalog-view.tsx", import.meta.url)).CurrentVisitorCatalogueView;
const selected = (query = {}) => currentCatalogueSelection({ view: "issues", edition, ...query }, entry);
const render = result => renderToStaticMarkup(createElement(View, { result, entry }));
const result = query => currentCatalogueResult(decision, selected(query), entry);
const filters = html => {
  const aside = html.match(/<aside\b[^>]*aria-label="Active directory filters"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(aside, "available directory must explain and expose active filters");
  return aside[1];
};
const links = html => [...html.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)]
  .map(([, href, text]) => ({ text, url: new URL(href.replaceAll("&amp;", "&"), "https://example.invalid") }));
const query = url => Object.fromEntries(url.searchParams);

test("current directory removes one visible filter while keeping its edition, view and other selections", () => {
  const html = filters(render(result({ q: "housing", country: entry.jurisdictionSlug, topic: entry.topic })));
  assert.ok(html.includes("Search words: housing"));
  assert.ok(html.includes("Country: Imaginary place"));
  assert.ok(html.includes("Topic: Housing"));
  for (const [field, label] of [["q", "Remove search words"], ["country", "Remove country"], ["topic", "Remove topic"]]) {
    const action = links(html).find(item => item.text === label);
    assert.ok(action, label);
    const expected = { view: "issues", edition, q: "housing", country: entry.jurisdictionSlug, topic: entry.topic };
    delete expected[field];
    assert.equal(action.url.pathname, "/reader-preview/catalogue");
    assert.equal(action.url.hash, "");
    assert.deepEqual(query(action.url), expected);
    assert.ok(currentCatalogueSelection(query(action.url), entry));
  }
  assert.deepEqual(query(links(html).find(item => item.text === "Clear all directory filters").url), { view: "issues", edition });
});

test("removal works on matching and empty results through one fresh checked directory read", async () => {
  const calls = [];
  const failedMatch = result({ q: "missing search phrase", country: entry.jurisdictionSlug, topic: entry.topic });
  assert.equal(failedMatch.matches, false);
  const action = links(filters(render(failedMatch))).find(item => item.text === "Remove search words");
  const next = await loadCurrentVisitorCatalogue(query(action.url), async route => { calls.push(structuredClone(route)); return read(route); }, entry);
  assert.deepEqual(calls, [rows.requestedRoute]);
  assert.equal(next.kind, "available"); assert.equal(next.matches, true);
  assert.equal(next.selection.publicationId, edition);
  assert.equal(next.selection.query, "");
  assert.equal(next.selection.country, entry.jurisdictionSlug); assert.equal(next.selection.topic, entry.topic);
  const html = render(next);
  assert.ok(html.includes("1 dossier matches in the selected reader scope"));
  assert.ok(filters(html).includes("Remove country"));
  assert.ok(!filters(html).includes("Remove search words"));
});

test("all admitted views expose their active selection and empty selections have no filter controls", () => {
  for (const view of ["overview", "countries", "issues"]) {
    const html = render(result({ view, q: "Imaginary", country: entry.jurisdictionSlug, topic: entry.topic }));
    const actions = links(filters(html));
    assert.deepEqual(query(actions.find(item => item.text === "Remove search words").url),
      { view, edition, country: entry.jurisdictionSlug, topic: entry.topic });
    assert.deepEqual(query(actions.find(item => item.text === "Clear all directory filters").url), { view, edition });
    assert.ok(!render(result({ view })).includes("Active directory filters"));
  }
});

test("literal search punctuation stays escaped and encoded inside fixed directory navigation", () => {
  const literal = 'housing & <script> # ? /';
  const html = filters(render(result({ q: literal, country: entry.jurisdictionSlug })));
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
  const action = links(html).find(item => item.text === "Remove country");
  assert.deepEqual(query(action.url), { view: "issues", edition, q: literal });
  assert.equal(action.url.origin, "https://example.invalid"); assert.equal(action.url.hash, "");
});

test("invalid, absent, unavailable and replaced directory results withhold all filter actions and previous detail", () => {
  const selection = selected({ q: "private previous query", country: entry.jurisdictionSlug, topic: entry.topic });
  for (const kind of ["invalid", "absent", "unavailable", "changed"]) {
    const html = render(kind === "invalid" ? { kind } : { kind, selection });
    assert.ok(!html.includes("Active directory filters") && !html.includes("Remove country"));
    assert.ok(!html.includes("private previous query") && !html.includes(decision.issue.title));
    assert.ok(!html.includes("1 dossier matches") && !html.includes("0 dossier matches"));
  }
});
