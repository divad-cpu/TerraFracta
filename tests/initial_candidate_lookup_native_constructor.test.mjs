import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
// Evaluate only the literal constructor expression from the actual new bridge,
// never its stdin/socket/driver entry point. This opens no physical connection.
function constructor(){const s=readFileSync(new URL('../scripts/check_initial_candidate_lookup_native.mjs',import.meta.url),'utf8'),start=s.indexOf('owner=createPostgresReadOwner('),end=s.indexOf(';const transport=',start);assert.ok(start>=0&&end>start);const expression=s.slice(start+'owner='.length,end);assert.ok(expression.endsWith(',factory)'));return expression;}
function environment(t){const original=process.env.NODE_ENV;process.env.NODE_ENV='development';t.after(()=>{if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original;});}
function construct(expression,factory){return Function('createPostgresReadOwner','factory','"use strict";return ('+expression+');')(createPostgresReadOwner,factory);}
test('actual fixed Unix laboratory constructor admits development owner without acquiring any client',async t=>{environment(t);let acquired=0;const owner=construct(constructor(),async()=>{acquired++;assert.fail('No socket/client');});assert.equal(owner.user,'postgres');assert.equal(await owner.shutdown(),true);assert.equal(acquired,0);});
test('unchanged owner still refuses TLS-required loopback and production despite the laboratory correction',async t=>{environment(t);let acquired=0;const expression=constructor();const requireTls=expression.replace(",'terrafracta.operator-audit',false,factory)",",'terrafracta.operator-audit',true,factory)");assert.notEqual(requireTls,expression);assert.throws(()=>construct(requireTls,async()=>{acquired++;}),/^Error: read_unavailable$/);process.env.NODE_ENV='production';assert.throws(()=>construct(expression,async()=>{acquired++;}),/^Error: read_unavailable$/);assert.equal(acquired,0);});
