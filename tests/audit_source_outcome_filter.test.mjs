import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit, id, scope } from './helpers/operator_audit_fixture.mjs';
import { operatorAuditReportSchema } from '../src/operator-audit-report.ts';
import * as nav from '../src/operator-audit-navigation.ts';
const outcomes = ['captured','unchanged','failed','deferred','not_recorded'];
const returnQuery = () => ({returnToRuns:'1',returnBeforeCreatedAt:'2026-10-05T09:30:00.000001Z',returnBeforeRunId:id(99)});
const returning = () => ({runId:id(1),cursor:{createdAt:returnQuery().returnBeforeCreatedAt,runId:id(99)}});
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),label:m[2]}));
const href = (html,label) => new URL(links(html).find(row=>row.label===label)?.href ?? assert.fail(`Missing ${label}`),'https://example.invalid');
const queryOf = url => Object.fromEntries(url.searchParams);
const Audit = loadTsx(new URL('../src/operator-audit-view.tsx',import.meta.url)).OperatorAuditView;
const render = props => renderToStaticMarkup(Audit(props));
function report(selected=scope(),known=true) {
 const r=audit();r.requested=structuredClone(selected);r.expectedSourcesKnown=known;
 r.sources=(known?outcomes:outcomes.slice(0,4)).map((outcome,i)=>({...r.sources[0],registrationId:id(30+i),sourceKey:`invented:${i}`,outcome,checkedAt:outcome==='not_recorded'?null:'2026-10-05T09:00:30Z',sourceVersionId:['captured','unchanged'].includes(outcome)?id(40+i):null}));
 if(selected.cursor) {r.history.latestRevision=selected.cursor.latestRevision;r.history.headPublicationId=selected.cursor.headPublicationId;r.history.headRevision=selected.cursor.headPublicationId===null?null:22;r.history.publications=r.history.publications.filter(row=>row.revision<selected.cursor.beforeRevision).map(row=>({...row,isHead:false}));}
 return operatorAuditReportSchema.parse(r);
}
function history() {
 const r=report();r.history.latestRevision=22;r.history.headRevision=22;r.history.headPublicationId=id(122);
 r.history.publications=Array.from({length:20},(_,i)=>({publicationId:id(122-i),revision:22-i,supersedesPublicationId:id(121-i),publicationKind:'correction',createdAt:'2026-10-05T09:03:00Z',isHead:i===0}));
 r.history.nextCursor={latestRevision:22,headPublicationId:id(122),beforeRevision:3};return operatorAuditReportSchema.parse(r);
}
function harness(read=async selected=>({kind:'ok',report:report(selected)}),mode='development') {
 const calls=[],marker=Error('NOT_FOUND');
 const Page=loadTsx(new URL('../app/editorial-preview/audit/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){throw marker;}}:name.endsWith('/server/operator-audit-reader.ts')?{readOperatorAudit:async selected=>{calls.push(structuredClone(selected));return read(selected);}}:undefined,{env:{NODE_ENV:mode}}).default;
 return {calls,marker,Page,render:async query=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}))};
}

test('each existing recorded outcome filters only the checked source rows without changing history',()=>{
 const r=report();for(const outcome of outcomes){const html=render({decision:{kind:'ok',report:r},selection:scope(),outcome});
 assert.match(html,/Showing 1 of 5 source registrations/);const list=html.match(/<ul\b[^>]*aria-label="Recorded source registrations and checks"[^>]*>[\s\S]*?<\/ul>/)[0];
 for(let i=0;i<5;i++)assert.equal(list.includes(`invented:${i}`),outcomes[i]===outcome);
 assert.match(html,/Revision 2/);assert.match(html,/Revision 1/);assert.match(html,/expected source set is known/);assert.match(html,/Neither is a current source health assessment/);
 }
 assert.deepEqual(nav.auditSourceOutcomes,outcomes);
});

