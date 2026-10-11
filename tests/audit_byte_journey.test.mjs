import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit,id,scope,bytes } from './helpers/operator_audit_fixture.mjs';
import { createOperatorAuditReader } from '../src/server/operator-audit-reader.ts';
const origin='https://example.invalid';
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const target=(html,label)=>links(html).find(row=>row.text===label)?.href??assert.fail(`Missing ${label}`);
const query=href=>Object.fromEntries(new URL(href,origin).searchParams);
const returning=()=>({returnToRuns:'1',returnBeforeCreatedAt:'2026-10-05T09:30:00.000001Z',returnBeforeRunId:id(99)});
const selected=()=>({runId:id(1),issueId:id(2),...returning(),outcome:'unchanged',publicationKind:'accepted'});
const withheld=html=>assert.doesNotMatch(html,/fictional:source|recorded-publication-|Link to this recorded revision|Revision [0-9]+ ·|PRIVATE_CANARY/);
function envelope(s=scope(),paged=false){
 const r=audit();r.requested=structuredClone(s);
 if(paged){const latest=s.cursor?.latestRevision??24,top=s.cursor?s.cursor.beforeRevision-1:latest;r.history={issueId:s.issueId,latestRevision:latest,headPublicationId:id(100+latest),headRevision:latest,publications:Array.from({length:Math.min(20,top)},(_,i)=>{const revision=top-i;return{publicationId:id(100+revision),revision,supersedesPublicationId:revision===1?null:id(99+revision),publicationKind:revision===3?'correction':'accepted',createdAt:'2026-10-05T09:03:00Z',isHead:revision===latest}}),nextCursor:top>20?{latestRevision:latest,headPublicationId:id(100+latest),beforeRevision:top-19}:null}}
 return r;
}
function harness(produce){
 const calls=[],decisions=[],diagnostics=[];
 const provider=produce===undefined?undefined:async(s,signal)=>{calls.push({scope:structuredClone(s),frozen:Object.isFrozen(s),cursorFrozen:s.cursor===null||Object.isFrozen(s.cursor),signal});const value=await produce(s,calls.length);return value instanceof Uint8Array?value:bytes(value)};
 const read=createOperatorAuditReader(provider,()=>0,kind=>diagnostics.push(kind));
 const Page=loadTsx(new URL('../app/editorial-preview/audit/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('Unexpected development refusal')}}:name.endsWith('/server/operator-audit-reader.ts')?{readOperatorAudit:async s=>{const d=await read(s);decisions.push(d.kind);return d}}:undefined,{env:{NODE_ENV:'development'}}).default;
 return{calls,decisions,diagnostics,render:async q=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(q)}))};
}

test('native audit reader composes with kind filtering exact revision permalink and independent run-page return',async()=>{
 const h=harness(s=>envelope(s)),q=selected(),first=await h.render(q);assert.match(first,/Showing 1 of 2 stored revisions/);assert.doesNotMatch(first,/id="recorded-publication-00000000-0000-4000-8000-000000000006"/);
 const permalink=links(first).find(row=>row['aria-label']==='Open the checked selection at revision 1');assert.ok(permalink);assert.deepEqual(query(permalink.href),q);assert.equal(new URL(permalink.href,origin).hash,`#recorded-publication-${id(5)}`);
 const second=await h.render(query(permalink.href));assert.match(second,new RegExp(`id="recorded-publication-${id(5)}"`));assert.deepEqual(h.calls.map(row=>row.scope),[scope(),scope()]);assert.ok(h.calls.every(row=>row.frozen&&row.cursorFrozen&&row.signal.aborted));assert.deepEqual(h.decisions,['ok','ok']);assert.deepEqual(h.diagnostics,[]);
 assert.deepEqual(query(target(second,'Back to selected recorded-run page')),{runId:id(1),beforeCreatedAt:returning().returnBeforeCreatedAt,beforeRunId:id(99)});assert.match(second,/do not establish current source health/)
});

