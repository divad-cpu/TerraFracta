import assert from 'node:assert/strict';
import test from 'node:test';
import {createSelectedHtmlInitialCandidateCaptureReader as create} from '../src/server/html-initial-candidate-capture-selection.ts';
import {htmlInitialOwnerFixture as fixture} from './helpers/html_initial_owner_fixture.mjs';
for(const phase of [0,1,2])test('HTML initial thrown clock phase '+phase+' withholds output and preserves opaque bounded outcome',async()=>{
 const f=fixture();let calls=0,reads=0;const codes=[];
 const read=create(async()=>{reads++;return f.raw;},()=>{if(calls++===phase)throw Error('INVENTED_PRIVATE_CLOCK');return 0;},async code=>{codes.push(code);return 'saved';});
 const result=await read(f.input);
 assert.deepEqual(result,{kind:'unavailable'});assert.equal(reads,0);
 assert.deepEqual(codes,phase===0?[]:['operator_audit_read']);
});
