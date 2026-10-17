import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {choices,bytes} from './helpers/operator_audit_choices_fixture.mjs';
import {heldReport,decisionRow} from './helpers/operator_held_fixture.mjs';
import {proposalReport,proposalScope,proposalId as id,proposalBytes} from './helpers/proposal_fixture.mjs';
import {audit,scope as auditScope} from './helpers/operator_audit_fixture.mjs';
import {operatorAuditChoicesSchema} from '../src/operator-audit-choices.ts';
import {auditRunStates,auditRunStateFilter,auditBrowseSelection,auditBrowseHref,auditRunReturnHref,canonicalAuditRunReturn} from '../src/operator-audit-navigation.ts';
import {heldBrowseSelection,heldBrowseHref} from '../src/operator-held-browse.ts';
import {proposalBrowseSelection,capturedProposalHref} from '../src/operator-proposal-navigation.ts';
import {canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,createOperatorAuditChoicesReader} from '../src/server/operator-audit-choices-reader.ts';
import {canonicalHeldDecisionScope,createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';

const navigation=createRequire(import.meta.url)('next/navigation'),marker=Symbol('not-found');
const View=loadTsx(new URL('../src/operator-audit-choices-view.tsx',import.meta.url)).OperatorAuditChoicesView;
const Held=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
const Audit=loadTsx(new URL('../src/operator-audit-view.tsx',import.meta.url)).OperatorAuditView;
const render=(View,props)=>renderToStaticMarkup(View(props));
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const link=(html,text)=>new URL(links(html).find(x=>x.text===text)?.href??assert.fail('Missing '+text),'https://example.invalid');
const query=u=>Object.fromEntries(u.searchParams);
const cursor=()=>({createdAt:'2026-09-28T05:15:00.000001Z',runId:id(99)});
const returning=()=>({runId:id(1),cursor:cursor(),state:'failed'});
function recorded(selected=id(1),page=cursor(),count=6){
 const r=choices();r.observedAt='2026-09-28T08:00:00Z';r.requestedRunId=selected;r.requestedCursor=page;
 r.runs=Array.from({length:count},(_,i)=>({runId:id(count-i),jurisdictionId:'invented-country',createdAt:'2026-09-28T05:00:00.000001Z',runState:['queued','running','completed','partial','rejected','failed'][i%6]}));
 r.runs.at(-1).runState='failed';r.selectedRun=r.runs.find(x=>x.runId===selected)??null;
 r.issues=r.selectedRun?[{issueId:id(7),issueKey:'invented-issue'}]:[];r.moreIssues=false;r.moreRuns=count===20;r.nextCursor=r.moreRuns?{createdAt:r.runs.at(-1).createdAt,runId:r.runs.at(-1).runId}:null;
 return operatorAuditChoicesSchema.parse(r);
}
const plain={runId:id(1),beforeCreatedAt:cursor().createdAt,beforeRunId:id(99)};
function harness(mode='development',read){
 const calls=[];
 const reader=read??createOperatorAuditChoicesReader(async(selected,signal,page)=>{calls.push({selected,page,frozen:page===null||Object.isFrozen(page),signal});return bytes(recorded(selected,page));},()=>0,()=>assert.fail('unexpected diagnostic'));
 const intercept=name=>name==='next/navigation'?{...navigation,notFound(){throw marker;}}:name.endsWith('operator-audit-choices-reader.ts')?{canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,readOperatorAuditChoices:reader}:undefined;
 const Page=loadTsx(new URL('../app/editorial-preview/audit/select/page.tsx',import.meta.url),intercept,{env:{NODE_ENV:mode}}).default;
 return {calls,Page,render:async q=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(q)}))};
}

test('each stored state filters only this checked page while a separately checked selected run keeps issue choices',()=>{
 const r=recorded();assert.deepEqual(auditRunStates,['queued','running','completed','partial','failed','rejected']);
 for(const state of auditRunStates){
  const html=render(View,{decision:{kind:'ok',report:r},selection:id(1),cursor:cursor(),state});
  assert.match(html,/Showing 1 of 6 recorded runs/);assert.match(html,/name="issueId"/);
  const list=html.match(/<ol\b[^>]*aria-label="Older recorded runs"[\s\S]*?<\/ol>/)[0];
  assert.equal(links(list).length,1);assert.equal(query(new URL(links(list)[0].href,'https://example.invalid')).state,state);
  assert.equal(html.includes('does not match this page’s run state filter'),state!=='failed');
  assert.equal(query(link(html,'Inspect held decisions for this run')).returnRunState,state);
 }
});

