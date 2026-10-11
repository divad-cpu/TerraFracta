import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { createPublicIssueReader,canonicalPublicIssueRoute } from '../src/server/public-issue-reader.ts';
const origin='https://example.invalid';
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const target=(html,label)=>links(html).find(row=>row.text===label)?.href??assert.fail(`Missing ${label}`);
const query=href=>Object.fromEntries(new URL(href,origin).searchParams);
const Guide=loadTsx(new URL('../app/methodology/glossary/page.tsx',import.meta.url)).default;
function rows(){const r=sample();r.requestedRoute={jurisdictionSlug:'norway',issueSlug:'housing-costs'};r.country.public_slug='norway';r.dossier.public_slug='housing-costs';r.publication.snapshot.jurisdictionSlug='norway';r.publication.snapshot.issueSlug='housing-costs';return r}
function harness(providerRows){
 const calls=[],decisions=[],diagnostics=[];
 const provider=providerRows===undefined?undefined:async(route,signal)=>{calls.push({route:structuredClone(route),aborted:signal.aborted});const r=providerRows(calls.length);return r instanceof Uint8Array?r:new TextEncoder().encode(JSON.stringify(r))};
 const read=createPublicIssueReader(provider,()=>0,kind=>{diagnostics.push(kind)});
 const Page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){throw Error('NOT_FOUND')}}:name.endsWith('/server/public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:async route=>{const d=await read(route);decisions.push(d.status===200?{status:d.status,publicationId:d.issue.publicationId,revision:d.issue.revision}:{status:d.status});return d}}:undefined,{env:{NODE_ENV:'development'}}).default;
 return{calls,decisions,diagnostics,render:async href=>{const url=new URL(href,origin),parts=url.pathname.split('/');return renderToStaticMarkup(await Page({params:Promise.resolve({country:parts[2],issue:parts[3],view:parts[4]}),searchParams:Promise.resolve(Object.fromEntries(url.searchParams))}))}};
}
const issueHref=()=>`/reader-preview/norway/housing-costs/issue?${new URLSearchParams({edition:rows().publication.id,returnView:'sources',returnQ:'cell A1',returnType:'condition',returnRelation:'supports',directoryView:'issues',directoryQ:'housing',directoryCountry:'norway',directoryTopic:'housing'})}`;
async function openGuide(h){const initial=await h.render(issueHref());assert.equal(h.decisions.at(-1).status,200);const entry=target(initial,'Look up statement, source and date terms in the reading guide'),fields=query(entry);const html=renderToStaticMarkup(await Guide({searchParams:Promise.resolve({...fields,q:'money',category:'statements'})}));assert.match(html,/id="funding"/);return{initial,guide:html,back:target(html,'Back to the selected dossier')}}
const assertHeld=(html)=>{assert.doesNotMatch(html,/id="claim-|class="citation-card|Look up statement, source and date terms|Back to selected results|Back to selected directory results/);assert.match(html,/Issue temporarily unavailable|No eligible issue found|A newer publication is available/)};

test('guide journey executes actual closed-byte current reader before entry return and selected references',async()=>{
 const h=harness(()=>rows()),opened=await openGuide(h),returned=await h.render(opened.back),sources=target(returned,'Back to selected results');assert.deepEqual(query(sources),{edition:rows().publication.id,directoryView:'issues',directoryQ:'housing',directoryCountry:'norway',directoryTopic:'housing',q:'cell A1',type:'condition',relation:'supports'});const inspected=await h.render(sources);assert.match(inspected,/References in this dossier/);assert.match(inspected,/Showing 1 of 3 references/);assert.equal(h.calls.length,3);assert.deepEqual(h.calls.map(row=>row.route),Array(3).fill({jurisdictionSlug:'norway',issueSlug:'housing-costs'}));assert.ok(h.calls.every(row=>row.aborted===false));assert.deepEqual(h.decisions.map(row=>row.status),[200,200,200]);assert.deepEqual(h.diagnostics,[])
});

