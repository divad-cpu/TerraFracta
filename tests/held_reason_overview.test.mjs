import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {heldReport,heldScope,heldId,decisionRow,bytes} from './helpers/operator_held_fixture.mjs';
import {heldDecisionsReportSchema} from '../src/operator-held-decisions.ts';
import {heldBrowseSelection} from '../src/operator-held-browse.ts';
import {canonicalHeldDecisionScope,createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
const View=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
const oldCursor={decidedAt:'2026-10-05T09:02:00.000001Z',decisionId:heldId(99)};
const runReturn={runId:heldId(1),cursor:{createdAt:'2026-10-05T08:30:00.000001Z',runId:heldId(98)},state:'partial',issueQuery:'housing costs'};
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),text:m[2]}));
const query=href=>Object.fromEntries(new URL(href,'https://example.invalid').searchParams);
const overview=html=>/<details[^>]*aria-label="Disclosed reason counts on this checked page"[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1]??'';
function sample(cursor=oldCursor){const r=heldReport(heldScope(cursor));r.decisions[0].reasonCodes=['source_not_approved','material_conflict','material_conflict'];r.decisions[0].undisclosedReasonCount=2;r.decisions[1].reasonCodes=['source_not_approved'];return heldDecisionsReportSchema.parse(r);}
const render=(props={})=>renderToStaticMarkup(View({decision:{kind:'ok',report:sample()},reason:'',selection:heldScope(oldCursor),runReturn,...props}));
test('disclosed reason overview counts decisions once in established order before the selected filter and discloses overlap',()=>{
 const html=render({reason:'material_conflict'}),part=overview(html);assert.ok(part.includes('material conflict: 1'));assert.ok(part.includes('source not approved: 2'));assert.ok(part.indexOf('material conflict: 1')<part.indexOf('source not approved: 2'));assert.equal(links(part).length,2);assert.ok(html.includes('Showing 1 of 2 held decisions'));assert.ok(part.includes('before the reason filter'));assert.ok(part.includes('counted once'));assert.ok(part.includes('several counts'));assert.ok(part.includes('Undisclosed entries and other pages remain unknown'));
 assert.ok(!part.includes('qualified checks passed'));assert.ok(!part.includes('current source health'));
});
test('reason count links preserve exact held page and separate run return without adding scope fields',()=>{
 const html=render({reason:'material_conflict'});assert.equal(links(overview(html)).length,2);for(const link of links(overview(html))){const selected=heldBrowseSelection(query(link.href));assert.deepEqual(selected.scope,heldScope(oldCursor));assert.deepEqual(selected.runReturn,runReturn);assert.equal(selected.reason,link.text.startsWith('material')?'material_conflict':'source_not_approved');assert.ok(!Object.hasOwn(query(link.href),'sourceQ'));}
 const newest=render({decision:{kind:'ok',report:sample(null)},selection:heldScope(),runReturn:undefined});assert.equal(links(overview(newest)).length,2);for(const link of links(overview(newest))){const selected=heldBrowseSelection(query(link.href));assert.equal(selected.scope.cursor,null);assert.equal(selected.runReturn,undefined);}
});
test('selected zero disclosure is shown honestly while hidden reasons and empty or foreign reports remain opaque',()=>{
 const zero=render({reason:'mode_unsupported'});assert.ok(overview(zero).includes('mode unsupported: 0'));assert.ok(zero.includes('No matching disclosed reason on this page'));assert.ok(zero.includes('Some reason entries are withheld'));const hidden=sample();hidden.decisions.forEach(r=>{r.reasonCodes=[];r.undisclosedReasonCount=3;});const html=render({decision:{kind:'ok',report:hidden},reason:'material_conflict'});assert.equal(links(overview(html)).length,1);assert.ok(overview(html).includes('material conflict: 0'));assert.ok(!overview(html).includes('source not approved'));
 const empty=sample();empty.decisions=[];for(const props of [{decision:{kind:'ok',report:empty}},{decision:{kind:'ok',report:sample()},selection:heldScope({...oldCursor,decisionId:heldId(97)})},{decision:{kind:'ok',report:{...sample(),privateCanary:'PRIVATE'}}},...['changed','not_found','unavailable','unconfigured','invalid_scope'].map(kind=>({decision:{kind,report:sample()}}))]){const held=render(props);assert.equal(overview(held),'');assert.ok(!held.includes('PRIVATE'));}
 let accesses=0;assert.equal(overview(render({reason:['material_conflict'],decision:{kind:'ok',get report(){accesses++;assert.fail('report observation');}}})), '');assert.equal(accesses,0);
});
test('finite actual count older fresh and changed reads preserve existing scope and withhold stale reason counts',async()=>{
 const first=sample(null);first.decisions=Array.from({length:20},(_,i)=>({...decisionRow(80-i),reasonCodes:i%2?['source_not_approved']:['material_conflict','material_conflict']}));first.more=true;const last=first.decisions.at(-1);first.nextCursor={decidedAt:last.decidedAt,decisionId:last.decisionId};heldDecisionsReportSchema.parse(first);const calls=[];let changed=false;
 const read=createHeldDecisionsReader(async(s,signal)=>{calls.push({scope:structuredClone(s),signal});return bytes(changed?{schemaVersion:1,status:'changed',requested:s}:s.cursor?sample(s.cursor):first);},()=>0,()=>assert.fail('diagnostic'));
 const page=loadTsx(new URL('../app/editorial-preview/held/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('production');},unstable_rethrow(){}}:name.endsWith('operator-held-decisions-reader.ts')?{canonicalHeldDecisionScope,readHeldDecisions:read}:undefined).default;
 const visit=async q=>renderToStaticMarkup(await page({searchParams:Promise.resolve(q)}));const initial={runId:heldId(1),returnToRuns:'1',returnBeforeCreatedAt:runReturn.cursor.createdAt,returnBeforeRunId:runReturn.cursor.runId,returnRunState:'partial',returnIssueQ:'housing costs'};
 const a=await visit(initial);assert.ok(overview(a).includes('material conflict: 10'));const count=links(overview(a)).find(x=>x.text==='material conflict: 10');assert.ok(count);const b=await visit(query(count.href));assert.ok(b.includes('Showing 10 of 20'));const older=links(b).find(x=>x.text==='Older held decisions');assert.ok(older);const c=await visit(query(older.href));assert.ok(overview(c).includes('source not approved: 2'));assert.equal(heldBrowseSelection(query(links(overview(c))[0].href)).runReturn.issueQuery,'housing costs');changed=true;const denied=await visit(query(older.href));assert.equal(overview(denied),'');assert.ok(denied.includes('Held decision list changed'));const fresh=links(denied).find(x=>x.text==='Start a fresh held-decision read');assert.equal(heldBrowseSelection(query(fresh.href)).scope.cursor,null);assert.equal(heldBrowseSelection(query(fresh.href)).reason,'material_conflict');
 assert.deepEqual(calls.map(x=>x.scope),[heldScope(),heldScope(),heldScope(first.nextCursor),heldScope(first.nextCursor)]);assert.ok(calls.every(x=>x.signal.aborted));
});
