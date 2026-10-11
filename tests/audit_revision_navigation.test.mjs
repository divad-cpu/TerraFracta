import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit,id,scope } from './helpers/operator_audit_fixture.mjs';
import { operatorAuditReportSchema } from '../src/operator-audit-report.ts';
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const targets=html=>new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const anchor=n=>`recorded-publication-${id(n)}`;
const query=url=>Object.fromEntries(new URL(url,'https://example.invalid').searchParams);
const returning=()=>({runId:id(1),cursor:{createdAt:'2026-10-05T09:30:00.000001Z',runId:id(99)}});
const returnQuery=()=>({returnToRuns:'1',returnBeforeCreatedAt:returning().cursor.createdAt,returnBeforeRunId:id(99)});
const View=loadTsx(new URL('../src/operator-audit-view.tsx',import.meta.url)).OperatorAuditView;
const render=props=>renderToStaticMarkup(View(props));
function richer(selected=scope()){
 const r=audit();r.requested=structuredClone(selected);r.history.latestRevision=5;r.history.headPublicationId=id(15);r.history.headRevision=5;
 r.history.publications=[{publicationId:id(15),revision:5,supersedesPublicationId:id(13),publicationKind:'correction',createdAt:'2026-10-05T09:05:00Z',isHead:true},{publicationId:id(13),revision:3,supersedesPublicationId:id(11),publicationKind:'accepted',createdAt:'2026-10-05T09:03:00Z',isHead:false},{publicationId:id(11),revision:1,supersedesPublicationId:null,publicationKind:'draft',createdAt:'2026-10-05T09:01:00Z',isHead:false}];
 if(selected.cursor)r.history.publications=r.history.publications.filter(row=>row.revision<selected.cursor.beforeRevision);
 return operatorAuditReportSchema.parse(r);
}
function harness(read=async selected=>({kind:'ok',report:richer(selected)})){
 const calls=[];const Page=loadTsx(new URL('../app/editorial-preview/audit/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){throw Error('NOT_FOUND')}}:name.endsWith('/server/operator-audit-reader.ts')?{readOperatorAudit:async selected=>{calls.push(structuredClone(selected));return read(selected)}}:undefined,{env:{NODE_ENV:'development'}}).default;
 return{calls,render:async q=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(q)}))};
}

test('visible checked revisions own unique stable targets and exact head and parent fragment links',()=>{
 const r=richer(),html=render({decision:{kind:'ok',report:r},selection:scope()}),seen=targets(html),all=links(html);
 for(const n of [15,13,11]){assert.ok(seen.has(anchor(n)));assert.equal([...html.matchAll(new RegExp(`id="${anchor(n)}"`,'g'))].length,1)}
 assert.equal(all.find(row=>row['aria-label']==='Go to stored head revision 5')?.href,`#${anchor(15)}`);
 assert.equal(all.find(row=>row['aria-label']==='Go to the recorded parent of revision 5')?.href,`#${anchor(13)}`);
 assert.equal(all.find(row=>row['aria-label']==='Go to the recorded parent of revision 3')?.href,`#${anchor(11)}`);
 assert.equal(all.filter(row=>row.href===`#${anchor(11)}`).length,1);assert.match(html,/No parent recorded/);
 for(const row of all.filter(row=>row.href.startsWith('#')))assert.ok(seen.has(row.href.slice(1)),row.href);
 assert.match(html,/These issue revisions are not attributed to the selected run/);assert.match(html,/outside this page or excluded by the filter remains a reference without a navigation target/);
});

