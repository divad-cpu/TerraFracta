import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit, id, scope } from './helpers/operator_audit_fixture.mjs';
import { operatorAuditReportSchema } from '../src/operator-audit-report.ts';
import * as nav from '../src/operator-audit-navigation.ts';
const kinds=['draft','accepted','correction','suppression'];
const rquery=()=>({returnToRuns:'1',returnBeforeCreatedAt:'2026-10-05T09:30:00.000001Z',returnBeforeRunId:id(99)});
const returning=()=>({runId:id(1),cursor:{createdAt:rquery().returnBeforeCreatedAt,runId:id(99)}});
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const link=(html,label)=>{const row=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(m=>m[2]===label);assert.ok(row,`Missing link ${label}`);return new URL(attrs(row[1]).href,'https://example.invalid')};
const query=url=>Object.fromEntries(url.searchParams);
const form=(html,label)=>{const f=[...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].find(m=>m[0].includes(`aria-label="${label}"`))?.[0];assert.ok(f,`Missing form ${label}`);assert.equal(attrs(f.slice(0,f.indexOf('>')+1)).method,'get');return{html:f,fields:Object.fromEntries([...f.matchAll(/<input\b[^>]*>/g)].map(m=>{const a=attrs(m[0]);return[a.name,a.value]}))}};
const Audit=loadTsx(new URL('../src/operator-audit-view.tsx',import.meta.url)).OperatorAuditView;
const render=props=>renderToStaticMarkup(Audit(props));
function report(selected=scope(),paged=false){
 const r=audit();r.requested=structuredClone(selected);r.history.latestRevision=selected.cursor?.latestRevision??(paged?24:8);r.history.headRevision=r.history.latestRevision;r.history.headPublicationId=id(100+r.history.latestRevision);
 const top=selected.cursor?selected.cursor.beforeRevision-1:r.history.latestRevision;
 const length=paged?20:Math.min(8,top);r.history.publications=Array.from({length},(_,i)=>{const revision=top-i;return{publicationId:id(100+revision),revision,supersedesPublicationId:revision===1?null:id(99+revision),publicationKind:kinds[i%4],createdAt:'2026-10-05T09:03:00Z',isHead:revision===r.history.headRevision}});
 r.history.nextCursor=paged?{latestRevision:r.history.latestRevision,headPublicationId:r.history.headPublicationId,beforeRevision:r.history.publications.at(-1).revision}:null;
 return operatorAuditReportSchema.parse(r);
}
function harness(read=async selected=>({kind:'ok',report:report(selected)}),mode='development'){
 const calls=[],marker=Error('NOT_FOUND');const Page=loadTsx(new URL('../app/editorial-preview/audit/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){throw marker}}:name.endsWith('/server/operator-audit-reader.ts')?{readOperatorAudit:async selected=>{calls.push(structuredClone(selected));return read(selected)}}:undefined,{env:{NODE_ENV:mode}}).default;
 return{calls,marker,Page,render:async fields=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(fields)}))};
}
const defaultQuery=()=>({runId:id(1),issueId:id(2),...rquery(),outcome:'unchanged',publicationKind:'suppression'});
const olderQuery=()=>({...defaultQuery(),latestRevision:'8',headPublicationId:id(108),beforeRevision:'5'});

test('all schema publication kinds select only ordered checked rows and leave source checks intact',()=>{
 assert.deepEqual(nav.auditPublicationKinds,kinds);
 const r=report();for(const publicationKind of kinds){const html=render({decision:{kind:'ok',report:r},selection:scope(),publicationKind,outcome:'unchanged'});
 assert.match(html,/Showing 2 of 8 stored revisions/);assert.match(html,/Showing 1 of 1 source registrations/);assert.match(html,/fictional:source/);
 const list=html.match(/<ol\b[^>]*aria-label="Stored publication revisions, newest first"[^>]*>[\s\S]*?<\/ol>/)?.[0];assert.ok(list);
 const shown=[...list.matchAll(/<h3>Revision (\d+) ·/g)].map(m=>Number(m[1]));assert.deepEqual(shown,r.history.publications.filter(row=>row.publicationKind===publicationKind).map(row=>row.revision));
 for(const row of r.history.publications)assert.equal(list.includes(`<dt>Publication reference</dt><dd><code>${row.publicationId}</code>`),row.publicationKind===publicationKind);
 assert.match(html,/not attributed to the selected run/);assert.match(html,/does not establish current public visibility or attribution to this run/);
 }
});

