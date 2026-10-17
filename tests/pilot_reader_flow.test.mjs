import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader, createDevelopmentPublicIssueHandler, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { loadCurrentVisitorCatalogue } from "../src/server/current-visitor-catalog.ts";
import { checkCorrectionDraft } from "../src/correction-target.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { sixStagePilotRows, sixStagePilotSuccessor } from "./helpers/six_stage_pilot_rows.mjs";

const origin = "https://example.invalid", encode = rows => new TextEncoder().encode(JSON.stringify(rows));
const params = url => Object.fromEntries(url.searchParams);
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map(match => ({ url: new URL(match[1].replaceAll("&amp;", "&"), origin), text: match[2] }));
const link = (html, label) => links(html).find(row => row.text === label)?.url ?? assert.fail(`Missing link: ${label}`);
const control = (tree, type, suffix) => elements(tree).find(item => item.type === type && item.props.id?.endsWith(`-${suffix}`)) ?? assert.fail(`Missing ${suffix}`);
const review = tree => elements(tree).find(item => item.type === "button" && item.props.children === "Review draft");
const prepared = editor => editor.states().find(value => value?.requestId && value.draft);
const fields = { kind: "incorrect_statement", details: "Invented explanation of this exact example statement.", sourceUrl: "https://example.org/fictional-explanation" };
const held = html => { assert.match(html, /Issue temporarily unavailable|A newer publication is available|No eligible issue found/);
  assert.doesNotMatch(html, /id="claim-|class="citation-card|Draft details|Invented six-stage pilot dossier|fictional agency records/); };
function harness(initial = sixStagePilotRows()) {
  let candidate = initial;
  const calls = [], decisions = [], diagnostics = [];
  const read = createPublicIssueReader(async (route, signal) => {
    calls.push({ route: structuredClone(route), signal }); return encode(candidate);
  }, () => 0, code => diagnostics.push(code));
  const intercept = name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); }, unstable_rethrow() {} } :
    name.includes("server/current-visitor-catalog") ? { loadCurrentVisitorCatalogue: query => loadCurrentVisitorCatalogue(query, observedRead) } :
    name.includes("server/public-issue-reader") ? { canonicalPublicIssueRoute, readPublicIssue: observedRead } : undefined;
  async function observedRead(route) { const decision = await read(route); decisions.push(decision); return decision; }
  const Page = loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx", import.meta.url), intercept).default;
  const Catalogue = loadTsx(new URL("../app/reader-preview/catalogue/page.tsx", import.meta.url), intercept).default;
  return { calls, decisions, diagnostics, read, set: rows => { candidate = rows; },
    catalogue: async query => renderToStaticMarkup(await Catalogue({ searchParams: Promise.resolve(query) })),
    page: async destination => { const url = new URL(destination, origin), parts = url.pathname.split("/");
      return renderToStaticMarkup(await Page({ params: Promise.resolve({ country: parts[2], issue: parts[3], view: parts[4] }), searchParams: Promise.resolve(params(url)) })); },
  };
}
const directory = rows => ({ view: "issues", edition: rows.publication.id, q: "Norway housing", country: "norway", topic: "housing" });

test("six-stage native candidate keeps every distinct review citation dependency and funding delivery causal boundary", async () => {
  const rows = sixStagePilotRows(), before = structuredClone(rows), h = harness(rows);
  const decision = await h.read(rows.requestedRoute); assert.equal(decision.status, 200);
  assert.deepEqual(decision.issue.claims, rows.publication.snapshot.claims);
  assert.equal(decision.issue.claims.length, 6); assert.equal(rows.sources.length, 7); assert.equal(rows.citations.length, 8);
  assert.deepEqual(decision.issue.claims.map(claim => claim.type), ["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"]);
  assert.equal(decision.cacheControl, "no-store"); assert.deepEqual(rows, before); assert.deepEqual(h.diagnostics, []);
  const handler = createDevelopmentPublicIssueHandler(h.read, code => assert.fail(code));
  const request = () => new Request("http://127.0.0.1:3100/api/dev/public-issue/norway/housing-costs", { headers: { "sec-fetch-site": "same-origin" } });
  const context = { params: Promise.resolve({ country: "norway", issue: "housing-costs" }) };
  const beforeRefusal = h.calls.length;
  const refused = await handler(new Request(request().url), context, "development");
  assert.equal(refused.status, 403); assert.equal(h.calls.length, beforeRefusal);
  const response = await handler(request(), context, "development"); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual((await response.json()).issue, decision.issue);
  const calls = h.calls.length; assert.equal((await handler(request(), context, "production")).status, 404); assert.equal(h.calls.length, calls);
});

