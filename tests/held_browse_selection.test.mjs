import assert from 'node:assert/strict';import test from 'node:test';
import {heldBrowseSelection,heldBrowseHref,heldReasonFilter} from '../src/operator-held-browse.ts';
import {heldReasonCodes} from '../src/operator-held-decisions.ts';
import {heldScope,heldId} from './helpers/operator_held_fixture.mjs';
test('all existing closed reasons round-trip without changing the private run/cursor scope',()=>{
  const cursor={decidedAt:'2026-10-05T09:01:00.000001Z',decisionId:heldId(9)};
  for(const reason of ['',...heldReasonCodes])for(const scope of [heldScope(),heldScope(cursor)]){
    const url=new URL(heldBrowseHref(scope,reason),'https://example.invalid');assert.equal(url.pathname,'/editorial-preview/held');
    assert.deepEqual(heldBrowseSelection(Object.fromEntries(url.searchParams)),{scope,reason});
    assert.deepEqual(Object.keys(scope).sort(),['cursor','runId']);
  }
});
test('unknown, duplicate, inherited or private query values never become a filter or private scope',()=>{
  for(const reason of [null,[],['material_conflict'],{},'PRIVATE_CANARY','toString','__proto__',' material_conflict']){
    assert.equal(heldReasonFilter(reason),null);assert.equal(heldBrowseSelection({runId:heldId(1),reason}),null);
  }
  for(const q of [null,[],{}, {runId:heldId(1),sql:'PRIVATE_CANARY'}, {runId:[heldId(1)]}, {runId:heldId(1),reason:undefined}])assert.equal(heldBrowseSelection(q),null);
  const inherited=Object.assign(Object.create({reason:'material_conflict'}),{runId:heldId(1)});assert.deepEqual(heldBrowseSelection(inherited),{scope:heldScope(),reason:''});
});
test('partial or malformed continuation tuples refuse; empty reason remains all disclosed reasons',()=>{
  for(const q of [{beforeDecisionId:heldId(9)}, {beforeDecidedAt:'2026-10-05T09:01:00.000001Z'},
    {beforeDecisionId:heldId(9),beforeDecidedAt:'2026-10-05T09:01:00.0000011Z'},
    {beforeDecisionId:'PRIVATE_CANARY',beforeDecidedAt:'2026-10-05T09:01:00.000001Z'}])assert.equal(heldBrowseSelection({runId:heldId(1),reason:'material_conflict',...q}),null);
  assert.deepEqual(heldBrowseSelection({runId:heldId(1),reason:''}),{scope:heldScope(),reason:''});
});
test('an inherited cursor counterpart cannot complete an own partial tuple',()=>{
  const time='2026-10-05T09:01:00.000001Z',id=heldId(9);
  for(const input of [Object.assign(Object.create({beforeDecidedAt:time}),{runId:heldId(1),beforeDecisionId:id,reason:'material_conflict'}),
    Object.assign(Object.create({beforeDecisionId:id}),{runId:heldId(1),beforeDecidedAt:time,reason:'material_conflict'})])assert.equal(heldBrowseSelection(input),null);
  assert.deepEqual(heldBrowseSelection({runId:heldId(1),beforeDecidedAt:time,beforeDecisionId:id,reason:'material_conflict'}),{scope:heldScope({decidedAt:time,decisionId:id}),reason:'material_conflict'});
});
