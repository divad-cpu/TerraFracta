import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { parsePublicIssueProjection } from '../src/public-issue-projection.ts';
import { syntheticReadRows } from '../app/evidence-preview/example.ts';
import { currentIssueSelection,currentIssueReturnHref,currentIssueDirectoryHref } from '../src/current-issue-navigation.ts';
import { findGlossaryTerms } from '../src/evidence-glossary.ts';
import * as nav from '../src/current-reading-guide.ts';
const issue=parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const route=`/reader-preview/${issue.jurisdictionSlug}/${issue.issueSlug}/issue`;
const plain=`${route}?edition=${issue.publicationId}`;
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const target=(html,label)=>links(html).find(row=>row.text===label)?.href??assert.fail(`Missing ${label}`);
const url=href=>new URL(href,'https://example.invalid');
const query=href=>Object.fromEntries(url(href).searchParams);
const Guide=loadTsx(new URL('../app/methodology/glossary/page.tsx',import.meta.url)).default;
const View=loadTsx(new URL('../src/current-issue-navigation-view.tsx',import.meta.url)).CurrentIssueNavigationView;
const Evidence=loadTsx(new URL('../app/issue-evidence.tsx',import.meta.url)).IssueEvidence;
const guide=async q=>renderToStaticMarkup(await Guide({searchParams:Promise.resolve(q)}));
const render=(selection,decision={status:200,cacheControl:'no-store',issue})=>renderToStaticMarkup(View({decision,selection,latestHref:route}));
const selectedQuery=()=>({edition:issue.publicationId,returnView:'sources',returnQ:'cell A1',returnType:'condition',returnRelation:'supports',directoryView:'issues',directoryQ:'housing',directoryCountry:'norway',directoryTopic:'housing'});
function reader(decision={status:200,cacheControl:'no-store',issue},mode='development',record=issue){
 const calls=[],marker=Error('NOT_FOUND');const Page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){throw marker}}:name.endsWith('/server/public-issue-reader')?{canonicalPublicIssueRoute:value=>({...value}),readPublicIssue:async value=>{calls.push(structuredClone(value));return decision}}:undefined,{env:{NODE_ENV:mode}}).default;
 return{calls,marker,Page,render:async href=>renderToStaticMarkup(await Page({params:Promise.resolve({country:record.jurisdictionSlug,issue:record.issueSlug,view:'issue'}),searchParams:Promise.resolve(query(href))}))};
}

test('current dossier reading-guide entry preserves same edition and selected source and directory context',async()=>{
 const dossier={...issue,jurisdictionSlug:'norway',issueSlug:'housing-costs'},selection=currentIssueSelection('issue',selectedQuery()),html=render(selection,{status:200,cacheControl:'no-store',issue:dossier}),href=target(html,'Look up statement, source and date terms in the reading guide'),q=query(href);assert.equal(url(href).pathname,'/methodology/glossary');assert.deepEqual(query(q.returnTo),selectedQuery());assert.equal(url(q.returnTo).pathname,'/reader-preview/norway/housing-costs/issue');
 const page=await guide(q);assert.equal(target(page,'Back to the selected dossier'),q.returnTo);assert.match(page,/Returning checks the current publication again/);assert.match(page,/changed or withheld edition supplies no earlier statements or references/);
 const read=reader({status:200,cacheControl:'no-store',issue:dossier},'development',dossier),back=await read.render(target(page,'Back to the selected dossier'));assert.deepEqual(read.calls,[{jurisdictionSlug:dossier.jurisdictionSlug,issueSlug:dossier.issueSlug}]);assert.equal(target(back,'Back to selected results'),currentIssueReturnHref(dossier,selection));assert.equal(target(back,'Back to selected directory results'),currentIssueDirectoryHref(dossier,selection));
});

test('guide search hidden return and empty or invalid search recovery retain only independently validated navigation',async()=>{
 const returnTo=nav.currentReadingGuideReturn(issue,currentIssueSelection('issue',selectedQuery()));
 for(const extra of [{q:'money',category:'statements'},{q:'unknowninventedterm'},{q:['PRIVATE_CANARY']},{category:'PRIVATE_CANARY'}]){const html=await guide({returnTo,...extra});assert.equal(target(html,'Back to the selected dossier'),returnTo);assert.doesNotMatch(html,/PRIVATE_CANARY/);
 const fields=Object.fromEntries([...html.matchAll(/<input\b[^>]*>/g)].map(m=>{const a=attrs(m[0]);return[a.name,a.value]}));assert.equal(fields.returnTo,returnTo);
 if(extra.q!=='money'){const recovery=links(html).find(row=>row.text.startsWith('Show all definitions'));assert.ok(recovery);assert.deepEqual(query(recovery.href),{returnTo})}
 const next=await guide({returnTo:fields.returnTo,q:'policy effect',category:'statements'});assert.match(next,/id="evaluation"/);assert.equal(target(next,'Back to the selected dossier'),returnTo)}
});

test('search or sources inspection serializes through existing return rules and ordinary guide remains generic',async()=>{
 for(const view of ['search','sources']){const selection=currentIssueSelection(view,{edition:issue.publicationId,q:'cell A1',type:'condition',...(view==='sources'?{relation:'context'}:{})}),back=nav.currentReadingGuideReturn(issue,selection);assert.ok(back);assert.equal(query(back).returnView,view);assert.equal(query(back).returnQ,'cell A1');assert.equal(query(back).returnType,'condition');assert.equal(Object.hasOwn(query(back),'returnRelation'),view==='sources')}
 const generic=renderToStaticMarkup(Evidence({issue}));assert.equal(target(generic,'Look up statement, source and date terms in the reading guide'),'/methodology/glossary');const page=await guide({});assert.doesNotMatch(page,/Back to the selected dossier|name="returnTo"/);assert.match(page,/22 terms match/);
});

