import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportFictionalComparison, compareFictionalObservations } from '../src/fictional-observation-comparison.ts';
import { fictionalPublicationDraftSchema } from '../src/fictional-publication-draft.ts';
const earlier = JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json', import.meta.url))).fictionalCandidate;
const later = JSON.parse(readFileSync(new URL('../fixtures/fictional_revised_update_report.json', import.meta.url))).fictionalCandidate;
function changedValue(value) { const draft = structuredClone(later); draft.observation.value = value; draft.publication.snapshot.claims[0].assertion = `In 2025, the fictional share was ${value}%.`; return fictionalPublicationDraftSchema.parse(draft); }
function varying(first, second, throws = false) {
  const counts = Object.fromEntries(Object.keys(first).map(key => [key, 0])), value = {};
  for (const key of Object.keys(first)) Object.defineProperty(value, key, { enumerable: true, get() {
    counts[key]++; if (throws && counts[key] > 1) throw Error('PRIVATE_SECOND_DRAFT_FAULT');
    return structuredClone((counts[key] === 1 ? first : second)[key]);
  } });
  return { value, counts };
}
function once(input) { assert.deepEqual(Object.values(input.counts), Object.keys(input.counts).map(() => 1)); }

test('comparison export keeps the earlier validated value rather than replacing it after calculation', () => {
  const input = varying(earlier, later), artifact = JSON.parse(exportFictionalComparison(input.value, later));
  assert.equal(artifact.before.value, '27.4'); assert.equal(artifact.after.value, '28.1'); assert.equal(artifact.deltaPercentagePoints, '+0.7'); once(input);
  assert.equal(artifact.before.sourceVersionId, earlier.decision.sourceVersionId);
  assert.equal(artifact.before.contentSha256, earlier.decision.contentSha256);
});

test('comparison export cannot combine a later negative value with an earlier positive delta', () => {
  const input = varying(later, changedValue('26.7')), artifact = JSON.parse(exportFictionalComparison(earlier, input.value));
  assert.equal(artifact.after.value, '28.1'); assert.equal(artifact.deltaPercentagePoints, '+0.7'); once(input);
});

test('a later invalid draft or getter fault cannot invalidate the first checked export pair', () => {
  const invalid = structuredClone(later); invalid.publication.snapshot.claims[0].assertion = 'PRIVATE_UNCHECKED_TEXT';
  for (const input of [varying(later, invalid), varying(later, later, true)]) {
    const artifact = JSON.parse(exportFictionalComparison(earlier, input.value));
    assert.equal(artifact.after.value, '28.1'); assert.equal(artifact.deltaPercentagePoints, '+0.7'); once(input);
    assert.doesNotMatch(JSON.stringify(artifact), /PRIVATE_/);
  }
});

test('first-invalid and first-faulting drafts stay held with the existing detail-free export error', () => {
  const fault = Object.defineProperty(structuredClone(later), 'observation', { enumerable: true, get() { throw Error('PRIVATE_FIRST_DRAFT_FAULT'); } });
  for (const draft of [null, { ...later, private: 'PRIVATE_EXTRA' }, fault, changedValue('100')]) {
    if (draft === null || draft === fault || Object.hasOwn(draft, 'private')) {
      assert.deepEqual(compareFictionalObservations(earlier, draft), { kind: 'held' });
      assert.throws(() => exportFictionalComparison(earlier, draft), error => error.message === 'Comparison cannot be exported');
    } else assert.equal(JSON.parse(exportFictionalComparison(earlier, draft)).deltaPercentagePoints, '+72.6');
  }
});

test('normal changed, same-version and different-version equal-value exports keep existing complete byte oracles', () => {
  const hashes = JSON.parse(readFileSync(new URL('../fixtures/fictional_comparison_export_byte_oracles.json', import.meta.url)));
  const same = changedValue('27.4'), originals = [earlier, later, same].map(JSON.stringify);
  for (const [index, draft] of [later, earlier, same].entries()) {
    const bytes = exportFictionalComparison(earlier, draft); assert.equal(createHash('sha256').update(bytes).digest('hex'), hashes[index]);
    const artifact = JSON.parse(bytes); assert.equal(artifact.state, 'draft'); assert.equal(artifact.publicChanges, 0);
    assert.equal(artifact.comparisonKind, 'same_period_source_revision'); assert.ok(bytes.endsWith('\n'));
  }
  assert.deepEqual([earlier, later, same].map(JSON.stringify), originals);
});

test('negative, same-period chronology and foreign-location controls retain established comparison holds', () => {
  const negative = changedValue('26.7'), reverse = structuredClone(later), foreign = structuredClone(later);
  reverse.publication.snapshot.claims[0].evidence[0].retrievedAt = earlier.publication.snapshot.claims[0].evidence[0].retrievedAt;
  foreign.decision.locator = 'different row'; foreign.publication.snapshot.claims[0].evidence[0].locator = 'different row';
  assert.equal(JSON.parse(exportFictionalComparison(earlier, negative)).deltaPercentagePoints, '−0.7');
  for (const draft of [reverse, foreign]) { assert.deepEqual(compareFictionalObservations(earlier, draft), { kind: 'held' }); assert.throws(() => exportFictionalComparison(earlier, draft), error => error.message === 'Comparison cannot be exported'); }
});
