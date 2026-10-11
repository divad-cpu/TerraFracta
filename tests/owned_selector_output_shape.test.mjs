import assert from 'node:assert/strict';
import test from 'node:test';
import { proposalBrowseSelection, capturedProposalHref } from '../src/operator-proposal-navigation.ts';
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('public proposal query preserves existing plain-object equality and frozen scalar output', () => {
  const input = { runId: id(1), decisionId: id(2), reason: 'material_conflict', returnToRuns: '1' };
  const selected = proposalBrowseSelection(input);
  assert.deepEqual(selected.query, input); assert.equal(Object.getPrototypeOf(selected.query), Object.prototype);
  assert.ok(Object.isFrozen(selected.query)); assert.deepEqual(Object.fromEntries(new URL(capturedProposalHref(selected.scope, selected.held), 'https://example.invalid').searchParams), input);
});
test('the public query copy stays bound to one owned observation after caller mutation', () => {
  let reads = 0; const input = { runId: id(1), get decisionId() { return ++reads === 1 ? id(2) : id(3); } };
  const selected = proposalBrowseSelection(input); input.runId = id(4);
  assert.equal(reads, 1); assert.deepEqual(selected.query, { runId: id(1), decisionId: id(2) });
  assert.throws(() => { selected.query.runId = id(4); }, TypeError); assert.equal(selected.scope.runId, id(1));
});
