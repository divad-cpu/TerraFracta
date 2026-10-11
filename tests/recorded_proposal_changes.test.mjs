import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRecordedProposalSnapshots as compare } from '../src/recorded-proposal-changes.ts';
import { proposedPayload, proposalId } from './helpers/proposal_fixture.mjs';

const snapshot = () => proposedPayload().snapshot;
const extra = (s, n) => ({ ...structuredClone(s.claims[0]), id: proposalId(n) });
test('identical snapshots preserve inputs and report every statement unchanged', () => {
  const base = snapshot(), proposed = structuredClone(base), before = JSON.stringify([base, proposed]);
  assert.deepEqual(compare(base, proposed), {baseAbsent:false, snapshotFields:[], statementOrderChanged:false,
    counts:{added:0,removed:0,changed:0,unchanged:1},statements:[]});
  assert.equal(JSON.stringify([base, proposed]), before);
});
test('title, summary and recorded review date are separate page differences', () => {
  const base = snapshot();
  for (const [field, value] of [['title','Another title'], ['summary','Another summary.'], ['lastEvidenceReviewOn','2026-09-29']]) {
    const proposed = structuredClone(base); proposed[field] = value;
    const result = compare(base, proposed); assert.deepEqual(result.snapshotFields, [field]);
    assert.equal(result.counts.unchanged,1); assert.equal(result.counts.changed,0);
  }
});
test('statement type, exact wording and period changes retain exact identity', () => {
  const base = snapshot();
  for (const [field, value] of [['type','policy_action'], ['assertion','The invented share was 7.5%.'], ['periodLabel','2025–2026']]) {
    const proposed = structuredClone(base); proposed.claims[0][field] = value;
    const result = compare(base, proposed);
    assert.deepEqual(result.counts,{added:0,removed:0,changed:1,unchanged:0});
    assert.deepEqual(result.statements[0].fields,[field]); assert.equal(result.statements[0].id,proposalId(3));
    assert.equal(result.statements[0].before,base.claims[0]); assert.equal(result.statements[0].after,proposed.claims[0]);
  }
});
test('every recorded source-reference field participates in equality', () => {
  const base = snapshot();
  const replacements = {sourceVersionId:proposalId(90),publisher:'Other publisher',title:'Other title',url:'https://example.org/other',
    locator:'invented row 3',relation:'context',sourcePublishedOn:'2026-09-27',retrievedAt:'2026-09-28T06:00:00.000002Z'};
  for (const [field,value] of Object.entries(replacements)) {
    const proposed=structuredClone(base); proposed.claims[0].evidence[0][field]=value;
    assert.deepEqual(compare(base,proposed).statements[0].fields,['evidence'],field);
  }
});
test('source-reference order and repeated references are preserved; object key order is immaterial', () => {
  const base=snapshot(), reordered=structuredClone(base), repeated=structuredClone(base), keys=structuredClone(base);
  reordered.claims[0].evidence.reverse(); repeated.claims[0].evidence.push(structuredClone(repeated.claims[0].evidence[0]));
  keys.claims[0].evidence=keys.claims[0].evidence.map(e=>Object.fromEntries(Object.entries(e).reverse()));
  assert.deepEqual(compare(base,reordered).statements[0].fields,['evidence']);
  assert.deepEqual(compare(base,repeated).statements[0].fields,['evidence']);
  assert.equal(compare(base,keys).counts.unchanged,1); assert.equal(repeated.claims[0].evidence.length,3);
});
test('same wording under a different ID is an addition and removal, never a fuzzy match', () => {
  const base=snapshot(), proposed=structuredClone(base); proposed.claims[0].id=proposalId(20);
  const result=compare(base,proposed);
  assert.deepEqual(result.counts,{added:1,removed:1,changed:0,unchanged:0});
  assert.deepEqual(result.statements.map(x=>[x.id,x.kind,x.beforeIndex,x.afterIndex]),[
    [proposalId(20),'added',null,0],[proposalId(3),'removed',0,null]]);
  assert.equal(result.statementOrderChanged,false);
});
test('changed/addition rows use proposed order; removals use base order; unchanged rows are counted', () => {
  const base=snapshot(); base.claims.push(extra(base,20),extra(base,21),extra(base,22));
  const proposed=structuredClone(base); proposed.claims=[proposed.claims[3],extra(proposed,30),proposed.claims[0]];
  proposed.claims[2].assertion='Changed invented wording.';
  const result=compare(base,proposed);
  assert.deepEqual(result.counts,{added:1,removed:2,changed:1,unchanged:1});
  assert.deepEqual(result.statements.map(x=>[x.id,x.kind]),[[proposalId(30),'added'],[proposalId(3),'changed'],[proposalId(20),'removed'],[proposalId(21),'removed']]);
  assert.equal(result.statementOrderChanged,false);
});
test('same ID set reordered is reported separately from unchanged fields', () => {
  const base=snapshot(); base.claims.push(extra(base,20)); const proposed=structuredClone(base); proposed.claims.reverse();
  const result=compare(base,proposed); assert.equal(result.statementOrderChanged,true);
  assert.deepEqual(result.counts,{added:0,removed:0,changed:0,unchanged:2});assert.deepEqual(result.statements,[]);
});
test('witnessed absent base yields additions without inventing removed or changed content', () => {
  const proposed=snapshot(); proposed.claims.push(extra(proposed,20));const result=compare(null,proposed);
  assert.equal(result.baseAbsent,true);assert.deepEqual(result.snapshotFields,[]);assert.equal(result.statementOrderChanged,false);
  assert.deepEqual(result.counts,{added:2,removed:0,changed:0,unchanged:0});assert.ok(result.statements.every(x=>x.before===null&&x.kind==='added'));
});
