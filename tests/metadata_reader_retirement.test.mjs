import assert from 'node:assert/strict';
import test from 'node:test';
import {getEventListeners} from 'node:events';
import {createOperatorAuditReader} from '../src/server/operator-audit-reader.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';
import {createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
import {createOperatorAuditChoicesReader} from '../src/server/operator-audit-choices-reader.ts';
import {createPublicIssueReader} from '../src/server/public-issue-reader.ts';
import {audit,scope as auditScope} from './helpers/operator_audit_fixture.mjs';
import {proposalReport,proposalScope} from './helpers/proposal_fixture.mjs';
import {heldReport,heldScope} from './helpers/operator_held_fixture.mjs';
import {choices} from './helpers/operator_audit_choices_fixture.mjs';
import {sample} from './helpers/public_read_rows_fixture.mjs';
const bytes=x=>Buffer.from(JSON.stringify(x));
const cases=[['audit',createOperatorAuditReader,auditScope,audit],['proposal',createProposalReader,proposalScope,proposalReport],['held',createHeldDecisionsReader,heldScope,heldReport],['choices',createOperatorAuditChoicesReader,()=>null,choices],['public',createPublicIssueReader,()=>sample().requestedRoute,sample]];
for(const [name,create,scope,fixture] of cases){
 const denied=name==='public'?{status:503,cacheControl:'no-store'}:{kind:'unavailable'};
 const diagnostic=name==='public'?'public_issue_read':'operator_audit_read';
 for(const mode of ['parent','deadline','rollback','nonfinite','throw'])test(`${name} final retirement ${mode} cannot deliver a stale checked observation`,async()=>{
  const parent=new AbortController(),codes=[];let retired=false,calls=0,inner;
  const clock=()=>{if(!retired||mode==='parent')return 0;if(mode==='throw')throw Error('PRIVATE_RETIREMENT');return mode==='deadline'?3000:mode==='rollback'?-1:NaN;};
  const reader=create(async(_scope,signal)=>{calls++;inner=signal;signal.addEventListener('abort',()=>{retired=true;if(mode==='parent')parent.abort();},{once:true});return bytes(fixture());},clock,async code=>{codes.push(code);return 'saved';});
  assert.deepEqual(await reader(scope(),parent.signal),denied);assert.equal(calls,1);assert.equal(retired,true);assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.deepEqual(codes,mode==='parent'?[]:[diagnostic]);
 });
 test(`${name} deliberate owned abort preserves ordinary successful delivery`,async()=>{
  const parent=new AbortController();let inner;
  const result=await create(async(_scope,s)=>{inner=s;return bytes(fixture());},()=>0,async()=>assert.fail('No diagnostic'))(scope(),parent.signal);
  assert.equal(name==='public'?result.status:result.kind,name==='public'?200:'ok');assert.equal(inner.aborted,true);assert.equal(parent.signal.aborted,false);
 });
}