test('native state form clear and pagination preserve exact selection without claiming filtered page coverage',()=>{
 const r=recorded(id(1),cursor(),20),html=render(View,{decision:{kind:'ok',report:r},selection:id(1),cursor:cursor(),state:'failed'});
 const form=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].find(m=>attrs(m[1])['aria-label']==='Filter recorded run states');assert.ok(form);
 const fields=Object.fromEntries([...form[2].matchAll(/<input\b([^>]*)/g)].map(m=>{const a=attrs(m[1]);return [a.name,a.value];}));assert.deepEqual(fields,plain);
 assert.deepEqual(query(link(html,'Clear run state filter')),plain);
 assert.deepEqual(query(link(html,'Newest recorded runs')),{runId:id(1),state:'failed'});
 assert.deepEqual(query(link(html,'Older recorded runs')),{runId:id(1),beforeCreatedAt:r.nextCursor.createdAt,beforeRunId:r.nextCursor.runId,state:'failed'});
 assert.match(html,/contains 20 stored runs before filtering/);assert.doesNotMatch(html,/This page shows 20 runs/);
 const zero=render(View,{decision:{kind:'ok',report:recorded(id(1),cursor(),1)},state:'completed'});assert.match(zero,/Showing 0 of 1/);assert.match(zero,/Other pages may contain matches/);assert.match(zero,/issueId/);
});

test('actual run route captures state once before the byte read and refuses unsupported or repeated state without dispatch',async()=>{
 const h=harness();let observations=0;const input={...plain};Object.defineProperty(input,'state',{enumerable:true,get(){observations++;return observations===1?'failed':'PRIVATE_CANARY';}});
 const html=await h.render(input);assert.equal(observations,1);assert.match(html,/Showing 1 of 6/);assert.doesNotMatch(html,/PRIVATE_CANARY/);
 assert.equal(h.calls.length,1);assert.deepEqual({selected:h.calls[0].selected,page:h.calls[0].page},{selected:id(1),page:cursor()});assert.ok(h.calls[0].frozen&&h.calls[0].signal.aborted);
 for(const state of ['PRIVATE_CANARY',['failed'],null,0]){const denied=harness();assert.match(await denied.render({...plain,state}),/selection is invalid/);assert.equal(denied.calls.length,0);}
 const inherited=Object.create({state:'PRIVATE_CANARY'});Object.assign(inherited,plain);const old=harness();assert.match(await old.render(inherited),/Showing 6 of 6/);assert.equal(old.calls.length,1);
 for(const mode of ['production','test',''])await assert.rejects(harness(mode).Page({get searchParams(){assert.fail('Rejected query observed');}}),error=>error===marker);
});

test('owned run-state return context traverses audit holds and comparison grammar while unsupported or orphan context refuses',()=>{
 const returnValue=returning();assert.deepEqual(canonicalAuditRunReturn(returnValue),returnValue);
 const a=auditScope();a.runId=id(1);const selected=auditBrowseSelection(query(new URL(auditBrowseHref(a,returnValue,'failed','correction'),'https://example.invalid')));
 assert.deepEqual(selected.runReturn,returnValue);assert.deepEqual(selected.scope,a);
 const held={runId:id(1),cursor:null};const heldSelected=heldBrowseSelection(query(new URL(heldBrowseHref(held,'material_conflict',returnValue),'https://example.invalid')));assert.deepEqual(heldSelected.runReturn,returnValue);
 const proposal=proposalBrowseSelection(query(new URL(capturedProposalHref(proposalScope(),heldSelected),'https://example.invalid')));assert.deepEqual(proposal.held.runReturn,returnValue);
 assert.deepEqual(query(new URL(auditRunReturnHref(returnValue),'https://example.invalid')),{...plain,state:'failed'});
 for(const state of ['PRIVATE_CANARY','',['failed'],null]){
  for(const [parse,q] of [[auditBrowseSelection,{runId:id(1),issueId:id(7)}],[heldBrowseSelection,{runId:id(1)}],[proposalBrowseSelection,proposalScope()]]){
   assert.equal(parse({...q,returnRunState:state}),null);assert.equal(parse({...q,returnToRuns:'1',returnRunState:state}),null);
  }
 }
 const noState={runId:id(1),cursor:cursor()};assert.deepEqual(canonicalAuditRunReturn(noState),noState);assert.equal(auditRunStateFilter(''),'');
});

