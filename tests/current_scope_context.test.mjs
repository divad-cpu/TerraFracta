import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
import { currentReadingGuideReturn } from "../src/current-reading-guide.ts";
import { findGlossaryTerms } from "../src/evidence-glossary.ts";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const origin = "https://example.invalid";
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map(match => ({ url: new URL(match[1].replaceAll("&amp;", "&"), origin), text: match[2] }));
const scope = html => /<section class="dossier-scope-note(?: [^"]*)?"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
function harness() {
  let candidate = sixStagePilotRows();
  // Deliberately present private fields that the closed public mapper must not expose.
  candidate.dossier.affected_population = "PRIVATE_POPULATION_CANARY";
  candidate.dossier.selection_rationale = "PRIVATE_SELECTION_CANARY";
  const calls = [], decisions = [], diagnostics = [];
  const read = createPublicIssueReader(async (route, signal) => {
    calls.push({ route: structuredClone(route), signal }); return new TextEncoder().encode(JSON.stringify(candidate));
  }, () => 0, code => diagnostics.push(code));
  const Page = loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx", import.meta.url), name =>
    name === "next/navigation" ? { notFound() { assert.fail("Unexpected route refusal"); }, unstable_rethrow() {} } :
    name.includes("server/public-issue-reader") ? { canonicalPublicIssueRoute, readPublicIssue: async route => {
      const decision = await read(route); decisions.push(decision); return decision;
    } } : undefined).default;
  return { calls, decisions, diagnostics, candidate, set: rows => { candidate = rows; },
    render: async (view, query = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({country:"norway",issue:"housing-costs",view}), searchParams: Promise.resolve(query) })),
  };
}

