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
  candidate.dossier.responsible_institution = "PRIVATE_INSTITUTION_CANARY";
  candidate.dossier.government_term = "PRIVATE_TERM_CANARY";
  candidate.dossier.responsibility_roles = "PRIVATE_ROLE_CANARY";
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

const responsibility = html => /<section class="dossier-responsibility-note(?: [^"]*)?"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

test("checked three-view responsibility coverage distinguishes structured omissions from named assertions and publisher identity", async () => {
 const h=harness(), edition=h.candidate.publication.id;
 for(const view of ["issue","sources","search"]) {
  const html=await h.render(view,{edition}), block=responsibility(html); assert.ok(block,view);
  for(const field of ["Responsible institution and level","Government term or responsibility period","Introduction, amendment, funding and delivery roles"])
   assert.ok(block.includes(field+"</dt><dd>Not supplied as separate reviewed fields in this publication."));
  assert.match(block,/Statements may name authorities/); assert.match(block,/A source publisher is not necessarily the responsible authority/);
  assert.match(block,/Do not assign earlier measures automatically to the current government/);
  assert.doesNotMatch(html,/PRIVATE_INSTITUTION_CANARY|PRIVATE_TERM_CANARY|PRIVATE_ROLE_CANARY/);
  assert.equal((html.match(/class="dossier-responsibility-note(?: [^"]*)?"/g)??[]).length,1);
 }
 assert.equal(h.calls.length,3);assert.deepEqual(h.diagnostics,[]);
});
test("responsibility definition round trip keeps edition exact source filters and directory selection",async()=>{
 const h=harness(),edition=h.candidate.publication.id;
 const selected={edition,q:"paragraph 6",type:"evaluation",relation:"supports",directoryView:"issues",directoryQ:"housing",directoryCountry:"norway",directoryTopic:"housing"};
 const html=await h.render("sources",selected), shortcut=links(responsibility(html)).find(x=>x.url.hash==="#responsibility");
 assert.ok(shortcut);assert.equal(shortcut.url.searchParams.get("returnTo"),currentReadingGuideReturn(h.decisions[0].issue,currentIssueSelection("sources",selected)));
 const Guide=loadTsx(new URL("../app/methodology/glossary/page.tsx",import.meta.url)).default;
 const guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve(Object.fromEntries(shortcut.url.searchParams))}));
 assert.ok(guide.includes('id="responsibility"'));const back=links(guide).find(x=>x.text==="Back to the selected dossier");assert.ok(back);
 const returned=await h.render("issue",Object.fromEntries(back.url.searchParams));assert.ok(responsibility(returned));
 const sourceBack=links(returned).find(x=>x.text==="Back to selected results");assert.ok(sourceBack);assert.deepEqual(Object.fromEntries(sourceBack.url.searchParams),selected);
 assert.equal(h.calls.length,2);assert.deepEqual(h.diagnostics,[]);
});
test("rights absent and changed observations withhold earlier responsibility context and cannot revive it through guide return",async()=>{
 for(const state of ["rights","absent","changed"]) {
  const h=harness(),edition=h.candidate.publication.id,html=await h.render("issue",{edition});
  const shortcut=links(responsibility(html)).find(x=>x.url.hash==="#responsibility");assert.ok(shortcut);
  const next=structuredClone(h.candidate);
  if(state==="rights")next.sources[0].registration.allow_public_derived=false;
  h.set(state==="absent"?null:state==="changed"?JSON.parse(JSON.stringify(next).replaceAll(edition,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")):next);
  const Guide=loadTsx(new URL("../app/methodology/glossary/page.tsx",import.meta.url)).default;
  const guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve(Object.fromEntries(shortcut.url.searchParams))}));
  const back=links(guide).find(x=>x.text==="Back to the selected dossier");assert.ok(back);assert.equal(back.url.searchParams.get("edition"),edition);
  for(const view of ["issue","sources","search"]){
   const held=await h.render(view,Object.fromEntries(back.url.searchParams));assert.equal(responsibility(held),"");assert.doesNotMatch(held,/PRIVATE_|Definition: Responsibility|id="claim-/);
   assert.match(held,/Issue temporarily unavailable|No eligible issue found|A newer publication is available/);
  }
  assert.deepEqual(h.diagnostics,[]);
 }
});
test("authored responsibility definition keeps different actors roles terms and source attribution separate",()=>{
 const result=findGlossaryTerms({q:"responsibility",category:"statements"}),term=result.terms.find(x=>x.slug==="responsibility");assert.ok(term);
 for(const phrase of ["institution","level of government","period","introduction","amendment","funding","delivery","current government","publisher"])assert.ok(term.explanation.toLowerCase().includes(phrase),phrase);
 assert.match(term.question,/which role and period/);assert.equal(findGlossaryTerms({q:"responsibility",category:"evidence"}).terms.some(x=>x.slug==="responsibility"),false);
});
test("responsibility omission does not replace the six-stage dated statements or turn missing structured roles into government inaction",async()=>{
 const h=harness(),html=await h.render("issue",{edition:h.candidate.publication.id}),block=responsibility(html);
 assert.ok(block);assert.match(html,/A fictional authority adopted an example programme/);assert.match(html,/A fictional agency records completion/);
 assert.match(html,/Example 2024 adoption/);assert.match(html,/Example 2025 delivery/);
 assert.doesNotMatch(block,/No authority|No responsible|government inaction|Fictional|2024|2025/);
 assert.equal(h.decisions[0].issue.claims.length,6);
});
