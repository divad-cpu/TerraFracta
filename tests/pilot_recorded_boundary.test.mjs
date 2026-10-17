import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { proposalReport, proposalScope } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture } from "../src/server/proposal-capture.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
import { createPublicIssueReader, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");
const proposedWording="A fictional budget proposal would allocate 20 example units; it is held, not an enacted allocation.";
function capture(rows) {
 const report=proposalReport(),publication=rows.publication;
 const base={id:publication.id,issueId:publication.issue_id,revision:publication.revision,kind:publication.publication_kind,snapshot:structuredClone(publication.snapshot),dependencyManifest:structuredClone(publication.dependency_manifest)};
 const payload={schemaVersion:1,kind:"review_only",snapshot:structuredClone(base.snapshot),dependencyManifest:structuredClone(base.dependencyManifest),conflictCoverage:"recorded_partial",translation:{displayLanguage:"en",status:"unreviewed"}};
 payload.snapshot.claims.find(claim=>claim.type==="funding").assertion=proposedWording;
 Object.assign(report.target,{issueId:base.issueId,jurisdictionId:rows.country.id,...rows.requestedRoute});
 const first=payload.snapshot.claims[0].evidence[0];Object.assign(report.decision,{sourceVersionId:first.sourceVersionId,sourceSha256:sha(first.sourceVersionId),evidenceLocator:first.locator});
 report.sourceReceipts=rows.sources.map(source=>({sourceVersionId:source.version.id,contentSha256:sha(source.version.id),retrievedAt:new Date(source.version.retrieved_at).toISOString().replace(".000Z",".000000Z"),languageCode:null}));
 const publicationJson=JSON.stringify(base),publicationSha256=sha(publicationJson);report.base={publicationJson,publicationSha256};
 Object.assign(report.capture,{...encodeProposalCapture(payload),basePublicationId:base.id,baseContentSha256:publicationSha256});return report;
}
function harness() {
 const rows=sixStagePilotRows();let current=rows,recorded=capture(rows);const observed={proposal:[],current:[],diagnostics:[]};
 const proposed=createProposalReader(async(scope,signal)=>{observed.proposal.push({scope,signal});return new TextEncoder().encode(JSON.stringify(recorded));},()=>0,code=>observed.diagnostics.push(code));
 const read=createPublicIssueReader(async(route,signal)=>{observed.current.push({route,signal});return new TextEncoder().encode(JSON.stringify(current));},()=>0,code=>observed.diagnostics.push(code));
 const Private=loadTsx(new URL("../app/editorial-preview/held/proposal/page.tsx",import.meta.url),name=>name==="next/navigation"?{notFound(){assert.fail("unexpected refusal");},unstable_rethrow(){}}:name.includes("server/operator-proposal-reader")?{readCapturedProposal:proposed}:undefined).default;
 const Public=loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx",import.meta.url),name=>name==="next/navigation"?{notFound(){assert.fail("unexpected refusal");},unstable_rethrow(){}}:name.includes("server/public-issue-reader")?{canonicalPublicIssueRoute,readPublicIssue:read}:undefined).default;
 return {rows,recorded,observed,proposed,read,setCurrent:value=>{current=value;},setRecorded:value=>{recorded=value;},private:async()=>renderToStaticMarkup(await Private({searchParams:Promise.resolve(proposalScope())})),public:async view=>renderToStaticMarkup(await Public({params:Promise.resolve({country:rows.requestedRoute.jurisdictionSlug,issue:rows.requestedRoute.issueSlug,view}),searchParams:Promise.resolve({edition:rows.publication.id})}))};
}
test("six-stage recorded proposal and current reader share exact base identities without promoting held wording into the reader or draft",async()=>{
 const h=harness(),before=structuredClone(h.rows);const historical=await h.private();
 assert.ok(historical.includes(proposedWording));assert.match(historical,/1 changed; 5 unchanged/);assert.match(historical,/16 reference occurrences across 7 recorded source versions/);
 for(const claim of h.rows.publication.snapshot.claims){assert.ok(historical.includes(claim.id));assert.ok(historical.includes(claim.periodLabel));}
 for(const view of ["issue","sources","search"]){const html=await h.public(view);assert.doesNotMatch(html,new RegExp(proposedWording));assert.ok(html.includes(h.rows.publication.snapshot.claims.find(claim=>claim.type==="funding").assertion));}
 const decision=await h.read(h.rows.requestedRoute);assert.equal(decision.status,200);const funding=decision.issue.claims.find(claim=>claim.type==="funding"),editor=editorHarness(decision.issue,"current");let tree=editor.render();
 elements(tree).find(row=>row.type==="select"&&row.props.id?.endsWith("-claim")).props.onChange({target:{value:funding.id}});tree=editor.render();
 elements(tree).find(row=>row.type==="textarea").props.onChange({target:{value:"Invented note about the recorded allocation, not the held proposal."}});tree=editor.render();elements(tree).find(row=>row.type==="button"&&row.props.children==="Review draft").props.onClick();
 const request=editor.states().find(value=>value?.requestId&&value.draft);assert.equal(request.draft.target.publicationId,h.rows.publication.id);assert.equal(request.draft.target.claimId,funding.id);assert.deepEqual(Object.keys(request.draft).sort(),["fields","target"]);assert.doesNotMatch(renderToStaticMarkup(editor.render()),new RegExp(proposedWording));
 assert.deepEqual(h.rows,before);assert.equal(h.observed.proposal.length,1);assert.equal(h.observed.current.length,4);assert.deepEqual(h.observed.diagnostics,[]);
});
test("captured-receipt integrity and present source rights remain independent across editorial and reader views",async()=>{
 const h=harness(),good=structuredClone(h.recorded),bad=structuredClone(good);bad.sourceReceipts.at(-1).sourceVersionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";h.setRecorded(bad);
 const refused=await h.private();assert.doesNotMatch(refused,/proposal-source-index|proposal-base-snapshot|proposal-proposed-snapshot/);assert.doesNotMatch(refused,new RegExp(proposedWording));assert.ok((await h.public("issue")).includes("Invented six-stage pilot dossier"));
 h.setRecorded(good);const held=structuredClone(h.rows);held.sources.find(source=>source.version.id===held.publication.snapshot.claims.find(claim=>claim.type==="evaluation").evidence[0].sourceVersionId).registration.allow_public_derived=false;h.setCurrent(held);
 const historical=await h.private();assert.ok(historical.includes(proposedWording));assert.ok(historical.includes("Current public eligibility and source health were not checked"));
 for(const view of ["issue","sources","search"]){const html=await h.public(view);assert.match(html,/Issue temporarily unavailable/);assert.doesNotMatch(html,/id="claim-|Draft details|current-source-entry/);}
 assert.equal(h.observed.proposal.length,2);assert.equal(h.observed.current.length,4);assert.deepEqual(h.observed.diagnostics,["operator_audit_read"]);assert.ok([...h.observed.current,...h.observed.proposal].every(call=>call.signal.aborted));
});
