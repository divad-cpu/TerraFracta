import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalScope, proposalId } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
const types=['condition','policy_action','funding','delivery','attributed_finding','evaluation'];
const View=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView;
const sha=value=>createHash('sha256').update(value).digest('hex');
function record(change=()=>{}) {
 const report=proposalReport(),proposed=JSON.parse(report.capture.proposalJson),base=JSON.parse(report.base.publicationJson);
 const exemplar=proposed.snapshot.claims[0];proposed.snapshot.claims=types.map((type,index)=>({...structuredClone(exemplar),id:proposalId(index+30),type,periodLabel:`Invented period ${index+1}`,assertion:`Invented ${type} statement.`}));
 base.snapshot=structuredClone(proposed.snapshot);change(proposed,base,report);Object.assign(report.capture,encodeProposalCapture(proposed));
 if(report.base!==null){const publicationJson=JSON.stringify(base),publicationSha256=sha(publicationJson);report.base={publicationJson,publicationSha256};report.capture.baseContentSha256=publicationSha256;}
 assert.equal(parseCapturedProposalEnvelope(report).status,'ok');return report;
}
const render=(report,selection=proposalScope())=>renderToStaticMarkup(View({decision:{kind:'ok',report},selection}));
const body=html=>/<section id="proposal-statement-types"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1]??'';
const groups=html=>[...body(html).matchAll(/<div[^>]*data-statement-type="([^"]+)"[^>]*>([\s\S]*?)<\/dd><\/div>/g)].map(m=>({type:m[1],text:m[2]}));
const targets=html=>{const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);for(const [,id]of html.matchAll(/href="#([^"]+)"/g))assert.equal(ids.filter(x=>x===id).length,1,id);};
test('six recorded statement categories link to their exact panel positions and periods without qualifying the chain',()=>{
 const report=record(),before=structuredClone(report),html=render(report),rows=groups(html);assert.equal(rows.length,6);assert.deepEqual(rows.map(row=>row.type),types);
 for(const [index,row]of rows.entries()){assert.match(row.text,/Recorded panel: 1 statement/);assert.match(row.text,/Proposed panel: 1 statement/);for(const side of ['base','proposed'])assert.ok(row.text.includes(`href="#proposal-${side}-claim-${proposalId(index+30)}"`));assert.ok(row.text.includes(`statement ${index+1}: Invented period ${index+1}`));}
 assert.match(body(html),/not a chronology, progress score or evidence of cause/);assert.match(body(html),/Missing types describe these captured panels/);assert.deepEqual(report,before);targets(html);
});
test('removed retyped reordered and same-period statements retain side-specific positions rather than inferred stage progress',()=>{
 const report=record((p,b)=>{p.snapshot.claims.splice(3,1);p.snapshot.claims[2].type='evaluation';const extra={...structuredClone(p.snapshot.claims[0]),id:proposalId(70),type:'funding',periodLabel:'Invented period 3'};p.snapshot.claims.unshift(extra);p.snapshot.claims.reverse();});
 const html=render(report),rows=groups(html),funding=rows.find(row=>row.type==='funding').text,evaluation=rows.find(row=>row.type==='evaluation').text,delivery=rows.find(row=>row.type==='delivery').text;
 assert.ok(funding.includes(`href="#proposal-base-claim-${proposalId(32)}"`));assert.ok(funding.includes(`href="#proposal-proposed-claim-${proposalId(70)}"`));assert.ok(!funding.includes(`href="#proposal-proposed-claim-${proposalId(32)}"`));assert.match(funding,/Proposed statement 6: Invented period 3/);
 assert.match(evaluation,/Proposed panel: 2 statements/);assert.match(evaluation,/Proposed statement 1: Invented period 6/);assert.match(evaluation,/Proposed statement 3: Invented period 3/);
 assert.match(delivery,/No statement of this type in the proposed panel/);assert.match(delivery,/Recorded panel: 1 statement/);assert.match(html,/1 added; 1 removed; 1 changed; 4 unchanged/);targets(html);
});
test('checked absent base is distinct from a missing type and refused comparisons expose no stage overview',()=>{
 const absent=record((p,b,r)=>{r.base=null;r.capture.basePublicationId=null;r.capture.baseContentSha256=null;r.capture.baseHeadChangedAt=null;}),html=render(absent);
 assert.match(body(html),/The witnessed issue head had no publication/);assert.doesNotMatch(body(html),/Recorded panel: 0|No statement of this type in the recorded panel/);assert.equal((body(html).match(/Proposed panel: 1 statement/g)??[]).length,6);assert.doesNotMatch(body(html),/href="#proposal-base-claim/);targets(html);
 const good=record(),bad=structuredClone(good);bad.capture.proposalSha256='0'.repeat(64);
 for(const output of [render(bad),render(good,{runId:proposalId(99),decisionId:proposalId(2)}),...['invalid_scope','unconfigured','unavailable','not_found','capture_missing','changed'].map(kind=>renderToStaticMarkup(View({decision:{kind,report:good},selection:proposalScope()})))])assert.equal(body(output),'');
});
test('actual finite-byte proposal page preserves escaped stage locations and loses them on a changed read',async()=>{
 const good=record((p,b)=>{p.snapshot.claims[5].periodLabel='<script>PRIVATE-looking period</script>';p.snapshot.claims[5].assertion='<img src=x onerror=alert(1)>';});const calls=[];
 const reader=createProposalReader(async(scope,signal)=>{calls.push({scope,signal});return new TextEncoder().encode(JSON.stringify(calls.length===1?good:{schemaVersion:1,status:'changed',requested:scope}));},()=>0,()=>assert.fail('diagnostic'));
 const Page=loadTsx(new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('refusal');},unstable_rethrow(){}}:name.endsWith('operator-proposal-reader.ts')?{readCapturedProposal:reader}:undefined).default;
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve(proposalScope())}));assert.match(body(html),/&lt;script&gt;PRIVATE-looking period&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x|<form|href="https:/);assert.match(html, /<button type="button" disabled="">Review scope draft/);targets(html);
 const changed=renderToStaticMarkup(await Page({searchParams:Promise.resolve(proposalScope())}));assert.equal(body(changed),'');assert.match(changed,/Comparison changed/);assert.equal(calls.length,2);assert.ok(calls.every(row=>row.signal.aborted));assert.deepEqual(calls.map(row=>row.scope),[proposalScope(),proposalScope()]);
});
