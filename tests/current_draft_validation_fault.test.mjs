import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePublicIssueProjection } from '../src/public-issue-projection.ts';
import { currentIssueCorrectionContext } from '../src/current-issue-correction-draft.ts';
import { syntheticReadRows } from '../app/evidence-preview/example.ts';
import { correctionModule } from './helpers/correction_draft_harness.mjs';
const record=()=>parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const {CurrentIssueCorrectionDraft}=correctionModule();
function held(value){assert.equal(currentIssueCorrectionContext(value),null);const html=renderToStaticMarkup(createElement(CurrentIssueCorrectionDraft,{issue:value}));assert.match(html,/Correction draft unavailable/);assert.doesNotMatch(html,/PRIVATE_INPUT_FAULT|textarea|Norway \/ Housing costs|sample-/);}
let faults=0;const fault=()=>{faults++;throw Error('PRIVATE_INPUT_FAULT')};
function heldFault(value){const before=faults;held(value);assert.equal(faults-before,2);}

test('throwing root validation fields hold both current context and actual draft presentation',()=>{
 for(const field of ['issueId','publicationId','revision','title','claims']){const value=record();Object.defineProperty(value,field,{enumerable:true,get:fault});heldFault(value);}
});

test('throwing nested claim and evidence validation fields remain detail-free',()=>{
 for(const field of ['assertion','periodLabel','evidence']){const value=record();Object.defineProperty(value.claims[0],field,{enumerable:true,get:fault});heldFault(value);}
 const value=record();Object.defineProperty(value.claims[0].evidence[0],'title',{enumerable:true,get:fault});heldFault(value);
});

test('enumeration and revoked object validation faults do not become illustrative editors',()=>{
 heldFault(new Proxy(record(),{ownKeys:fault}));const {proxy,revoke}=Proxy.revocable(record(),{});revoke();held(proxy);
});

test('normal current context and checked unavailable projection retain existing behavior',()=>{
 const value=record(),context=currentIssueCorrectionContext(value);assert.ok(context);assert.equal(context.edition,null);assert.notEqual(context.issue,value);assert.equal(context.issue.publicationId,value.publicationId);
 assert.equal(context.key,JSON.stringify(['current-issue',value.issueId,value.publicationId,value.revision,value.jurisdictionSlug,value.issueSlug]));
 for(const bad of [null,undefined,{}, {...value,privateCanary:'PRIVATE_INPUT_FAULT'}])held(bad);
 const html=renderToStaticMarkup(createElement(CurrentIssueCorrectionDraft,{issue:value}));assert.match(html,/Draft text is not submitted or stored/);assert.match(html,/current reader publication revision/);assert.doesNotMatch(html,/<form|type="submit"|name="contact"/);
});