test('actual filter GET form and clear link preserve exact current history and incoming run return',async()=>{
 const selected={...scope(),cursor:{latestRevision:22,headPublicationId:id(122),beforeRevision:3}},h=harness();
 const query={runId:id(1),issueId:id(2),latestRevision:'22',headPublicationId:id(122),beforeRevision:'3',...returnQuery(),outcome:'failed'};
 const html=await h.render(query);assert.deepEqual(h.calls,[selected]);assert.match(html,/Showing 1 of 5/);
 const form=[...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(m=>m[0]).find(s=>s.includes('aria-label="Filter recorded source outcomes"'));
 assert.ok(form);assert.equal(attrs(form.slice(0,form.indexOf('>')+1)).method,'get');
 const fields=Object.fromEntries([...form.matchAll(/<input\b[^>]*>/g)].map(m=>{const a=attrs(m[0]);return[a.name,a.value]}));const {outcome,...context}=query;assert.deepEqual(fields,context);assert.deepEqual(queryOf(href(html,'Clear source outcome filter')),context);assert.match(form,/<option value="failed" selected="">Failed<\/option>/);await h.render({...fields,outcome:'unchanged'});assert.deepEqual(h.calls,[selected,selected]);
});

test('older publication and fresh audit links retain outcome separately from both cursors',async()=>{
 const h=harness(async selected=>({kind:'ok',report:selected.cursor?report(selected):history()}));
 const first=await h.render({runId:id(1),issueId:id(2),...returnQuery(),outcome:'deferred'}),older=queryOf(href(first,'Older stored revisions'));
 assert.deepEqual(older,{runId:id(1),issueId:id(2),latestRevision:'22',headPublicationId:id(122),beforeRevision:'3',...returnQuery(),outcome:'deferred'});
 const second=await h.render(older),fresh=queryOf(href(second,'Start a fresh audit'));assert.deepEqual(fresh,{runId:id(1),issueId:id(2),...returnQuery(),outcome:'deferred'});
 assert.deepEqual(queryOf(href(second,'Back to selected recorded-run page')),{runId:id(1),beforeCreatedAt:returnQuery().returnBeforeCreatedAt,beforeRunId:id(99)});
 await h.render(fresh);assert.deepEqual(h.calls,[scope(),{...scope(),cursor:{latestRevision:22,headPublicationId:id(122),beforeRevision:3}},scope()]);
});

test('zero filtered results and unknown or empty source sets cannot imply coverage or health',()=>{
 const unknown=report(scope(),false),html=render({decision:{kind:'ok',report:unknown},selection:scope(),outcome:'not_recorded'});
 assert.match(html,/Showing 0 of 4/);assert.match(html,/expected source set is unknown/);assert.match(html,/No matching historical check outcome/);assert.match(html,/absence of failed checks elsewhere or current source health/);
 const empty=structuredClone(unknown);empty.sources=[];const emptyHtml=render({decision:{kind:'ok',report:empty},selection:scope(),outcome:'failed'});
 assert.match(emptyHtml,/Showing 0 of 0/);assert.match(emptyHtml,/No source checks returned/);assert.doesNotMatch(emptyHtml,/No matching historical check outcome/);
});

test('malformed own filters and unknown selectors refuse actual private read',async()=>{
 for(const outcome of ['healthy','FAILED',' failed ',['failed'],null,0,undefined]){const h=harness();const html=await h.render({runId:id(1),issueId:id(2),outcome});assert.deepEqual(h.calls,[]);assert.match(html,/Choose a recorded run and issue/);assert.doesNotMatch(html,/invented:/);}
 const h=harness();await h.render({runId:id(1),issueId:id(2),outcome:'failed',provider:'invented'});assert.deepEqual(h.calls,[]);
});

test('own outcome is captured once and inherited or hidden optional filters stay absent',()=>{
 let n=0;const query={runId:id(1),issueId:id(2),get outcome(){n++;return n===1?'failed':'captured';}};
 const selected=nav.auditBrowseSelection(query);assert.ok(selected);assert.equal(selected.outcome,'failed');assert.equal(n,1);assert.deepEqual(selected.scope,scope());
 const inherited=Object.assign(Object.create({outcome:'failed'}),{runId:id(1),issueId:id(2)});assert.equal(Object.hasOwn(nav.auditBrowseSelection(inherited),'outcome'),false);
 const hidden={runId:id(1),issueId:id(2)};Object.defineProperty(hidden,'outcome',{get(){assert.fail('hidden read')}});assert.equal(Object.hasOwn(nav.auditBrowseSelection(hidden),'outcome'),false);
});

test('unavailable recovery keeps validated filter while rejected direct filters observe no private fields',async()=>{
 for(const kind of ['unconfigured','unavailable','throws']){const h=harness(async()=>{if(kind==='throws')throw Error('PRIVATE');return{kind};});const html=await h.render({runId:id(1),issueId:id(2),...returnQuery(),outcome:'failed'});assert.deepEqual(queryOf(href(html,'Start a fresh audit')),{runId:id(1),issueId:id(2),...returnQuery(),outcome:'failed'});assert.doesNotMatch(html,/PRIVATE|invented:/);}
 let reads=0;const bad=()=>{reads++;throw Error('REJECTED')};const selection={get runId(){return bad()}},runReturn={get runId(){return bad()}},decision={get kind(){return bad()},get report(){return bad()}};
 const html=render({decision,selection,runReturn,outcome:'healthy'});assert.equal(reads,0);assert.match(html,/Choose a recorded run and issue/);assert.doesNotMatch(html,/REJECTED/);
});

test('ordinary missing or blank filter shows all while production refuses before parameter access',async()=>{
 for(const extra of [{},{outcome:''}]){const h=harness();const html=await h.render({runId:id(1),issueId:id(2),...extra});assert.deepEqual(h.calls,[scope()]);for(let i=0;i<5;i++)assert.match(html,new RegExp(`invented:${i}`));}
 for(const mode of ['production','test',undefined]){const h=harness(undefined,mode==='production'?'production':mode==='test'?'test':'');let reads=0;const props={get searchParams(){reads++;throw Error('SHOULD_NOT_READ')}};await assert.rejects(h.Page(props),e=>e===h.marker);assert.equal(reads,0);assert.deepEqual(h.calls,[]);}
});