test('stored kind filtering leaves hidden parent UUID text without a dangling target or link',()=>{
 const r=richer(),html=render({decision:{kind:'ok',report:r},selection:scope(),publicationKind:'correction'}),all=links(html),seen=targets(html);
 assert.ok(seen.has(anchor(15)));assert.equal(seen.has(anchor(13)),false);assert.equal(seen.has(anchor(11)),false);assert.equal(all.some(row=>row.href===`#${anchor(13)}`),false);
 assert.match(html,new RegExp(`<dt>Supersedes record</dt><dd><code>${id(13)}</code>`));assert.equal(all.find(row=>row['aria-label']==='Go to stored head revision 5')?.href,`#${anchor(15)}`);
 const filtered=render({decision:{kind:'ok',report:r},selection:scope(),publicationKind:'accepted'});assert.match(filtered,/stored head is excluded/);assert.match(filtered,new RegExp(`Stored head:.*<code>${id(15)}</code>`));assert.equal(links(filtered).some(row=>row['aria-label']==='Go to stored head revision 5'),false);
});

test('older checked page never links an outside head or unknown parent and retains exact metadata',()=>{
 const selected={...scope(),cursor:{latestRevision:5,headPublicationId:id(15),beforeRevision:3}},r=richer(selected);r.history.publications[0].supersedesPublicationId=id(100);const html=render({decision:{kind:'ok',report:r},selection:selected});assert.match(html,/stored head is outside this page/);assert.match(html,new RegExp(`<dt>Supersedes record</dt><dd><code>${id(100)}</code>`));assert.equal(links(html).some(row=>row.href===`#${anchor(100)}`||row.href===`#${anchor(15)}`),false);assert.equal(targets(html).has(anchor(100)),false);assert.equal(targets(html).has(anchor(15)),false);
});

test('record permalink retains exact requested history and both filters plus independent run-page return',async()=>{
 const q={runId:id(1),issueId:id(2),latestRevision:'5',headPublicationId:id(15),beforeRevision:'4',...returnQuery(),outcome:'unchanged',publicationKind:'accepted'},h=harness(),html=await h.render(q),row=links(html).find(row=>row['aria-label']==='Open the checked selection at revision 3');assert.ok(row);assert.deepEqual(query(row.href),q);assert.equal(new URL(row.href,'https://example.invalid').hash,`#${anchor(13)}`);await h.render(query(row.href));assert.deepEqual(h.calls,[{...scope(),cursor:{latestRevision:5,headPublicationId:id(15),beforeRevision:4}},{...scope(),cursor:{latestRevision:5,headPublicationId:id(15),beforeRevision:4}}]);
 const changed=harness(async()=>({kind:'changed'})),held=await changed.render(query(row.href));assert.doesNotMatch(held,/recorded-publication-|Link to this recorded revision|Revision 3/);assert.match(held,/Publication ledger changed/);
});

test('empty or withheld malformed reports expose no revision targets or parent or permalink controls',()=>{
 const empty=richer();empty.history={issueId:id(2),latestRevision:0,headPublicationId:null,headRevision:null,publications:[],nextCursor:null};
 const bad=richer();bad.history.publications[0].supersedesPublicationId=bad.history.publications[0].publicationId;
 for(const decision of [{kind:'ok',report:empty},{kind:'ok',report:bad},{kind:'changed'},{kind:'unavailable'},{kind:'not_found'}]){const html=render({decision,selection:scope(),runReturn:returning()});assert.doesNotMatch(html,/recorded-publication-|Link to this recorded revision|Go to the recorded parent|Go to stored head/)}
});

test('normal short history retains original revision order parent and time metadata with no fabricated revisions',()=>{
 const r=audit(),html=render({decision:{kind:'ok',report:r},selection:scope()});assert.ok(html.indexOf('Revision 2 · Correction')<html.indexOf('Revision 1 · Accepted'));assert.equal(targets(html).has(anchor(6)),true);assert.equal(targets(html).has(anchor(5)),true);assert.match(html,/No parent recorded/);assert.match(html,/2026-10-05T09:03:00Z/);assert.match(html,/2026-10-05T09:02:00Z/);assert.match(html,/Showing 2 of 2 stored revisions/);assert.equal(links(html).filter(row=>row.text==='Link to this recorded revision').length,2);
});
