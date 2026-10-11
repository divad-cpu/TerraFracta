import assert from 'node:assert/strict';import test from 'node:test';import {existsSync} from 'node:fs';
import {heldReasonCodes} from '../src/operator-held-decisions.ts';
import {proposalId,proposalScope} from './helpers/proposal_fixture.mjs';
const source=new URL('../src/operator-proposal-navigation.ts',import.meta.url);
const helpers=existsSync(source)?await import(source.href):null;
function api(){assert.ok(helpers,'Explicit original feature absence: proposal navigation helper does not exist');return helpers;}
const cursor={decidedAt:'2026-09-28T07:00:00.000001Z',decisionId:proposalId(90)};
const query=(reason='material_conflict')=>({...proposalScope(),beforeDecidedAt:cursor.decidedAt,beforeDecisionId:cursor.decisionId,reason});
test('legacy and every closed reason/cursor round trip keep proposal read scope separate from return navigation',()=>{
 const {proposalBrowseSelection:select,capturedProposalHref:href}=api();assert.deepEqual(select(proposalScope()),{scope:proposalScope(),held:null,query:proposalScope()});
 for(const reason of ['',...heldReasonCodes])for(const withCursor of [false,true]){
  const q=withCursor?query(reason):{...proposalScope(),reason},selected=select(q);assert.ok(selected);
  assert.deepEqual(selected.scope,proposalScope());assert.deepEqual(selected.held,{scope:{runId:proposalId(1),cursor:withCursor?cursor:null},reason});
  const u=new URL(href(selected.scope,selected.held),'https://example.invalid');assert.equal(u.pathname,'/editorial-preview/held/proposal');
  const again=select(Object.fromEntries(u.searchParams));assert.deepEqual(again.scope,proposalScope());
  assert.deepEqual(again.held,withCursor||reason?selected.held:null);
 }
});
test('new return keys cannot accept private paths, arrays, unknown fields or unregistered reasons',()=>{
 const {proposalBrowseSelection:select}=api();for(const q of [null,[],{}, {...query(),reason:'PRIVATE_CANARY'}, {...query(),reason:['material_conflict']},
  {...query(),returnTo:'https://example.invalid/PRIVATE_CANARY'}, {...query(),sql:'PRIVATE_CANARY'}, {...query(),beforeDecidedAt:null},
  {...query(),decisionId:[proposalId(2)]}, {...query(),runId:'PRIVATE_CANARY'}, {...proposalScope(),reason:undefined}])assert.equal(select(q),null);
});
test('required scope and paired cursor belong to own enumerable keys; inherited optional context is never borrowed',()=>{
 const {proposalBrowseSelection:select}=api();
 for(const q of [Object.assign(Object.create(proposalScope()),{beforeDecidedAt:cursor.decidedAt,reason:'material_conflict'}),
  Object.assign(Object.create({runId:proposalId(1)}),{decisionId:proposalId(2)}),
  Object.assign(Object.create({beforeDecisionId:cursor.decisionId}),{...proposalScope(),beforeDecidedAt:cursor.decidedAt}),
  Object.assign(Object.create({beforeDecidedAt:cursor.decidedAt}),{...proposalScope(),beforeDecisionId:cursor.decisionId})])assert.equal(select(q),null);
 const inherited=Object.assign(Object.create({reason:'material_conflict',beforeDecidedAt:cursor.decidedAt,beforeDecisionId:cursor.decisionId}),proposalScope());
 assert.deepEqual(select(inherited),{scope:proposalScope(),held:null,query:proposalScope()});
 const nonenumerable={decisionId:proposalId(2)};Object.defineProperty(nonenumerable,'runId',{value:proposalId(1)});assert.equal(select(nonenumerable),null);
});
test('partial cursors and noncanonical or invalid dates are refused without changing the exact microsecond tuple',()=>{
 const {proposalBrowseSelection:select}=api();const one=query();delete one.beforeDecisionId;assert.equal(select(one),null);
 const other=query();delete other.beforeDecidedAt;assert.equal(select(other),null);
 for(const value of ['2026-09-28T07:00:00.0000011Z','2026-09-28T07:00:00.000001+00:00','2026-02-30T07:00:00.000001Z','PRIVATE_CANARY'])assert.equal(select({...query(),beforeDecidedAt:value}),null);
 assert.deepEqual(select(query()).held.scope.cursor,cursor);
});
test('frozen query values survive unchanged and inaccessible query objects fail closed',()=>{
 const {proposalBrowseSelection:select}=api();const q=Object.freeze(query()),before=JSON.stringify(q);assert.ok(select(q));assert.equal(JSON.stringify(q),before);
 const inaccessible={...proposalScope()};Object.defineProperty(inaccessible,'reason',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}});assert.equal(select(inaccessible),null);
 const {proxy,revoke}=Proxy.revocable({},{});revoke();assert.equal(select(proxy),null);
});
test('a different run cannot supply a return cursor and legacy links stay fixed relative paths',()=>{
 const {capturedProposalHref:href,proposalBrowseSelection:select}=api();const legacy='/editorial-preview/held/proposal?'+new URLSearchParams(proposalScope());assert.equal(href(proposalScope()),legacy);
 assert.equal(href(proposalScope(),{scope:{runId:proposalId(99),cursor},reason:'material_conflict'}),legacy);
 const selected=select(query());assert.deepEqual(Object.keys(selected.scope).sort(),['decisionId','runId']);
 assert.ok(!href(selected.scope,selected.held).includes('returnTo'));
});

test('unstable own values are observed once and scope, held context and retained checked query stay coherent',()=>{
 const {proposalBrowseSelection:select}=api();let reads=0;const input=query();Object.defineProperty(input,'runId',{enumerable:true,get(){return ++reads<=2?proposalId(1):proposalId(99);}});
 const selected=select(input);assert.equal(reads,1);assert.deepEqual(selected.scope,proposalScope());assert.equal(selected.held.scope.runId,proposalId(1));assert.equal(selected.query.runId,proposalId(1));
 assert.ok(Object.isFrozen(selected.scope));assert.ok(Object.isFrozen(selected.query));assert.notEqual(selected.query,input);
 let cursorReads=0;const another=query();Object.defineProperty(another,'beforeDecisionId',{enumerable:true,get(){return ++cursorReads===1?cursor.decisionId:proposalId(99);}});
 const checked=select(another);assert.equal(cursorReads,1);assert.deepEqual(checked.held.scope.cursor,cursor);assert.equal(checked.query.beforeDecisionId,cursor.decisionId);
});
