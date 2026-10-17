import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {choices,choiceId as id,bytes} from './helpers/operator_audit_choices_fixture.mjs';
import {operatorAuditChoicesSchema} from '../src/operator-audit-choices.ts';
import {auditBrowseSelection,auditBrowseHref,canonicalAuditRunReturn,auditRunReturnHref} from '../src/operator-audit-navigation.ts';
import {heldBrowseSelection,heldBrowseHref} from '../src/operator-held-browse.ts';
import {proposalBrowseSelection,capturedProposalHref} from '../src/operator-proposal-navigation.ts';
import {canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,createOperatorAuditChoicesReader} from '../src/server/operator-audit-choices-reader.ts';
import {heldReport,decisionRow} from './helpers/operator_held_fixture.mjs';
import {proposalReport,proposalScope,proposalId as pid,proposalBytes} from './helpers/proposal_fixture.mjs';
import {audit} from './helpers/operator_audit_fixture.mjs';
import {canonicalHeldDecisionScope,createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';
import {createOperatorAuditReader} from '../src/server/operator-audit-reader.ts';
const View=loadTsx(new URL('../src/operator-audit-choices-view.tsx',import.meta.url)).OperatorAuditChoicesView;
function recorded(){const r=choices(id(1));r.issues=[{issueId:id(31),issueKey:'education-access'},{issueId:id(30),issueKey:'housing-costs'},{issueId:id(32),issueKey:'housing-delivery'}];return operatorAuditChoicesSchema.parse(r);}
const render=(issueQuery,decision={kind:'ok',report:recorded()})=>renderToStaticMarkup(View({decision,selection:id(1),state:'completed',issueQuery}));
const options=html=>{const form=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].find(m=>m[1].includes('aria-label="Open an audit for the selected run"'));return form?[...form[2].matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]):[];};
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),text:m[2]}));
const query=u=>Object.fromEntries(u.searchParams);
test('issue lookup filters only checked choices with stable order counts and honest no-match',()=>{
 const html=render('housing costs');assert.deepEqual(options(html),[id(30)]);assert.ok(html.includes('Showing 1 of 3 checked issue choices'));
 assert.ok(html.includes('name="issueQ"'));assert.ok(html.includes('name="returnIssueQ" value="housing costs"'));assert.ok(html.includes('does not establish publication or source coverage'));
 assert.deepEqual(options(render('housing')),[id(30),id(32)]);assert.deepEqual(options(render(id(32))),[id(32)]);
 const zero=render('missing');assert.deepEqual(options(zero),[]);assert.ok(zero.includes('No matching issue key on this checked selection'));assert.ok(zero.includes('Other dossiers may exist outside these returned choices'));
 assert.deepEqual(options(render('')),[id(31),id(30),id(32)]);
});
test('lookup and run-state controls clear only their own selection while run pages and holds retain query',()=>{
 const html=render('housing'),clear=links(html).find(link=>link.text==='Clear issue search'),state=links(html).find(link=>link.text==='Clear run state filter');assert.ok(clear);
 assert.deepEqual(query(new URL(clear.href,'https://example.invalid')),{runId:id(1),state:'completed'});assert.deepEqual(query(new URL(state.href,'https://example.invalid')),{runId:id(1),issueQ:'housing'});
 const held=heldBrowseSelection(query(new URL(links(html).find(link=>link.text==='Inspect held decisions for this run').href,'https://example.invalid')));assert.equal(held.runReturn.issueQuery,'housing');assert.equal(held.runReturn.state,'completed');
});
test('owned bounded issue lookup traverses audit holds and comparison without entering their private read scopes',()=>{
 const returnValue={runId:id(1),cursor:null,state:'completed',issueQuery:'housing costs'},scope={runId:id(1),issueId:id(30),cursor:null};assert.deepEqual(canonicalAuditRunReturn(returnValue),returnValue);
 const audit=auditBrowseSelection(query(new URL(auditBrowseHref(scope,returnValue,'failed','correction'),'https://example.invalid')));assert.deepEqual(audit.scope,scope);assert.deepEqual(audit.runReturn,returnValue);
 const held=heldBrowseSelection(query(new URL(heldBrowseHref({runId:id(1),cursor:null},'material_conflict',returnValue),'https://example.invalid')));assert.deepEqual(held.runReturn,returnValue);
 const proposal=proposalBrowseSelection(query(new URL(capturedProposalHref({runId:id(1),decisionId:id(2)},held),'https://example.invalid')));assert.deepEqual(proposal.held.runReturn,returnValue);
 assert.deepEqual(query(new URL(auditRunReturnHref(returnValue),'https://example.invalid')),{runId:id(1),state:'completed',issueQ:'housing costs'});
 for(const [parse,base]of [[auditBrowseSelection,{runId:id(1),issueId:id(30)}],[heldBrowseSelection,{runId:id(1)}],[proposalBrowseSelection,{runId:id(1),decisionId:id(2)}]]){
  assert.equal(parse({...base,returnIssueQ:'housing'}),null);
  for(const value of [['housing'],null,'\0','x'.repeat(81),'\ufdfa'.repeat(5)])assert.equal(parse({...base,returnToRuns:'1',returnIssueQ:value}),null);
 }
 const inherited=Object.create({issueQuery:'PRIVATE_CANARY'});Object.assign(inherited,{runId:id(1),cursor:null});assert.deepEqual(canonicalAuditRunReturn(inherited),{runId:id(1),cursor:null});
});
test('actual choice route captures one lookup before finite native bytes and refuses invalid selectors without dispatch',async()=>{
 const calls=[];const reader=createOperatorAuditChoicesReader(async(selected,signal,cursor)=>{calls.push({selected,signal,cursor});return bytes(recorded());},()=>0,()=>assert.fail('unexpected diagnostic'));
 const intercept=name=>name==='next/navigation'?{notFound(){throw Error('production refusal');},unstable_rethrow(){}}:name.endsWith('operator-audit-choices-reader.ts')?{canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,readOperatorAuditChoices:reader}:undefined;
 const page=loadTsx(new URL('../app/editorial-preview/audit/select/page.tsx',import.meta.url),intercept).default;
 let observations=0;const q={runId:id(1),state:'completed'};Object.defineProperty(q,'issueQ',{enumerable:true,get(){observations++;return observations===1?'housing costs':'PRIVATE_CANARY';}});
 const html=renderToStaticMarkup(await page({searchParams:Promise.resolve(q)}));assert.equal(observations,1);assert.deepEqual(options(html),[id(30)]);assert.ok(!html.includes('PRIVATE_CANARY'));assert.equal(calls.length,1);assert.equal(calls[0].selected,id(1));assert.equal(calls[0].cursor,null);assert.ok(calls[0].signal.aborted);
 for(const value of [['housing'],null,'\0','x'.repeat(81),'\ufdfa'.repeat(5)]){const rejected=renderToStaticMarkup(await page({searchParams:Promise.resolve({runId:id(1),issueQ:value})}));assert.ok(rejected.includes('selection is invalid'));assert.equal(calls.length,1);}
 for(const kind of ['invalid_scope','unconfigured','unavailable','changed']){const held=render('PRIVATE_CANARY',{kind});assert.deepEqual(options(held),[]);assert.ok(!held.includes('name="issueQ"'));}
});

