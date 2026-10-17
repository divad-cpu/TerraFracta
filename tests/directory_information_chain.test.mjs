import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {sample} from './helpers/public_read_rows_fixture.mjs';
import {createPublicIssueReader,canonicalPublicIssueRoute} from '../src/server/public-issue-reader.ts';
import {loadCurrentVisitorCatalogue} from '../src/server/current-visitor-catalog.ts';
import {currentCatalogueSelection,currentCatalogueResult,currentVisitorEntry} from '../src/current-visitor-catalog.ts';
import {currentIssueSelection,currentIssueDirectoryHref} from '../src/current-issue-navigation.ts';
import {publicIssueProjectionSchema} from '../src/public-issue-projection.ts';
const View=loadTsx(new URL('../src/current-visitor-catalog-view.tsx',import.meta.url)).CurrentVisitorCatalogueView;
const rows=sample();rows.requestedRoute={jurisdictionSlug:'norway',issueSlug:'housing-costs'};rows.country.public_slug='norway';rows.dossier.public_slug='housing-costs';rows.publication.snapshot.jurisdictionSlug='norway';rows.publication.snapshot.issueSlug='housing-costs';
const initial={view:'issues',edition:rows.publication.id,q:'Norway housing',country:'norway',topic:'housing'};
const bytes=x=>new TextEncoder().encode(JSON.stringify(x));
const reader=createPublicIssueReader(async()=>bytes(rows),()=>0,()=>assert.fail('diagnostic'));const checked=await reader(rows.requestedRoute);assert.equal(checked.status,200);
const render=(decision=checked,query=initial)=>renderToStaticMarkup(View({result:currentCatalogueResult(decision,currentCatalogueSelection(query))}));
const disclosure=html=>/<details class="catalogue-dossier-stages">([\s\S]*?)<\/details>/.exec(html)?.[1]??'';
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(m=>({url:new URL(m[1].replaceAll('&amp;','&'),'https://example.invalid'),text:m[2]}));
const params=u=>Object.fromEntries(u.searchParams);
function populated(){const issue=structuredClone(checked.issue),template=issue.claims[0];issue.claims=[['delivery','2024–2025'],['condition','2023'],['policy_action','2024'],['condition','2023 revised']].map(([type,periodLabel],i)=>({...structuredClone(template),id:`aa000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,type,periodLabel}));return {...checked,issue:publicIssueProjectionSchema.parse(issue)};}
test('directory disclosure distinguishes checked types counts periods conflicts and missing types without scoring',()=>{
 const html=render(populated()),body=disclosure(html);assert.ok(body,'recorded chain exists');assert.ok(body.includes('Observed condition: 2 recorded statements'));assert.ok(body.includes('Policy or action: 1 recorded statement'));assert.ok(body.includes('Delivery: 1 recorded statement'));
 assert.ok(body.includes('2023 · 2023 revised'));assert.ok(body.includes('2024–2025'));assert.ok(body.includes('Funding: No statement of this type in this publication'));assert.ok(body.includes('Evaluation: No statement of this type in this publication'));assert.ok(body.includes('does not establish absence of action or evidence elsewhere'));assert.ok(body.includes('not a progress score'));assert.ok(body.includes('Conflicting evidence accompanies'));assert.equal(links(body).length,3);
 const emptyTypes=links(body).map(x=>x.url.searchParams.get('type'));assert.deepEqual(emptyTypes,['condition','policy_action','delivery']);
});
test('each positive directory stage enters exact typed search keeping independent directory context and original controls',()=>{
 const html=render(populated()),body=disclosure(html);assert.ok(body);for(const row of links(body)){
  assert.equal(row.url.pathname,'/reader-preview/norway/housing-costs/search');assert.equal(row.url.hash,'');assert.equal(row.url.searchParams.get('edition'),rows.publication.id);assert.ok(!row.url.searchParams.has('q'));
  const selection=currentIssueSelection('search',params(row.url));assert.ok(selection);assert.equal(selection.query,'');assert.equal(selection.statementType,row.url.searchParams.get('type'));assert.deepEqual(params(new URL(currentIssueDirectoryHref(checked.issue,selection),'https://example.invalid')),initial);
 }
 for(const label of ['Read the dossier','Inspect source references','Search this dossier'])assert.ok(links(html).find(row=>row.text===label));
});
test('actual directory stage to typed statements and selected-directory return uses finite current reads and withholds after rights change',async()=>{
 const calls=[];let candidate=rows;const read=createPublicIssueReader(async(route,signal)=>{calls.push({route:structuredClone(route),signal});return bytes(candidate);},()=>0,()=>assert.fail('diagnostic'));
 const intercept=name=>name==='next/navigation'?{notFound(){assert.fail('production');},unstable_rethrow(){}}:name.includes('server/current-visitor-catalog')?{loadCurrentVisitorCatalogue:(query)=>loadCurrentVisitorCatalogue(query,read)}:name.includes('server/public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:read}:undefined;
 const catalogue=loadTsx(new URL('../app/reader-preview/catalogue/page.tsx',import.meta.url),intercept).default;
 const page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),intercept).default;
 const first=renderToStaticMarkup(await catalogue({searchParams:Promise.resolve(initial)})),entry=links(disclosure(first)).find(row=>row.url.searchParams.get('type')==='condition');assert.ok(entry);
 const selected=renderToStaticMarkup(await page({params:Promise.resolve({country:'norway',issue:'housing-costs',view:'search'}),searchParams:Promise.resolve(params(entry.url))}));assert.ok(selected.includes(checked.issue.claims[0].assertion));assert.ok(selected.includes('1 statement matches'));const back=links(selected).find(row=>row.text==='Back to selected directory results');assert.ok(back);assert.deepEqual(params(back.url),initial);
 assert.ok(disclosure(renderToStaticMarkup(await catalogue({searchParams:Promise.resolve(params(back.url))}))));candidate=structuredClone(rows);candidate.sources[0].registration.allow_public_derived=false;
 const held=renderToStaticMarkup(await catalogue({searchParams:Promise.resolve(initial)}));assert.equal(disclosure(held),'');assert.ok(!held.includes(checked.issue.claims[0].periodLabel));assert.ok(!held.includes('Follow the recorded information chain'));assert.equal(calls.length,4);for(const c of calls){assert.deepEqual(c.route,rows.requestedRoute);assert.ok(c.signal.aborted);}
});
test('country-only no-match absent unavailable and replaced directory states reveal no chain counts or links',()=>{
 assert.equal(disclosure(render(checked,{...initial,view:'countries',q:'Norway'})),'');assert.equal(disclosure(render(checked,{...initial,q:'missing'})),'');
 for(const decision of [{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'},{...checked,issue:{...checked.issue,publicationId:'aa000000-0000-4000-8000-000000000099'}}])assert.equal(disclosure(render(decision)),'');
});