test('rights withdrawn after guide entry holds the newly read returned dossier with no earlier details',async()=>{
 const h=harness(n=>{const r=rows();if(n>1)r.sources[0].registration.allow_public_derived=false;return r}),opened=await openGuide(h),returned=await h.render(opened.back);assertHeld(returned);assert.deepEqual(h.decisions.map(row=>row.status),[200,503]);assert.equal(h.calls.length,2);assert.deepEqual(h.diagnostics,[]);assert.match(opened.guide,/Returning checks the current publication again/)
});

test('suspended source after guide entry holds return without claiming absent evidence or source health',async()=>{
 const h=harness(n=>{const r=rows();if(n>1)r.sources[0].registration.registration_state='suspended';return r}),opened=await openGuide(h),returned=await h.render(opened.back);assertHeld(returned);assert.match(returned,/Earlier statements and references are withheld/);assert.deepEqual(h.decisions.map(row=>row.status),[200,503]);assert.deepEqual(h.diagnostics,[])
});

test('replaced eligible edition is freshly materialized but the old guide selection reveals no newer or prior assertions',async()=>{
 const old=rows().publication.id,newId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const h=harness(n=>{const r=rows();if(n===1)return r;return JSON.parse(JSON.stringify(r).replaceAll(old,newId),(key,value)=>key==='revision'&&typeof value==='number'?value+1:value)}),opened=await openGuide(h),returned=await h.render(opened.back);assertHeld(returned);assert.match(returned,/A newer publication is available/);assert.deepEqual(h.decisions.map(row=>row.status),[200,200]);assert.equal(h.decisions[1].publicationId,newId);assert.equal(h.decisions[1].revision,h.decisions[0].revision+1);assert.equal(h.calls.length,2);assert.deepEqual(h.diagnostics,[])
});

test('mismatched stored head after entry produces actual technical withholding rather than a saved issue',async()=>{
 const h=harness(n=>{const r=rows();if(n>1)r.head.current_publication_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';return r}),opened=await openGuide(h),returned=await h.render(opened.back);assertHeld(returned);assert.deepEqual(h.decisions.map(row=>row.status),[200,503]);assert.equal(h.calls.length,2);assert.deepEqual(h.diagnostics,[])
});

test('SQL-null candidate on the new return becomes absent through the actual current reader',async()=>{
 const h=harness(n=>n===1?rows():null),opened=await openGuide(h),returned=await h.render(opened.back);assertHeld(returned);assert.match(returned,/No eligible issue found/);assert.deepEqual(h.decisions.map(row=>row.status),[200,404]);assert.equal(h.calls.length,2);assert.deepEqual(h.diagnostics,[])
});

test('undecodable new candidate response holds the returned issue with detail-free diagnostics',async()=>{
 const h=harness(n=>n===1?rows():new Uint8Array([0xff,0xfe])),opened=await openGuide(h),returned=await h.render(opened.back);assertHeld(returned);assert.deepEqual(h.decisions.map(row=>row.status),[200,503]);assert.equal(h.calls.length,2);assert.equal(h.diagnostics.length,1);assert.doesNotMatch(returned,/byte|0xff|decoder|JSON/)
});

test('an accepted guide link never configures the actual default unconfigured reader',async()=>{
 const active=harness(()=>rows()),opened=await openGuide(active),unconfigured=harness(),returned=await unconfigured.render(opened.back);assertHeld(returned);assert.deepEqual(unconfigured.calls,[]);assert.deepEqual(unconfigured.decisions,[{status:503}]);assert.deepEqual(unconfigured.diagnostics,[])
});

test('selected source destination performs a third current read and holds rights lost after returning to the issue',async()=>{
 const h=harness(n=>{const r=rows();if(n>2)r.sources[0].registration.allow_public_derived=false;return r}),opened=await openGuide(h),returned=await h.render(opened.back);assert.match(returned,/id="claim-/);const destination=target(returned,'Back to selected results'),sources=await h.render(destination);assertHeld(sources);assert.doesNotMatch(sources,/References in this dossier|class="current-source-list"|cell A1/);assert.deepEqual(h.decisions.map(row=>row.status),[200,200,503]);assert.equal(h.calls.length,3);assert.deepEqual(h.diagnostics,[])
});
