import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit, id, scope, bytes } from './helpers/operator_audit_fixture.mjs';
import { operatorAuditReportSchema } from '../src/operator-audit-report.ts';
import { auditBrowseSelection } from '../src/operator-audit-navigation.ts';
import { createOperatorAuditReader } from '../src/server/operator-audit-reader.ts';

const View=loadTsx(new URL('../src/operator-audit-view.tsx',import.meta.url)).OperatorAuditView;
const render=props=>renderToStaticMarkup(View(props));
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
function summary(html,label) {
 const found=[...html.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/g)].find(m=>attrs(m[1])['aria-label']===label);
 assert.ok(found,`Missing ${label}`);return found[2];
}
const links=s=>[...s.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const returning=()=>({runId:id(1),cursor:{createdAt:'2026-10-05T09:30:00.000001Z',runId:id(99)}});
function sample(cursor=null) {
 const r=audit();r.requested.cursor=cursor;
 r.sources=['captured','captured','unchanged','deferred','deferred','deferred','not_recorded'].map((outcome,i)=>({
  ...r.sources[0],registrationId:id(30+i),sourceKey:`fictional:summary-${i}`,outcome,
  checkedAt:outcome==='not_recorded'?null:'2026-10-05T09:00:30Z',sourceVersionId:outcome==='captured'||outcome==='unchanged'?id(50+i):null,
 }));
 r.history={issueId:id(2),latestRevision:12,headPublicationId:id(112),headRevision:12,publications:[
  {publicationId:id(112),revision:12,supersedesPublicationId:id(111),publicationKind:'suppression',createdAt:'2026-10-05T09:03:00Z',isHead:true},
  {publicationId:id(111),revision:11,supersedesPublicationId:id(109),publicationKind:'accepted',createdAt:'2026-10-05T09:03:00Z',isHead:false},
  {publicationId:id(109),revision:9,supersedesPublicationId:id(107),publicationKind:'correction',createdAt:'2026-10-05T09:03:00Z',isHead:false},
  {publicationId:id(107),revision:7,supersedesPublicationId:id(106),publicationKind:'accepted',createdAt:'2026-10-05T09:03:00Z',isHead:false},
  {publicationId:id(106),revision:6,supersedesPublicationId:null,publicationKind:'draft',createdAt:'2026-10-05T09:03:00Z',isHead:false},
 ],nextCursor:null};
 if(cursor){r.history.publications=r.history.publications.filter(x=>x.revision<cursor.beforeRevision);}
 return operatorAuditReportSchema.parse(r);
}

test('recorded summaries expose exact unfiltered row distributions while independent filters stay active',()=>{
 const r=sample(),html=render({decision:{kind:'ok',report:r},outcome:'deferred',publicationKind:'accepted'});
 const sources=summary(html,'Recorded source outcome totals'),history=summary(html,'Stored publication kind totals');
 for(const text of ['Captured: 2','Unchanged: 1','Failed: 0','Deferred: 3','No check recorded: 1'])assert.ok(sources.includes(text),text);
 for(const text of ['Draft: 1','Accepted: 2','Correction: 1','Suppression: 1'])assert.ok(history.includes(text),text);
 assert.match(html,/Showing 3 of 7 source registrations/);assert.match(html,/Showing 2 of 5 stored revisions/);
 assert.ok(links(sources).find(x=>x.text==='Deferred: 3')['aria-current']);
 assert.ok(links(history).find(x=>x.text==='Accepted: 2')['aria-current']);
 assert.equal(links(sources).some(x=>x.text==='Failed: 0'),false);
 assert.match(html,/Counts describe only source rows returned for this audit/);
 assert.match(html,/Counts describe only revisions on this checked page/);
});

test('count links preserve exact older-page scope other filter and independent run return',()=>{
 const cursor={latestRevision:12,headPublicationId:id(112),beforeRevision:12},r=sample(cursor);
 const html=render({decision:{kind:'ok',report:r},runReturn:returning(),outcome:'deferred',publicationKind:'accepted'});
 for(const [label,text,key,value,other,otherValue,fragment] of [
  ['Recorded source outcome totals','Captured: 2','outcome','captured','publicationKind','accepted','#audit-sources-heading'],
  ['Stored publication kind totals','Correction: 1','publicationKind','correction','outcome','deferred','#audit-history-heading'],
 ]){
  const link=links(summary(html,label)).find(x=>x.text===text);assert.ok(link);const url=new URL(link.href,'https://example.invalid');
  assert.equal(url.pathname,'/editorial-preview/audit');assert.equal(url.hash,fragment);
  const q=Object.fromEntries(url.searchParams);assert.deepEqual(q,{runId:id(1),issueId:id(2),latestRevision:'12',headPublicationId:id(112),beforeRevision:'12',returnToRuns:'1',returnBeforeCreatedAt:returning().cursor.createdAt,returnBeforeRunId:id(99),[key]:value,[other]:otherValue});
  const selected=auditBrowseSelection(q);assert.ok(selected);assert.deepEqual(selected.scope,r.requested);assert.deepEqual(selected.runReturn,returning());
 }
 assert.match(html,/Suppression: 0/);assert.match(html,/stored head is outside this page/);
});

test('newest-page summary links add no history or return cursor and retain a nullable existing head',()=>{
 const r=sample();r.history.headPublicationId=null;r.history.headRevision=null;r.history.publications.forEach(x=>x.isHead=false);
 const html=render({decision:{kind:'ok',report:r}});
 for(const label of ['Recorded source outcome totals','Stored publication kind totals'])for(const row of links(summary(html,label))){
  const url=new URL(row.href,'https://example.invalid'),q=Object.fromEntries(url.searchParams),selected=auditBrowseSelection(q);
  assert.ok(selected);assert.deepEqual(selected.scope,scope());assert.equal(selected.runReturn,null);
  assert.equal(Object.hasOwn(q,'latestRevision'),false);assert.equal(Object.hasOwn(q,'returnToRuns'),false);
 }
});

test('empty unknown source and revision pages show scoped zero counts without inspect links or absence claims',()=>{
 const r=sample();r.expectedSourcesKnown=false;r.sources=[];r.history={issueId:id(2),latestRevision:0,headPublicationId:null,headRevision:null,publications:[],nextCursor:null};
 const html=render({decision:{kind:'ok',report:r},outcome:'failed',publicationKind:'suppression'});
 const sources=summary(html,'Recorded source outcome totals'),history=summary(html,'Stored publication kind totals');
 assert.equal(links(sources).length,0);assert.equal(links(history).length,0);
 assert.match(sources,/Failed: 0/);assert.match(history,/Suppression: 0/);
 assert.match(html,/expected source set is unknown/);assert.match(html,/complete coverage cannot be inferred/);
 assert.match(html,/not establish overall source coverage or current source health/);
 assert.match(html,/Other pages may contain more records/);
});

test('held malformed and mismatched reports never expose outcome or revision count summaries',()=>{
 for(const kind of ['invalid_scope','unconfigured','unavailable','not_found','changed']){
  const html=render({decision:{kind,report:sample()}});assert.doesNotMatch(html,/Recorded source outcome totals|Stored publication kind totals|fictional:summary-/);
 }
 for(const alter of [r=>r.privateNote='invented_private_canary',r=>r.sources[0].sourceUrl='https://invented-private.invalid']){
  const r=sample();alter(r);const html=render({decision:{kind:'ok',report:r}});
  assert.doesNotMatch(html,/Recorded source outcome totals|Stored publication kind totals|invented_private_canary|invented-private/);
 }
 const html=render({decision:{kind:'ok',report:sample()},selection:{...scope(),issueId:id(999)}});
 assert.doesNotMatch(html,/Recorded source outcome totals|Stored publication kind totals|fictional:summary-/);
});

test('following a count link makes a fresh byte-backed read and withholds changed records',async()=>{
 const initial=sample({latestRevision:12,headPublicationId:id(112),beforeRevision:12}).requested;
 let calls=0;const seen=[];
 const read=createOperatorAuditReader(async(s,signal)=>{calls++;seen.push({scope:s,frozen:Object.isFrozen(s),signal});return bytes(calls===1?sample(initial.cursor):{schemaVersion:1,status:'changed',requested:s});},()=>0,()=>assert.fail('unexpected diagnostic'));
 const first=render({decision:await read(initial)});const link=links(summary(first,'Recorded source outcome totals')).find(x=>x.text==='Deferred: 3');assert.ok(link);
 const selected=auditBrowseSelection(Object.fromEntries(new URL(link.href,'https://example.invalid').searchParams));assert.ok(selected);
 const second=render({decision:await read(selected.scope),selection:selected.scope,outcome:selected.outcome,publicationKind:selected.publicationKind});
 assert.equal(calls,2);assert.ok(seen.every(x=>x.frozen&&x.signal.aborted));assert.deepEqual(seen.map(x=>x.scope),[initial,initial]);
 assert.match(second,/Publication ledger changed/);assert.doesNotMatch(second,/Recorded source outcome totals|Stored publication kind totals|fictional:summary-/);
});
