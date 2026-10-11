// Fictional fixed private stdin only; actual pinned pg, TLS and production seam.
// Generated credentials and unrestricted driver diagnostics are never emitted.
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {createPostgresWorkProposalTransport,POSTGRES_WORK_PROPOSAL_SQL} from '../src/server/postgres-work-proposal-transport.ts';
if(process.argv.length!==2)throw Error('fixed_trial_only');
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>524288)throw Error('fixed_input_limit');}
const value=JSON.parse(input);assert.ok(['capture','recover'].includes(value.mode));
let release,clients=[];const diagnostics=[];
const factory=async options=>{
 const c=new Client(options);clients.push(c);
 const query=c.query.bind(c),end=c.end.bind(c);
 if(value.fault==='lost-receipt')c.query=async q=>{const result=await query(q);if(q.text===POSTGRES_WORK_PROPOSAL_SQL)throw Error('fixed_lost_receipt_after_actual_query');return result;};
 if(value.fault==='close-no-ack')c.end=async()=>{await end();await new Promise(resolve=>{release=resolve;});};
 return c;
};
const transport=createPostgresWorkProposalTransport(value.configuration,factory,undefined,async code=>{assert.equal(code,'proposal_capture_write');diagnostics.push(code);return 'saved';});
const parent=new AbortController();if(value.preabort)parent.abort();
const result=await(value.mode==='capture'?transport.capture(value.work,value.selection,value.payload,parent.signal):transport.recover(value.work,value.selection,value.report,parent.signal));
await new Promise(resolve=>setImmediate(resolve));let drained=await transport.shutdown();
if(value.fault==='close-no-ack'){assert.equal(drained,false);assert.equal(typeof release,'function');release();await new Promise(resolve=>setImmediate(resolve));drained=await transport.shutdown();}
assert.equal(drained,true);
// Fixed outcome and strict receipt contain no credentials or source content.
console.log(JSON.stringify({result,diagnostics,drained,clients:clients.length,actualPg:true}));
