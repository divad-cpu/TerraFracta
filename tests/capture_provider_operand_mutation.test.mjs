import assert from 'node:assert/strict';import test from 'node:test';
import {createPostgresHtmlAppendedCaptureTransport as whole} from '../src/server/postgres-html-appended-capture-provider.ts';
import {HTML_APPENDED_CAPTURE_READ_SQL as wholeSql} from '../src/server/html-appended-issue-capture.ts';
import {createPostgresInitialCandidateCaptureTransport as initial} from '../src/server/postgres-initial-candidate-capture-provider.ts';
import {INITIAL_CANDIDATE_CAPTURE_READ_SQL as initialSql} from '../src/server/initial-candidate-capture.ts';
for(const [name,create,sql] of [['HTML whole',whole,wholeSql],['plain initial',initial,initialSql]])for(const mode of ['key swap','length change'])test(name+' provider rejects operand index getter '+mode+' before owner admission',async()=>{
 const id='90000000-0000-4000-8000-000000000004',values=[id];let admissions=0;Object.defineProperty(values,'0',{enumerable:true,configurable:true,get(){if(mode==='key swap'){delete values[0];values.foreign='PRIVATE';}else values.length=2;return id;}});
 const owner={user:'postgres',shutdown:async()=>true,run:async()=>{admissions++;return new Uint8Array([123,125]);}};await assert.rejects(create(owner).readCapture({sql,values},new AbortController().signal));assert.equal(admissions,0);
});
