import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { fictionalPublicationDraftSchema } from '../src/fictional-publication-draft.ts';
import { compareFictionalObservations, exportFictionalComparison } from '../src/fictional-observation-comparison.ts';
const initial = JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json', import.meta.url))).fictionalCandidate;
const revised = JSON.parse(readFileSync(new URL('../fixtures/fictional_revised_update_report.json', import.meta.url))).fictionalCandidate;
const Comparison = loadTsx(new URL('../app/update-preview/comparison.tsx', import.meta.url)).FictionalComparison;
function pair(leftInstant = '2026-09-28T06:00:00Z', rightInstant = leftInstant) {
  const left = structuredClone(initial), right = structuredClone(revised);
  right.observation.value = left.observation.value;
  right.publication.snapshot.claims[0].assertion = left.publication.snapshot.claims[0].assertion;
  left.publication.snapshot.claims[0].evidence[0].retrievedAt = leftInstant;
  right.publication.snapshot.claims[0].evidence[0].retrievedAt = rightInstant;
  return [fictionalPublicationDraftSchema.parse(left), fictionalPublicationDraftSchema.parse(right)];
}
function render([baseline, candidate]) { return renderToStaticMarkup(createElement(Comparison, { baseline, candidate })); }
function tied(html) {
  for (const text of ['First recorded source version', 'Second recorded source version', 'First recorded illustrative source',
    'Second recorded illustrative source', 'Recorded source version: first', 'Recorded source version: second',
    'Their source-publication order is not established by this comparison.']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Earlier source version|New source version|Earlier illustrative source|New illustrative source|Recorded source version: earlier|Recorded source version: new/);
}
test('distinct versions with the same exact retrieval instant retain unknown source chronology in all visible labels', () => {
  const inputs = pair(), unchanged = structuredClone(inputs), bytes = exportFictionalComparison(...inputs);
  assert.notEqual(inputs[0].decision.sourceVersionId, inputs[1].decision.sourceVersionId);
  assert.equal(compareFictionalObservations(...inputs).kind, 'unchanged'); tied(render(inputs));
  assert.equal(exportFictionalComparison(...inputs), bytes); assert.deepEqual(inputs, unchanged);
  const artifact = JSON.parse(bytes); assert.equal(artifact.deltaPercentagePoints, '0.0'); assert.equal(artifact.publicChanges, 0); assert.equal(artifact.state, 'draft');
});
test('equivalent admitted fraction spellings describe a tied instant without hiding their recorded text', () => {
  const inputs = pair('2026-09-28T06:00:00Z', '2026-09-28T06:00:00.000000Z');
  const html = render(inputs); tied(html);
  for (const draft of inputs) assert.ok(html.includes(`dateTime="${draft.publication.snapshot.claims[0].evidence[0].retrievedAt}"`));
});
test('a strictly later microsecond preserves the ordered labels rather than inventing a tie through Date rounding', () => {
  const inputs = pair('2026-09-28T06:00:00.000001Z', '2026-09-28T06:00:00.000002Z');
  const html = render(inputs); assert.ok(html.includes('Earlier source version')); assert.ok(html.includes('New source version'));
  assert.doesNotMatch(html, /Their source-publication order is not established|First recorded source version|Second recorded source version/);
});