test('zero filtered first page continues actual unfiltered cursor then resolves an older checked revision and changed recovery',async()=>{
 const h=harness((s,n)=>n===4?{schemaVersion:1,status:'changed',requested:structuredClone(s)}:envelope(s,true)),q={...selected(),publicationKind:'correction'},first=await h.render(q);assert.match(first,/Showing 0 of 20 stored revisions/);assert.match(first,/Older pages may contain matches/);
 const older=query(target(first,'Older stored revisions')),expected={...scope(),cursor:{latestRevision:24,headPublicationId:id(124),beforeRevision:5}};assert.deepEqual(older,{...q,latestRevision:'24',headPublicationId:id(124),beforeRevision:'5'});
 const second=await h.render(older);assert.match(second,/Showing 1 of 4 stored revisions/);const permalink=links(second).find(row=>row['aria-label']==='Open the checked selection at revision 3');assert.ok(permalink);assert.deepEqual(query(permalink.href),older);
 const third=await h.render(query(permalink.href));assert.match(third,new RegExp(`id="recorded-publication-${id(103)}"`));const held=await h.render(query(permalink.href));withheld(held);assert.match(held,/Publication ledger changed/);assert.deepEqual(query(target(held,'Start a fresh audit')),q);assert.deepEqual(query(target(held,'Back to selected recorded-run page')),{runId:id(1),beforeCreatedAt:returning().returnBeforeCreatedAt,beforeRunId:id(99)});assert.deepEqual(h.calls.map(row=>row.scope),[scope(),expected,expected,expected]);assert.deepEqual(h.decisions,['ok','ok','ok','changed']);assert.deepEqual(h.diagnostics,[])
});

test('new native byte fault after a valid audit permalink removes earlier rows and preserves only checked recovery',async()=>{
 const h=harness((s,n)=>n===1?envelope(s):new Uint8Array([0xff,0xfe])),first=await h.render(selected()),permalink=links(first).find(row=>row['aria-label']==='Open the checked selection at revision 1');assert.ok(permalink);const held=await h.render(query(permalink.href));withheld(held);assert.match(held,/Recorded audit unavailable/);assert.deepEqual(query(target(held,'Start a fresh audit')),selected());assert.deepEqual(h.decisions,['ok','unavailable']);assert.deepEqual(h.diagnostics,['operator_audit_read']);assert.equal(h.calls.length,2)
});

test('actual scope and cursor mismatch on a followed filtered permalink cannot disclose a foreign checked report',async()=>{
 const q={...selected(),latestRevision:'24',headPublicationId:id(124),beforeRevision:'5'};
 for(const change of [r=>{r.requested.runId=id(77);r.run.runId=id(77)},r=>{r.requested.cursor.beforeRevision=4;r.history.publications=r.history.publications.filter(row=>row.revision<4)}]){
  const h=harness((s,n)=>{const r=envelope(s,true);if(n>1)change(r);return r}),first=await h.render(q),permalink=links(first).find(row=>row['aria-label']==='Open the checked selection at revision 4');assert.ok(permalink);const held=await h.render(query(permalink.href));withheld(held);assert.deepEqual(h.decisions,['ok','unavailable']);assert.deepEqual(h.diagnostics,['operator_audit_read']);assert.equal(h.calls.length,2);assert.deepEqual(query(target(held,'Start a fresh audit')),selected());assert.equal(Object.hasOwn(h.calls[1].scope,'publicationKind'),false);assert.equal(Object.hasOwn(h.calls[1].scope,'outcome'),false)
 }
});

test('accepted filtered permalink does not configure the actual default audit reader',async()=>{
 const active=harness(s=>envelope(s)),first=await active.render(selected()),permalink=links(first).find(row=>row['aria-label']==='Open the checked selection at revision 1'),h=harness();assert.ok(permalink);const held=await h.render(query(permalink.href));withheld(held);assert.match(held,/Recorded audit connection unavailable/);assert.deepEqual(h.calls,[]);assert.deepEqual(h.decisions,['unconfigured']);assert.deepEqual(h.diagnostics,[]);assert.deepEqual(query(target(held,'Start a fresh audit')),selected())
});

test('fresh audit observation can show suspended registration while retaining historical check without implying current eligibility',async()=>{
 const h=harness((s,n)=>{const r=envelope(s);if(n>1){r.sources[0].registrationState='suspended';r.sources[0].allowFetch=false;r.sources[0].fetchEnabled=false}return r}),first=await h.render(selected()),fresh=query(target(first,'Start a fresh audit')),second=await h.render(fresh);assert.match(first,/<dt>Query-observed registration state<\/dt><dd>Approved<\/dd>/);assert.match(second,/<dt>Query-observed registration state<\/dt><dd>Suspended<\/dd>/);assert.match(second,/<dt>Historical run check outcome<\/dt><dd>Unchanged<\/dd>/);assert.match(second,/Neither is a current source health assessment/);assert.match(second,/accepted record or stored head does not establish current public eligibility/);assert.deepEqual(h.calls.map(row=>row.scope),[scope(),scope()]);assert.deepEqual(h.decisions,['ok','ok']);assert.deepEqual(h.diagnostics,[])
});