test("actual catalogue six-stage search statement source and correction callbacks preserve one freshly checked edition", async () => {
  const rows = sixStagePilotRows(), h = harness(rows), selected = directory(rows), catalogue = await h.catalogue(selected);
  const stageLinks = links(catalogue).filter(row => row.url.pathname.endsWith("/search") && row.url.searchParams.has("type"));
  assert.deepEqual(stageLinks.map(row => row.url.searchParams.get("type")), rows.publication.snapshot.claims.map(claim => claim.type));
  for (const [index, entry] of stageLinks.entries()) {
    const claim = rows.publication.snapshot.claims[index], search = await h.page(entry.url);
    assert.match(search, /1 statement matches/);
    const inspect = links(search).find(row => row.url.hash === `#claim-${claim.id}`); assert.ok(inspect);
    const issueHtml = await h.page(inspect.url), issue = h.decisions.at(-1).issue;
    assert.equal(issue.publicationId, rows.publication.id); assert.match(issueHtml, /6 statements in this dossier/);
    for (const statement of issue.claims) { assert.ok(issueHtml.includes(statement.assertion)); assert.ok(issueHtml.includes(statement.periodLabel)); }
    const editor = editorHarness(issue, "current"); let tree = editor.render();
    control(tree, "select", "claim").props.onChange({ target: { value: claim.id } }); tree = editor.render();
    control(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } }); tree = editor.render();
    control(tree, "input", "source").props.onChange({ target: { value: fields.sourceUrl } }); tree = editor.render();
    review(tree).props.onClick(); tree = editor.render(); const intent = prepared(editor); assert.ok(intent);
    assert.equal(intent.draft.target.claimId, claim.id); assert.equal(intent.draft.target.publicationId, rows.publication.id);
    const preview = renderToStaticMarkup(tree); assert.ok(preview.includes(claim.assertion)); assert.match(preview, /No message was sent and no record was created/);
    const sourceUrl = link(issueHtml, "Sources"); sourceUrl.searchParams.set("type", claim.type);
    const sourceHtml = await h.page(sourceUrl); assert.match(sourceHtml, new RegExp(`Showing ${claim.evidence.length} of 8 references`));
    for (const reference of claim.evidence) assert.ok(sourceHtml.includes(reference.locator));
    const back = link(sourceHtml, "Back to selected directory results"); assert.deepEqual(params(back), selected);
  }
  assert.equal(h.calls.length, 19); assert.ok(h.calls.every(call => call.signal.aborted));
  assert.ok(h.calls.every(call => JSON.stringify(call.route) === JSON.stringify(rows.requestedRoute)));
  assert.ok(h.decisions.every(decision => decision.status === 200 && decision.issue.publicationId === rows.publication.id)); assert.deepEqual(h.diagnostics, []);
});