test('a run state survives a fresh run held comparison held run journey without extending any private read scope',async()=>{
 const h=harness(),calls={held:[],proposal:[]};const first=await h.render({...plain,state:'failed'});const heldQ=query(link(first,'Inspect held decisions for this run'));
 const heldRead=createHeldDecisionsReader(async(s)=>{calls.held.push(structuredClone(s));const r=heldReport(s);r.run.createdAt='2026-09-28T05:00:00.000000Z';r.observedAt='2026-09-28T08:00:00.000000Z';r.decisions=[{...decisionRow(2),decisionId:id(2),decidedAt:'2026-09-28T06:30:00.000001Z'}];return bytes(r);},()=>0,()=>assert.fail('diagnostic'));
 const proposalRead=createProposalReader(async(s)=>{calls.proposal.push(structuredClone(s));return proposalBytes(proposalReport());},()=>0,()=>assert.fail('diagnostic'));
 const intercept=name=>name==='next/navigation'?navigation:name.endsWith('operator-held-decisions-reader.ts')?{canonicalHeldDecisionScope,readHeldDecisions:heldRead}:name.endsWith('operator-proposal-reader.ts')?{readCapturedProposal:proposalRead}:undefined;
 const heldPage=loadTsx(new URL('../app/editorial-preview/held/page.tsx',import.meta.url),intercept).default;
 const proposalPage=loadTsx(new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url),intercept).default;
 const held=renderToStaticMarkup(await heldPage({searchParams:Promise.resolve(heldQ)}));
 const comparison=renderToStaticMarkup(await proposalPage({searchParams:Promise.resolve(query(link(held,'Inspect captured proposal')))}));
 const located=link(comparison,'Locate this recorded hold on the selected page (new read)');assert.equal(located.hash,`#recorded-hold-${id(2)}`);
 const heldAgain=renderToStaticMarkup(await heldPage({searchParams:Promise.resolve(query(located))}));const back=query(link(heldAgain,'Back to selected recorded-run page'));assert.deepEqual(back,{...plain,state:'failed'});
 assert.match(await h.render(back),/Showing 1 of 6/);assert.deepEqual(calls,{held:[{runId:id(1),cursor:null},{runId:id(1),cursor:null}],proposal:[proposalScope()]});assert.equal(h.calls.length,2);
 const r=audit();r.requested.runId=id(1);r.run.runId=id(1);const auditHtml=render(Audit,{decision:{kind:'ok',report:r},runReturn:returning(),outcome:'failed',publicationKind:'correction'});
 const summaries=links(auditHtml).filter(x=>x.text==='Unchanged: 1'||x.text==='Accepted: 1');assert.equal(summaries.length,2);for(const l of summaries)assert.equal(query(new URL(l.href,'https://example.invalid')).returnRunState,'failed');
});

test('held malformed or mismatched choices withhold state counts and invalid direct filters never read the report',()=>{
 const r=recorded();for(const decision of [...['unconfigured','unavailable','changed','invalid_scope'].map(kind=>({kind,report:r})),{kind:'ok',report:{...r,private:'PRIVATE_CANARY'}}]){
  const html=render(View,{decision,selection:id(1),cursor:cursor(),state:'failed'});assert.doesNotMatch(html,/Showing \d of|Filter recorded run states|invented-country|PRIVATE_CANARY/);
 }
 const mismatch=render(View,{decision:{kind:'ok',report:r},selection:id(99),cursor:cursor(),state:'failed'});assert.doesNotMatch(mismatch,/Showing \d of|invented-country/);
 let observed=0;const decision={kind:'ok',get report(){observed++;throw Error('PRIVATE_CANARY');}};
 assert.match(render(View,{decision,state:'PRIVATE_CANARY'}),/selection is invalid/);assert.equal(observed,0);
});


test('direct run return captures only admitted own enumerable fields once and never promotes hidden state',()=>{
 const legacy={runId:id(1),cursor:cursor()};
 const inherited=Object.assign(Object.create({state:'failed'}),legacy);
 const hidden={...legacy};Object.defineProperty(hidden,'state',{value:'failed',enumerable:false});
 for(const input of [inherited,hidden])assert.deepEqual(canonicalAuditRunReturn(input),legacy);
 let observations=0;const changing={...legacy};Object.defineProperty(changing,'state',{enumerable:true,get(){observations++;return observations===1?'failed':'PRIVATE_CANARY';}});
 assert.deepEqual(canonicalAuditRunReturn(changing),{...legacy,state:'failed'});assert.equal(observations,1);
 let rejectedReads=0;const extra={...legacy};Object.defineProperty(extra,'private',{enumerable:true,get(){rejectedReads++;throw Error('PRIVATE_CANARY');}});
 assert.equal(canonicalAuditRunReturn(extra),null);assert.equal(rejectedReads,0);
 for(const key of ['runId','cursor']){const borrowed=Object.create({[key]:legacy[key]});for(const own of ['runId','cursor'])if(own!==key)borrowed[own]=legacy[own];assert.equal(canonicalAuditRunReturn(borrowed),null);}
 const removed={...legacy};Object.defineProperty(removed,'runId',{enumerable:true,get(){delete removed.cursor;return id(1);}});assert.equal(canonicalAuditRunReturn(removed),null);
 const trapped=new Proxy(legacy,{getOwnPropertyDescriptor(){throw Error('PRIVATE_CANARY');}});assert.equal(canonicalAuditRunReturn(trapped),null);
});