test('bounded issue lookup follows actual choice audit held comparison and fresh return without entering private scopes',async()=>{
 const cursor={createdAt:'2026-09-28T05:15:00.000001Z',runId:pid(99)},initial={runId:pid(1),beforeCreatedAt:cursor.createdAt,beforeRunId:cursor.runId,state:'completed',issueQ:'invented issue'};
 const calls={choices:[],audit:[],held:[],proposal:[]};
 const choiceRead=createOperatorAuditChoicesReader(async(selected,signal,page)=>{
  calls.choices.push({selected,page:structuredClone(page),signal});const r=choices();r.observedAt='2026-09-28T08:00:00Z';r.requestedRunId=selected;r.requestedCursor=page;
  r.runs=[4,3,2].map(n=>({runId:pid(n),jurisdictionId:'invented-country',createdAt:'2026-09-28T05:00:00.000001Z',runState:'completed'}));
  r.selectedRun={runId:selected,jurisdictionId:'invented-country',createdAt:'2026-09-28T05:20:00.000001Z',runState:'failed'};
  r.issues=[...Array.from({length:49},(_,i)=>({issueId:pid(100+i),issueKey:`education-${String(i).padStart(2,'0')}`})),{issueId:pid(7),issueKey:'invented-issue'}];r.moreIssues=true;return bytes(operatorAuditChoicesSchema.parse(r));
 },()=>0,()=>assert.fail('diagnostic'));
 const auditRead=createOperatorAuditReader(async(s,signal)=>{calls.audit.push({scope:structuredClone(s),signal});const r=audit();r.requested=structuredClone(s);r.run.runId=s.runId;r.history.issueId=s.issueId;r.run.createdAt='2026-09-28T05:20:00.000001Z';return bytes(r);},()=>0,()=>assert.fail('diagnostic'));
 const heldRead=createHeldDecisionsReader(async(s,signal)=>{calls.held.push({scope:structuredClone(s),signal});const r=heldReport(s);r.run.createdAt='2026-09-28T05:20:00.000001Z';r.observedAt='2026-09-28T08:00:00.000000Z';r.decisions=[{...decisionRow(2),decisionId:pid(2),decidedAt:'2026-09-28T06:30:00.000001Z'}];return bytes(r);},()=>0,()=>assert.fail('diagnostic'));
 const proposalRead=createProposalReader(async(s,signal)=>{calls.proposal.push({scope:structuredClone(s),signal});return proposalBytes(proposalReport());},()=>0,()=>assert.fail('diagnostic'));
 const intercept=name=>name==='next/navigation'?{notFound(){assert.fail('production');},unstable_rethrow(){}}:name.endsWith('operator-audit-choices-reader.ts')?{canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,readOperatorAuditChoices:choiceRead}:name.endsWith('operator-audit-reader.ts')?{readOperatorAudit:auditRead}:name.endsWith('operator-held-decisions-reader.ts')?{canonicalHeldDecisionScope,readHeldDecisions:heldRead}:name.endsWith('operator-proposal-reader.ts')?{readCapturedProposal:proposalRead}:undefined;
 const pages=Object.fromEntries([['choices','audit/select'],['audit','audit'],['held','held'],['proposal','held/proposal']].map(([key,path])=>[key,loadTsx(new URL(`../app/editorial-preview/${path}/page.tsx`,import.meta.url),intercept).default]));
 const read=async(key,q)=>renderToStaticMarkup(await pages[key]({searchParams:Promise.resolve(q)}));
 const href=(html,label)=>new URL(links(html).find(l=>l.text===label)?.href??assert.fail('Missing '+label),'https://example.invalid');
 const first=await read('choices',initial);assert.deepEqual(options(first),[pid(7)]);assert.ok(first.includes('Showing 1 of 50 checked issue choices'));assert.ok(first.includes('first 50 issue keys were returned before searching'));assert.ok(first.includes('does not match this page’s run state filter'));
 const form=[...first.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].find(m=>m[1].includes('aria-label="Open an audit for the selected run"'));assert.ok(form);
 const auditQ=Object.fromEntries([...form[2].matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));auditQ.issueId=pid(7);
 const audited=await read('audit',auditQ);assert.deepEqual(query(href(audited,'Back to selected recorded-run page')),initial);assert.ok(audited.includes('fictional:source'));
 const held=await read('held',query(href(first,'Inspect held decisions for this run')));
 const compared=await read('proposal',query(href(held,'Inspect captured proposal')));assert.ok(compared.includes('proposal-source-index'));assert.ok(compared.includes('href="#proposal-source-receipt-1"'));
 const located=href(compared,'Locate this recorded hold on the selected page (new read)');assert.equal(located.hash,`#recorded-hold-${pid(2)}`);
 const returnedHold=await read('held',query(located)),back=query(href(returnedHold,'Back to selected recorded-run page'));assert.deepEqual(back,initial);
 assert.deepEqual(options(await read('choices',back)),[pid(7)]);
 const absent=await read('choices',{...initial,issueQ:'missing'});assert.deepEqual(options(absent),[]);assert.ok(absent.includes('Other dossiers may exist outside these returned choices'));assert.ok(absent.includes('first 50 issue keys were returned before searching'));
 assert.deepEqual(calls.audit.map(c=>c.scope),[{runId:pid(1),issueId:pid(7),cursor:null}]);assert.deepEqual(calls.held.map(c=>c.scope),[{runId:pid(1),cursor:null},{runId:pid(1),cursor:null}]);assert.deepEqual(calls.proposal.map(c=>c.scope),[proposalScope()]);assert.equal(calls.choices.length,3);
 for(const c of calls.choices){assert.equal(c.selected,pid(1));assert.deepEqual(c.page,cursor);assert.ok(c.signal.aborted);}for(const group of ['audit','held','proposal'])for(const c of calls[group])assert.ok(c.signal.aborted);
});
