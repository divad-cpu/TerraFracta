import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { syntheticReadRows } from '../app/evidence-preview/example.ts';
import { parsePublicIssueProjection } from '../src/public-issue-projection.ts';
import { statementLabels,evidenceLabels } from '../src/issue-display-labels.ts';
import { currentIssueSelection } from '../src/current-issue-navigation.ts';
import { currentReadingGuideReturn } from '../src/current-reading-guide.ts';
import * as glossary from '../src/evidence-glossary.ts';
const issue=parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const dossier={...issue,jurisdictionSlug:'norway',issueSlug:'housing-costs'};
const selection=currentIssueSelection('issue',{edition:issue.publicationId,returnView:'sources',returnQ:'cell A1',returnType:'condition',returnRelation:'supports',directoryView:'issues',directoryQ:'housing',directoryCountry:'norway',directoryTopic:'housing'});
const returnTo=currentReadingGuideReturn(dossier,selection),origin='https://example.invalid';
const Evidence=loadTsx(new URL('../app/issue-evidence.tsx',import.meta.url)).IssueEvidence;
const Guide=loadTsx(new URL('../app/methodology/glossary/page.tsx',import.meta.url)).default;
const View=loadTsx(new URL('../src/current-issue-navigation-view.tsx',import.meta.url)).CurrentIssueNavigationView;
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const query=href=>Object.fromEntries(new URL(href,origin).searchParams);
const render=(record=dossier,back=returnTo)=>renderToStaticMarkup(Evidence({issue:record,readingGuideReturn:back}));

test('every authored definition factory target exists in the actual unfiltered guide and retains exact checked edition return',async()=>{
 const html=renderToStaticMarkup(await Guide({searchParams:Promise.resolve({returnTo})})),ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 for(const term of glossary.glossaryTerms){const href=glossary.glossaryDefinitionHref(term.slug,returnTo),url=new URL(href,origin);assert.equal(url.pathname,'/methodology/glossary');assert.deepEqual(query(href),{returnTo});assert.equal(url.hash,`#${term.slug}`);assert.ok(ids.has(term.slug));assert.equal(links(html).find(row=>row.text==='Back to the selected dossier')?.href,returnTo)}
});

test('statement type evidence relation and date shortcuts point to their exact existing definitions including absent statement stages',async()=>{
 const html=render(),all=links(html),statements={condition:'condition',policy_action:'policy-action',funding:'funding',delivery:'delivery',attributed_finding:'attributed-finding',evaluation:'evaluation'},relations={supports:'supports',contradicts:'conflict',context:'context'};
 for(const [type,slug]of Object.entries(statements)){const row=all.find(row=>row.text===`Definition: ${statementLabels[type]}`);assert.ok(row,type);assert.equal(new URL(row.href,origin).hash,`#${slug}`);assert.deepEqual(query(row.href),{returnTo})}
 const record=structuredClone(dossier);record.claims[0].evidence=Object.entries(relations).map(([relation],index)=>({...record.claims[0].evidence[0],relation,locator:`invented cell ${index+1}`}));const references=links(render(record));
 for(const [relation,slug]of Object.entries(relations)){const row=references.find(row=>row.text===`Definition: ${evidenceLabels[relation]}`);assert.ok(row);assert.equal(new URL(row.href,origin).hash,`#${slug}`);assert.deepEqual(query(row.href),{returnTo})}
 for(const [slug,label]of [['data-period','Data period'],['source-published','Source publication date'],['retrieved','Retrieved'],['evidence-review','Last evidence review']]){const row=all.find(row=>row.text===label);assert.ok(row,label);assert.equal(new URL(row.href,origin).hash,`#${slug}`);assert.deepEqual(query(row.href),{returnTo})}
 assert.match(html,/No statement of this type in this publication/);assert.match(html,/These are recorded statement types, not a progress score/);assert.match(html,/does not establish absence of action or evidence elsewhere/)
});

test('unknown definition inputs cannot create raw fragments or coerce caller objects while safe return stays independent',()=>{
 let observed=0;const object={toString(){observed++;throw Error('PRIVATE')}};
 for(const slug of [undefined,null,0,[],object,'__proto__','constructor','../private','condition#PRIVATE','PRIVATE','']){const href=glossary.glossaryDefinitionHref(slug,returnTo);assert.equal(new URL(href,origin).hash,'');assert.deepEqual(query(href),{returnTo});assert.doesNotMatch(href,/PRIVATE/)}
 assert.equal(observed,0)
});

test('malformed return drops to generic definition without reflecting untrusted routes or changing ordinary illustrative links',async()=>{
 for(const bad of ['/editorial-preview/PRIVATE','https://external.invalid/PRIVATE',returnTo+'#',returnTo+'&provider=PRIVATE',[],null]){const href=glossary.glossaryDefinitionHref('funding',bad);assert.equal(href,'/methodology/glossary#funding');const html=render(dossier,bad);assert.doesNotMatch(html,/PRIVATE|external.invalid|returnTo=/);assert.ok(links(html).some(row=>row.href===href))}
 const ordinary=renderToStaticMarkup(Evidence({issue}));assert.ok(links(ordinary).some(row=>row.href==='/methodology/glossary#funding'));assert.doesNotMatch(ordinary,/returnTo=/);const guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve({})}));assert.doesNotMatch(guide,/Back to the selected dossier/)
});

test('current dossier shortcut guide definition and explicit return retain source search and directory context',async()=>{
 const html=renderToStaticMarkup(View({decision:{status:200,cacheControl:'no-store',issue:dossier},selection,latestHref:'/reader-preview/norway/housing-costs/issue'})),row=links(html).find(row=>row.text==='Definition: Observed condition');assert.ok(row);const url=new URL(row.href,origin);assert.equal(url.hash,'#condition');const guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve(query(row.href))})),back=links(guide).find(row=>row.text==='Back to the selected dossier');assert.ok(back);assert.equal(back.href,returnTo);assert.deepEqual(query(back.href),query(returnTo));assert.match(guide,/id="condition"/);assert.match(guide,/Returning checks the current publication again/)
});