test('closed bounded return refuses external private malformed duplicate fragment and unrelated targets',async()=>{
 const bad=['https://external.invalid/reader-preview/norway/housing-costs/issue?edition='+issue.publicationId,'//external.invalid/reader-preview/norway/housing-costs/issue?edition='+issue.publicationId,'/editorial-preview/audit?runId='+issue.publicationId,'/api/dev/public-issue/norway/housing-costs',route,plain+'&edition='+issue.publicationId,plain+'&provider=PRIVATE_CANARY',plain+'#claim-private',plain+'&returnView=issue',plain+'&returnView=search&returnRelation=supports',plain+'&returnTo='+encodeURIComponent(plain),plain.replace('/issue?','/sources?'),plain.replace(issue.jurisdictionSlug,'a'.repeat(81)),plain+' '+ 'x',plain+'\\private',plain+'\u0000',plain+'&returnQ='+('x'.repeat(2049))];
 for(const input of bad){assert.equal(nav.canonicalReadingGuideReturn(input),null,input);assert.equal(nav.readingGuideHref(input),'/methodology/glossary');const html=await guide({returnTo:input,q:'money'});assert.match(html,/Check your search/);assert.doesNotMatch(html,/Back to the selected dossier|PRIVATE_CANARY|id="funding"/)}
 for(const input of [null,[],{},0])assert.equal(nav.canonicalReadingGuideReturn(input),null);
});

test('return selector is captured once while hidden inherited and unknown-key fields cannot supply a return',async()=>{
 let reads=0;const fields={q:'money',get returnTo(){reads++;return reads===1?plain:'/editorial-preview'}};const html=await guide(fields);assert.equal(reads,1);assert.equal(target(html,'Back to the selected dossier'),plain);assert.match(html,/id="funding"/);
 for(const hidden of [false,true]){let observed=0;const inherited=Object.create({get returnTo(){observed++;throw Error('PRIVATE')}});inherited.q='money';if(hidden)Object.defineProperty(inherited,'returnTo',{get(){observed++;throw Error('PRIVATE')}});const all=await guide(inherited);assert.equal(observed,0);assert.doesNotMatch(all,/Back to the selected dossier|PRIVATE/)}
 const veto={extra:'PRIVATE',get returnTo(){assert.fail('unknown key observed')}};assert.equal(findGlossaryTerms(veto).kind,'invalid');
 const throwing={get returnTo(){throw Error('PRIVATE')}};const held=await guide(throwing);assert.match(held,/Check your search/);assert.doesNotMatch(held,/PRIVATE|Back to the selected dossier/);
});

test('changed absent or withheld current reads do not resurrect guide-returned statements or links',async()=>{
 const q=query(nav.readingGuideHref(plain)),guideHtml=await guide(q),back=target(guideHtml,'Back to the selected dossier'),newer={...issue,publicationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
 for(const decision of [{status:200,cacheControl:'no-store',issue:newer},{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'}]){const h=reader(decision),html=await h.render(back);assert.equal(h.calls.length,1);assert.doesNotMatch(html,new RegExp(issue.claims[0].assertion.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.doesNotMatch(html,/Look up statement, source and date terms|reference-[0-9a-f]/);assert.match(html,/newer publication|No eligible issue|temporarily unavailable/)}
 const h=reader(undefined,'production');let observed=0;await assert.rejects(h.Page({get params(){observed++;throw Error('PRIVATE')},get searchParams(){observed++;throw Error('PRIVATE')}}),e=>e===h.marker);assert.equal(observed,0);assert.deepEqual(h.calls,[]);
});

test('validated return survives malformed search field faults while malformed return cannot add a target',async()=>{
 const html=await guide({returnTo:plain,get q(){throw Error('PRIVATE_QUERY')}});assert.equal(target(html,'Back to the selected dossier'),plain);assert.match(html,/Check your search/);assert.doesNotMatch(html,/PRIVATE_QUERY|id="funding"/);
 for(const returnTo of [['PRIVATE'],null,0,'']){const result=findGlossaryTerms({returnTo,q:'money'});assert.equal(result.kind,'invalid');assert.equal(Object.hasOwn(result,'returnTo'),false)}
});


test('raw empty fragment is refused while encoded hash in an admitted search remains ordinary text',async()=>{
 for(const input of [plain+'#',plain+'##',plain+'#ignored']){
  assert.equal(nav.canonicalReadingGuideReturn(input),null);
  assert.equal(nav.readingGuideHref(input),'/methodology/glossary');
  const result=findGlossaryTerms({returnTo:input,q:'retrieved',category:'dates'});
  assert.equal(result.kind,'invalid');assert.equal(Object.hasOwn(result,'returnTo'),false);
  const html=await guide({returnTo:input,q:'retrieved',category:'dates'});
  assert.doesNotMatch(html,/Back to the selected dossier|name="returnTo"/);
 }
 const encoded=route+'?'+new URLSearchParams({edition:issue.publicationId,returnView:'search',returnQ:'cell #1'});
 assert.equal(nav.canonicalReadingGuideReturn(encoded),encoded);
 assert.equal(query(encoded).returnQ,'cell #1');
 const html=await guide({returnTo:encoded,q:'retrieved',category:'dates'});
 assert.equal(target(html,'Back to the selected dossier'),encoded);
});
