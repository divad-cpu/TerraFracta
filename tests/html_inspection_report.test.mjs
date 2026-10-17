import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { htmlInspectionReport as parse } from '../src/server/html-inspection-report.ts';
import { htmlInspectionVectors } from './helpers/html_inspection_vectors.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/fictional-html-inspection.json', import.meta.url), 'utf8'));
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const vectors = htmlInspectionVectors();
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function manifest(r, mutate) {
  const m = JSON.parse(r.current.derivation_manifest_json); mutate(m);
  r.current.derivation_manifest_json = canonical(m);
  r.current.derivation_manifest_sha256 = sha(r.current.derivation_manifest_json);
}

test('actual Python fixture joins selected text, two originals and distinct original/derived identities', () => {
  const r = parse(fixture()); assert.ok(r);
  assert.equal(r.current.passages[1].text, 'Revised invented wording with <em>quoted markup</em>.');
  assert.equal(r.previous.passages[1].text, 'Earlier invented wording.');
  assert.equal(r.selection.state, 'ready'); assert.deepEqual(r.selection.unchanged_locators, ['context:one']);
  assert.notEqual(r.current.content_sha256, r.current.passages[1].text_sha256);
  assert.equal(r.limits.storage, 'not_observed'); assert.equal(r.review_state, 'unverified');
});

test('real producer first observation, same original, changed wrapping, Unicode grouping and payload-limit hold cross the consumer', () => {
  for (const [name, report] of Object.entries(vectors)) assert.ok(parse(report), name);
  assert.equal(vectors.first.previous, null); assert.equal(vectors.first.source_bytes_changed, null);
  assert.equal(vectors.identical.selection.reason_code, 'passages_unchanged');
  assert.equal(vectors.wrapping.selection.reason_code, 'source_changed_passages_unchanged');
  assert.equal(vectors.wrapping.request, null);
  assert.equal(JSON.parse(vectors.unicode.selection.payload_json).passages.length, 1);
  assert.deepEqual(JSON.parse(vectors.unicode.selection.payload_json).passages[0].locators, ['one', 'two']);
  assert.equal(vectors.held.selection.state, 'held'); assert.equal(vectors.held.selection.reason_code, 'passage_payload_limit');
  assert.equal(vectors.held.selection.payload_json, null);
});

test('unknown fields, trust escalation, wrong source scope and original inclusion withhold the whole report', () => {
  for (const mutate of [r => r.approval = true, r => r.review_state = 'approved', r => r.limits.rendered_visibility_verified = true,
    r => r.limits.storage = 'stored', r => r.limits.rights = 'approved', r => r.limits.publication = 'authorized',
    r => r.current.raw_html = '<script>PRIVATE</script>', r => r.current.source_key = 'real-source',
    r => r.current.source_url = 'https://example.org/a?token=PRIVATE', r => r.current.source_url = 'https://elsewhere.invalid/a',
    r => r.current.source_url = 'javascript:alert(1)', r => r.current.passages[0].extra = 'PRIVATE']) {
    const r = fixture(); mutate(r); assert.equal(parse(r), null);
  }
});

test('derived hashes and complete manifest metadata are checked even after a caller reseals the manifest', () => {
  for (const mutate of [r => r.current.passages[0].text += 'PRIVATE', r => r.current.passages[0].text_sha256 = 'f'.repeat(64),
    r => r.current.derivation_manifest_sha256 = 'f'.repeat(64),
    r => manifest(r, m => m.source_version_id = 'foreign-version'), r => manifest(r, m => m.spans[0].start++),
    r => manifest(r, m => m.spans[0].raw_sha256 = 'f'.repeat(64)), r => manifest(r, m => m.language_code = 'no'),
    r => manifest(r, m => m.spans[0].derived_text_sha256 = 'f'.repeat(64)), r => manifest(r, m => m.original_bytes++),
    r => manifest(r, m => m.rendered_visibility_verified = true), r => manifest(r, m => m.extra = 'PRIVATE')]) {
    const r = fixture(); mutate(r); assert.equal(parse(r), null);
  }
  const duplicate = fixture(); duplicate.current.derivation_manifest_json = duplicate.current.derivation_manifest_json.replace('{', '{"schema_version":1,');
  duplicate.current.derivation_manifest_sha256 = sha(duplicate.current.derivation_manifest_json); assert.equal(parse(duplicate), null);
});

test('selection and request joins cannot reclassify changed or unchanged parsed text', () => {
  for (const mutate of [r => r.selection.state = 'no_model_work', r => r.selection.reason_code = 'passages_unchanged',
    r => r.selection.unchanged_locators = [], r => r.selection.removed_locators = ['article:one'],
    r => r.selection.payload_json = null, r => r.selection.payload_sha256 = 'f'.repeat(64),
    r => r.request.selected_payload_sha256 = 'f'.repeat(64), r => r.source_bytes_changed = false]) {
    const r = fixture(); mutate(r); assert.equal(parse(r), null);
  }
  const wrapping = structuredClone(vectors.wrapping); wrapping.request = fixture().request; assert.equal(parse(wrapping), null);
  const held = structuredClone(vectors.held); held.selection.state = 'ready'; assert.equal(parse(held), null);
});

test('both-vintage identity, selection continuity and microsecond order are mandatory', () => {
  for (const mutate of [r => delete r.previous, r => r.previous = {}, r => r.previous.mapping_sha256 = 'f'.repeat(64),
    r => r.previous.source_url = 'https://example.org/other', r => r.previous.passages[0].element_id = 'moved',
    r => r.previous.source_version_id = r.current.source_version_id, r => r.source_bytes_changed = null,
    r => r.current.retrieved_at = '2026-10-16T02:00:00.000008Z', r => r.observed_at = '0000-01-01T00:00:00.000000Z']) {
    const r = fixture(); mutate(r); assert.equal(parse(r), null);
  }
  const first = structuredClone(vectors.first); first.source_bytes_changed = false; assert.equal(parse(first), null);
});

test('scalar, byte, span and total report bounds reject malformed supplied data', () => {
  for (const mutate of [r => r.current.passages[0].text = '\ud800', r => r.current.passages[0].text = '   ',
    r => r.current.passages[0].text = '😀'.repeat(2049), r => r.current.original_bytes = 65537,
    r => r.current.passages[0].start = true, r => r.current.passages[0].end = r.current.original_bytes+1,
    r => r.current.passages.push(r.current.passages[0]), r => r.request.maximum_output_tokens = true,
    r => r.request.maximum_output_tokens = 1000001, r => r.request.body_bytes = 131073]) {
    const r = fixture(); mutate(r); assert.equal(parse(r), null);
  }
});

test('omitted originals and request bytes remain unverified even with a consistent admitted report', () => {
  const r = fixture(); r.request.request_sha256 = 'e'.repeat(64);
  assert.ok(parse(r), 'opaque request identity is not authenticated by omitted bytes');
  assert.equal(parse(r).limits.storage, 'not_observed'); assert.equal(parse(r).limits.semantic_support, 'not_assessed');
});


test('Python BOM text and BOM or interior NEL metadata retain producer parity', () => {
  for (const key of ['bom_text', 'bom_item', 'nel_item', 'nel_locator']) assert.ok(parse(vectors[key]), key);
  assert.equal(parse(vectors.bom_text).current.passages[0].text, '\ufeff');
  assert.equal(parse(vectors.bom_item).current.item_key, '\ufeffitem');
  assert.equal(parse(vectors.nel_item).current.item_key, 'item\u0085key');
  assert.equal(parse(vectors.nel_locator).current.passages[0].locator, 'one\u0085locator');
});