test("a freshly supplied six-stage correction edition holds old navigation and resets exact current draft identity", async () => {
  const rows = sixStagePilotRows(), h = harness(rows), first = await h.catalogue(directory(rows));
  const entry = links(first).find(row => row.url.searchParams.get("type") === "attributed_finding");
  const search = await h.page(entry.url), issueLink = links(search).find(row => row.url.hash.startsWith("#claim-"));
  await h.page(issueLink.url); const issue = h.decisions.at(-1).issue, claim = issue.claims.find(row => row.type === "attributed_finding");
  const editor = editorHarness(issue, "current"); let tree = editor.render(); control(tree, "select", "claim").props.onChange({ target: { value: claim.id } });
  tree = editor.render(); control(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } }); tree = editor.render(); review(tree).props.onClick();
  const old = prepared(editor); assert.ok(old); const successor = sixStagePilotSuccessor(rows); h.set(successor);
  held(await h.page(issueLink.url)); const latest = new URL(issueLink.url); latest.search = "";
  const html = await h.page(latest), current = h.decisions.at(-1).issue;
  assert.equal(current.revision, 2); assert.equal(current.claims.length, 6); assert.ok(html.includes(successor.publication.snapshot.claims[4].assertion));
  assert.deepEqual(checkCorrectionDraft({ kind: "issue", issue: current }, old.draft), { kind: "held", reason: "changed" });
  tree = editor.render(current); assert.equal(control(tree, "textarea", "detail").props.value, ""); assert.equal(prepared(editor), undefined);
  assert.equal(control(tree, "select", "claim").props.value, ""); assert.deepEqual(h.diagnostics, []);
});

test("delivery or evaluation review citation and dependency faults hold the whole six-stage publication", async () => {
  const mutations = [
    (rows, claim) => { claim.assertion_review = null; }, (rows, claim) => { claim.period_review = null; },
    (rows, claim) => { claim.assertion_review.claim_type = "condition"; },
    (rows, claim) => { claim.assertion_review.display_assertion = "Unreviewed fictional substitute."; },
    (rows, claim) => { claim.period_review.period_label = "Unreviewed example period"; },
    (rows, claim) => { rows.citations = rows.citations.filter(row => row.claim_id !== claim.id); },
    (rows, claim) => { rows.citations.find(row => row.claim_id === claim.id).claim_id = rows.claims[0].id; },
    (rows, claim) => { const source = rows.citations.find(row => row.claim_id === claim.id).source_version_id;
      rows.publication.dependency_manifest.sourceVersionIds = rows.publication.dependency_manifest.sourceVersionIds.filter(id => id !== source); },
  ];
  for (const type of ["delivery", "evaluation"]) for (const mutate of mutations) {
    const rows = sixStagePilotRows(), h = harness(rows), claim = rows.claims.find(row => row.claim_type === type); mutate(rows, claim);
    held(await h.page(`/reader-preview/norway/housing-costs/issue?edition=${rows.publication.id}`));
    assert.equal(h.decisions[0].status, 503); assert.equal(h.calls.length, 1); assert.deepEqual(h.diagnostics, []);
  }
});

test("rights withdrawn from one distinct delivery or evaluation source remove all three current surfaces and their draft", async () => {
  for (const type of ["delivery", "evaluation"]) {
    const rows = sixStagePilotRows(), h = harness(rows), good = await h.read(rows.requestedRoute); assert.equal(good.status, 200);
    const editor = editorHarness(good.issue, "current"); let tree = editor.render(); control(tree, "textarea", "detail").props.onChange({ target: { value: fields.details } });
    tree = editor.render(); review(tree).props.onClick(); assert.ok(prepared(editor));
    const withdrawn = structuredClone(rows), claim = withdrawn.claims.find(row => row.claim_type === type);
    const sourceId = withdrawn.citations.find(row => row.claim_id === claim.id).source_version_id;
    withdrawn.sources.find(row => row.version.id === sourceId).registration.allow_public_derived = false; h.set(withdrawn);
    for (const view of ["issue", "sources", "search"]) held(await h.page(`/reader-preview/norway/housing-costs/${view}?edition=${rows.publication.id}`));
    const unavailable = editor.render(null); assert.match(renderToStaticMarkup(unavailable), /Correction draft unavailable/); assert.deepEqual(editor.states(), []);
    assert.deepEqual(h.diagnostics, []); assert.equal(h.calls.length, 4);
  }
});
