import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor} from '../src/server/operator-audit-choices-reader.ts';
import {choiceId} from './helpers/operator_audit_choices_fixture.mjs';
const cursor=()=>({createdAt:'2026-10-05T09:30:00.000001Z',runId:choiceId(99)});
const query=()=>({runId:choiceId(1),beforeCreatedAt:cursor().createdAt,beforeRunId:cursor().runId});
function harness(mode='development',read=async()=>({kind:'unconfigured'})){
 const calls=[],marker=Error('NOT_FOUND');const Page=loadTsx(new URL('../app/editorial-preview/audit/select/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){throw marker}}:name.endsWith('/server/operator-audit-choices-reader.ts')?{canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,readOperatorAuditChoices:async(runId,_signal,cursor)=>{calls.push({runId,cursor});return read(runId,cursor)}}:undefined,{env:{NODE_ENV:mode}}).default;
 return{calls,marker,Page,render:async query=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}))};
}

test('actual run selector reads admitted run field once and dispatches the first checked value',async()=>{
 let n=0;const input={get runId(){n++;return n===1?choiceId(1):choiceId(2)}},h=harness();const html=await h.render(input);
 assert.deepEqual(h.calls,[{runId:choiceId(1),cursor:null}]);assert.equal(n,1);assert.match(html,new RegExp(choiceId(1)));assert.doesNotMatch(html,new RegExp(choiceId(2)));
});

test('actual continuation reads each owned cursor field once and freezes the first tuple',async()=>{
 const reads={runId:0,beforeCreatedAt:0,beforeRunId:0},base=query(),input={};
 for(const key of Object.keys(base))Object.defineProperty(input,key,{enumerable:true,get(){reads[key]++;return reads[key]===1?base[key]:key==='beforeCreatedAt'?'2026-10-05T09:31:00.000002Z':choiceId(90)}});
 const h=harness();await h.render(input);assert.deepEqual(h.calls,[{runId:choiceId(1),cursor:cursor()}]);assert.deepEqual(reads,{runId:1,beforeCreatedAt:1,beforeRunId:1});assert.ok(Object.isFrozen(h.calls[0].cursor));
});

test('a partial own cursor cannot borrow its counterpart from the prototype',async()=>{
 for(const own of ['beforeCreatedAt','beforeRunId']){const missing=own==='beforeCreatedAt'?'beforeRunId':'beforeCreatedAt',input=Object.assign(Object.create({[missing]:query()[missing]}),{runId:choiceId(1),[own]:query()[own]}),h=harness();const html=await h.render(input);assert.deepEqual(h.calls,[]);assert.match(html,/Choose a recorded run/);}
});

test('partial cursors veto inherited getters and hidden counterparts before source values are observed',async()=>{
 for(const hidden of [false,true]){let reads=0;const input={get runId(){reads++;return choiceId(1)},get beforeCreatedAt(){reads++;return cursor().createdAt}};
 const target=hidden?input:Object.getPrototypeOf(Object.setPrototypeOf(input,{}));Object.defineProperty(target,'beforeRunId',{enumerable:!hidden,get(){reads++;return cursor().runId}});
 const h=harness();await h.render(input);assert.deepEqual(h.calls,[]);assert.equal(reads,0);}
});

test('unknown own selectors veto all admitted getters before the actual read',async()=>{
 let reads=0;const input={get runId(){reads++;return choiceId(1)},provider:'unsupported'},h=harness();const html=await h.render(input);assert.deepEqual(h.calls,[]);assert.equal(reads,0);assert.doesNotMatch(html,/unsupported/);
});

test('ordinary omitted hidden inherited invalid and complete selectors retain existing meaning',async()=>{
 const hidden={};Object.defineProperty(hidden,'runId',{get(){assert.fail('hidden read')}});
 for(const input of [{},Object.create({runId:choiceId(1),...query()}),hidden]){const h=harness();await h.render(input);assert.deepEqual(h.calls,[{runId:null,cursor:null}]);}
 const h=harness();await h.render(query());assert.deepEqual(h.calls,[{runId:choiceId(1),cursor:cursor()}]);
 for(const input of [{runId:['bad']},{runId:'BAD'},{beforeCreatedAt:cursor().createdAt,beforeRunId:'BAD'},{runId:undefined},null,[]]){const h=harness();await h.render(input);assert.deepEqual(h.calls,[]);}
});

test('read faults remain generic and production refusal still precedes parameters',async()=>{
 const h=harness('development',async()=>{throw Error('PRIVATE_FAULT')});const html=await h.render(query());assert.match(html,/Recorded choices unavailable/);assert.doesNotMatch(html,/PRIVATE_FAULT/);assert.deepEqual(h.calls,[{runId:choiceId(1),cursor:cursor()}]);
 for(const mode of ['production','test','']){const h=harness(mode);let reads=0;await assert.rejects(h.Page({get searchParams(){reads++;throw Error('REJECTED')}}),e=>e===h.marker);assert.equal(reads,0);assert.deepEqual(h.calls,[]);}
});