test('head excluded by filter differs from head outside the checked history page',()=>{
 const r=report(),hidden=render({decision:{kind:'ok',report:r},selection:scope(),publicationKind:'correction'});assert.match(hidden,/stored head is excluded by this publication kind filter/);assert.match(hidden,new RegExp(`Stored head:.*revision 8.*${id(108)}`));assert.doesNotMatch(hidden,/stored head is outside this page/);
 const shown=render({decision:{kind:'ok',report:r},selection:scope(),publicationKind:'draft'});assert.doesNotMatch(shown,/stored head is excluded/);
 const selected={...scope(),cursor:{latestRevision:8,headPublicationId:id(108),beforeRevision:5}},old=render({decision:{kind:'ok',report:report(selected)},selection:selected,publicationKind:'draft'});assert.match(old,/stored head is outside this page of revisions/);assert.doesNotMatch(old,/stored head is excluded by this/);
});

test('both native forms and both clear links keep the independent filter and exact requested cursors',async()=>{
 const q=olderQuery(),h=harness(),html=await h.render(q),expected={...scope(),cursor:{latestRevision:8,headPublicationId:id(108),beforeRevision:5}};assert.deepEqual(h.calls,[expected]);
 const kind=form(html,'Filter stored publication kinds'),source=form(html,'Filter recorded source outcomes');const{publicationKind,...withoutKind}=q,{outcome,...withoutOutcome}=q;
 assert.deepEqual(kind.fields,withoutKind);assert.deepEqual(source.fields,withoutOutcome);assert.match(kind.html,/<option value="suppression" selected="">Suppression<\/option>/);assert.deepEqual(query(link(html,'Clear publication kind filter')),withoutKind);assert.deepEqual(query(link(html,'Clear source outcome filter')),withoutOutcome);
 await h.render({...kind.fields,publicationKind:'accepted'});await h.render({...source.fields,outcome:'failed'});assert.deepEqual(h.calls,[expected,expected,expected]);
 assert.equal(Object.hasOwn(h.calls[0],'publicationKind'),false);assert.equal(Object.hasOwn(h.calls[0],'outcome'),false);
});

test('zero-match bounded page retains unfiltered continuation and both filters across new reads',async()=>{
 const h=harness(async selected=>{const r=report(selected,selected.cursor===null);r.history.publications=r.history.publications.map(row=>({...row,publicationKind:'accepted'}));return{kind:'ok',report:operatorAuditReportSchema.parse(r)}});
 const first=await h.render(defaultQuery());assert.match(first,/Showing 0 of 20 stored revisions/);assert.match(first,/No matching stored publication kind/);assert.match(first,/Older pages may contain matches/);
 const older=query(link(first,'Older stored revisions'));assert.deepEqual(older,{runId:id(1),issueId:id(2),latestRevision:'24',headPublicationId:id(124),beforeRevision:'5',...rquery(),outcome:'unchanged',publicationKind:'suppression'});
 // Return a report bound to the exact history anchor for the next inert read.
 const next=harness(async selected=>{const r=report(selected);r.history.latestRevision=24;r.history.headPublicationId=id(124);r.history.headRevision=24;return{kind:'ok',report:operatorAuditReportSchema.parse(r)}});
 const second=await next.render(older),fresh=query(link(second,'Start a fresh audit'));assert.deepEqual(fresh,defaultQuery());assert.deepEqual(query(link(second,'Back to selected recorded-run page')),{runId:id(1),beforeCreatedAt:rquery().returnBeforeCreatedAt,beforeRunId:id(99)});assert.deepEqual(next.calls,[{...scope(),cursor:{latestRevision:24,headPublicationId:id(124),beforeRevision:5}}]);
 await h.render(fresh);assert.deepEqual(h.calls,[scope(),scope()]);
});