test("fresh checked issue source and search views disclose missing population and selection context without private or prototype fallback", async () => {
  const h = harness(), edition = h.candidate.publication.id;
  for (const view of ["issue", "sources", "search"]) {
    const html = await h.render(view, { edition }), block = scope(html); assert.ok(block, view);
    assert.match(block, /Affected population<\/dt><dd>Not supplied in this publication/);
    assert.match(block, /Why this issue was selected<\/dt><dd>Not supplied in this publication/);
    assert.match(block, /Statement counts and periods/); assert.match(block, /do not establish how many people are affected/);
    assert.doesNotMatch(html, /PRIVATE_POPULATION_CANARY|PRIVATE_SELECTION_CANARY|Chosen to exercise problem/);
    assert.equal((html.match(/class="dossier-scope-note(?: [^"]*)?"/g) ?? []).length, 1);
  }
  assert.equal(h.calls.length, 3); assert.ok(h.decisions.every(decision => decision.status === 200)); assert.deepEqual(h.diagnostics, []);
});

test("new population and selection definitions keep exact edition source and directory return through actual guide and current re-read", async () => {
  const h = harness(), edition = h.candidate.publication.id;
  const selection = { edition, q: "paragraph 6", type: "evaluation", relation: "supports", directoryView: "issues", directoryQ: "housing", directoryCountry: "norway", directoryTopic: "housing" };
  const html = await h.render("sources", selection), issue = h.decisions[0].issue;
  const expectedReturn = currentReadingGuideReturn(issue, currentIssueSelection("sources", selection));
  const Guide = loadTsx(new URL("../app/methodology/glossary/page.tsx", import.meta.url)).default;
  for (const slug of ["affected-population", "issue-selection"]) {
    const shortcut = links(scope(html)).find(row => row.url.hash === `#${slug}`); assert.ok(shortcut, slug);
    assert.equal(shortcut.url.searchParams.get("returnTo"), expectedReturn);
    const guide = renderToStaticMarkup(await Guide({ searchParams: Promise.resolve(Object.fromEntries(shortcut.url.searchParams)) }));
    assert.ok(guide.includes(`id="${slug}"`)); const back = links(guide).find(row => row.text === "Back to the selected dossier");
    assert.ok(back); assert.equal(back.url.pathname, "/reader-preview/norway/housing-costs/issue");
    const returned = await h.render("issue", Object.fromEntries(back.url.searchParams)); assert.ok(scope(returned));
    const sourceBack = links(returned).find(row => row.text === "Back to selected results"); assert.ok(sourceBack);
    assert.deepEqual(Object.fromEntries(sourceBack.url.searchParams), selection);
  }
  assert.equal(h.calls.length, 3); assert.deepEqual(h.diagnostics, []);
});

test("held absent and changed current editions reveal neither earlier scope note nor draft or statement metadata", async () => {
  for (const state of ["rights", "absent", "changed"]) {
    const h = harness(), edition = h.candidate.publication.id; assert.ok(scope(await h.render("issue", { edition })));
    const next = structuredClone(h.candidate);
    if (state === "rights") next.sources[0].registration.allow_public_derived = false;
    if (state === "changed") {
      const replacement = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      h.set(JSON.parse(JSON.stringify(next).replaceAll(edition, replacement)));
    } else h.set(state === "absent" ? null : next);
    for (const view of ["issue", "sources", "search"]) {
      const html = await h.render(view, { edition }); assert.equal(scope(html), "");
      assert.doesNotMatch(html, /id="claim-|Draft details|PRIVATE_|affected-population|issue-selection/);
      assert.match(html, /Issue temporarily unavailable|No eligible issue found|A newer publication is available/);
    }
    assert.deepEqual(h.diagnostics, []);
  }
});

test("population and selection guidance distinguishes denominator coverage and inclusion from national rankings", () => {
  const population = findGlossaryTerms({q:"affected population",category:"interpretation"}).terms.find(term => term.slug === "affected-population");
  const selection = findGlossaryTerms({q:"selection rationale",category:"interpretation"}).terms.find(term => term.slug === "issue-selection");
  assert.ok(population); assert.ok(selection);
  assert.match(population.explanation, /denominator/); assert.match(population.explanation, /not automatically describe/);
  assert.match(selection.explanation, /not a ranking/); assert.match(selection.explanation, /independent evidence/);
});


test("current dossier period remains explicitly unknown beside diverse six-stage statement periods and recorded review date", async () => {
 const h = harness(), edition = h.candidate.publication.id;
 h.candidate.dossier.scope_period = "PRIVATE_DOSSIER_PERIOD_CANARY";
 for (const view of ["issue", "sources", "search"]) {
  const html = await h.render(view, { edition }), block = scope(html);
  assert.match(block, /Dossier period<\/dt><dd>Not supplied in this publication/);
  assert.match(block, /Individual statement periods and the last evidence-review date do not define the whole dossier period/);
  assert.doesNotMatch(block, /2024|2025|PRIVATE_DOSSIER_PERIOD_CANARY/);
  assert.equal((block.match(/Dossier period<\/dt>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /PRIVATE_DOSSIER_PERIOD_CANARY/);
  assert.equal(h.decisions.at(-1).issue.lastEvidenceReviewOn, h.candidate.publication.snapshot.lastEvidenceReviewOn);
 }
 assert.equal(h.calls.length, 3); assert.deepEqual(h.diagnostics, []);
});

test("dossier-period reading question preserves exact current result context and cannot restore a later withheld dossier", async () => {
 const h = harness(), edition = h.candidate.publication.id;
 const selection = { edition, q: "paragraph 6", type: "evaluation", relation: "supports", directoryView: "issues", directoryQ: "housing", directoryCountry: "norway", directoryTopic: "housing" };
 const html = await h.render("sources", selection), issue = h.decisions[0].issue;
 const shortcut = links(scope(html)).find(row => row.text === "Definition: Statement data period"); assert.ok(shortcut);
 assert.equal(shortcut.url.hash, "#data-period"); assert.equal(shortcut.url.searchParams.get("returnTo"), currentReadingGuideReturn(issue, currentIssueSelection("sources", selection)));
 const Guide = loadTsx(new URL("../app/methodology/glossary/page.tsx", import.meta.url)).default;
 const guide = renderToStaticMarkup(await Guide({ searchParams: Promise.resolve(Object.fromEntries(shortcut.url.searchParams)) }));
 const back = links(guide).find(row => row.text === "Back to the selected dossier"); assert.ok(back);
 h.candidate.sources[0].registration.allow_public_derived = false;
 const returned = await h.render("issue", Object.fromEntries(back.url.searchParams));
 assert.match(returned, /Issue temporarily unavailable/); assert.equal(scope(returned), ""); assert.doesNotMatch(returned, /Dossier period|PRIVATE_/);
 assert.equal(h.calls.length, 2); assert.deepEqual(h.diagnostics, []);
});