test('empty checked history is distinct from nonempty zero matches and still makes no visibility claim',()=>{
 const r=report();r.history={issueId:id(2),latestRevision:0,headPublicationId:null,headRevision:null,publications:[],nextCursor:null};const html=render({decision:{kind:'ok',report:r},selection:scope(),publicationKind:'suppression'});assert.match(html,/Showing 0 of 0 stored revisions/);assert.match(html,/No publication records returned/);assert.doesNotMatch(html,/No matching stored publication kind|stored head is excluded|Older stored revisions/);assert.match(html,/No conclusion about public visibility follows/);
});

test('own publication kind is captured once while inherited or hidden options are not observed',async()=>{
 let reads=0;const q={runId:id(1),issueId:id(2),get publicationKind(){reads++;return reads===1?'correction':'suppression'}};const h=harness(),html=await h.render(q);assert.equal(reads,1);assert.deepEqual(h.calls,[scope()]);assert.match(html,/<option value="correction" selected="">/);
 for(const hidden of [false,true]){let observed=0;const inherited=Object.create({get publicationKind(){observed++;throw Error('PRIVATE')}});Object.assign(inherited,{runId:id(1),issueId:id(2)});if(hidden)Object.defineProperty(inherited,'publicationKind',{get(){observed++;throw Error('PRIVATE')}});const g=harness(),all=await g.render(inherited);assert.equal(observed,0);assert.deepEqual(g.calls,[scope()]);assert.match(all,/Showing 8 of 8 stored revisions/);assert.doesNotMatch(all,/PRIVATE/)}
});

test('malformed publication filters or unknown keys refuse without dispatch and direct rejection observes no private fields',async()=>{
 for(const publicationKind of ['published','SUPPRESSION',' suppression ',['suppression'],null,0,undefined]){const h=harness(),html=await h.render({runId:id(1),issueId:id(2),publicationKind});assert.deepEqual(h.calls,[]);assert.match(html,/Choose a recorded run and issue/);assert.doesNotMatch(html,/fictional:source|Revision 8/)}
 let reads=0;const q={runId:id(1),issueId:id(2),get publicationKind(){reads++;throw Error('PRIVATE')},extra:'unapproved'};const h=harness();await h.render(q);assert.equal(reads,0);assert.deepEqual(h.calls,[]);
 const denied=()=>{reads++;throw Error('PRIVATE')};const html=render({decision:{get kind(){return denied()},get report(){return denied()}},selection:{get runId(){return denied()}},runReturn:{get runId(){return denied()}},publicationKind:'published'});assert.equal(reads,0);assert.match(html,/Choose a recorded run and issue/);assert.doesNotMatch(html,/PRIVATE/);
});

test('withheld or throwing audits recover with checked filters and cursor-independent fresh scope',async()=>{
 for(const kind of ['unconfigured','unavailable','changed','throws','mismatch']){const h=harness(async selected=>{if(kind==='throws')throw Error('PRIVATE');if(kind==='mismatch'){const r=report(selected);r.requested.runId=id(9);return{kind:'ok',report:r}}return{kind}});const html=await h.render(olderQuery());assert.deepEqual(query(link(html,'Start a fresh audit')),defaultQuery());assert.doesNotMatch(html,/PRIVATE|fictional:source|Revision 4/);assert.deepEqual(h.calls,[{...scope(),cursor:{latestRevision:8,headPublicationId:id(108),beforeRevision:5}}])}
});

test('missing or blank kind keeps all historical records and omitted helper argument keeps legacy links',async()=>{
 for(const extra of [{},{publicationKind:''}]){const h=harness(),html=await h.render({runId:id(1),issueId:id(2),...extra});assert.deepEqual(h.calls,[scope()]);for(let revision=1;revision<=8;revision++)assert.match(html,new RegExp(`Revision ${revision} ·`));assert.match(html,/Showing 8 of 8 stored revisions/)}
 assert.deepEqual(query(new URL(nav.auditBrowseHref(scope(),returning(),'failed'),'https://example.invalid')),{runId:id(1),issueId:id(2),...rquery(),outcome:'failed'});
});

test('production and nondevelopment refusal remains before query observations',async()=>{
 for(const mode of ['production','test','']){const h=harness(undefined,mode);let reads=0;await assert.rejects(h.Page({get searchParams(){reads++;throw Error('PRIVATE')}}),e=>e===h.marker);assert.equal(reads,0);assert.deepEqual(h.calls,[])}
});
