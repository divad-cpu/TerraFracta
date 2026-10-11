import assert from 'node:assert/strict';
import test from 'node:test';
import { findIllustrativeIssues, findIllustrativeCountries, sampleCorrectionSection } from '../src/visitor-catalog.ts';

test('sample correction uses the one section it validated rather than a later unvalidated target', () => {
  let reads = 0;
  const input = { get section() { return ++reads < 4 ? 'problem' : 'PRIVATE_CANARY'; } };
  assert.equal(sampleCorrectionSection(input), 'problem'); assert.equal(reads, 1);
});
test('illustrative issue and country search capture the first query once', () => {
  for (const find of [findIllustrativeIssues, findIllustrativeCountries]) {
    let reads = 0;
    const result = find({ get q() { return ++reads === 1 ? 'Norway' : 'PRIVATE_CANARY'; } });
    assert.equal(result.kind, 'valid'); assert.equal(result.query, 'Norway'); assert.equal(reads, 1);
    assert.equal((result.issues ?? result.countries).length, 1);
  }
});
test('illustrative topic is captured once and unavailable values remain invalid', () => {
  let reads = 0;
  const result = findIllustrativeIssues({ q: 'housing', get topic() { return ++reads === 1 ? 'housing' : 'PRIVATE_CANARY'; } });
  assert.equal(result.kind, 'valid'); assert.equal(result.topic, 'housing'); assert.equal(reads, 1);
  assert.equal(findIllustrativeIssues({ topic: 'PRIVATE_CANARY' }).kind, 'invalid');
});
test('unsupported own keys veto before known getters and enumeration or value faults refuse safely', () => {
  for (const [find, key, invalid] of [[findIllustrativeIssues, 'q', 'invalid'], [findIllustrativeCountries, 'q', 'invalid'], [sampleCorrectionSection, 'section', 'invalid']]) {
    const invalidResult = value => assert.equal(typeof value === 'string' ? value : value.kind, invalid);
    invalidResult(find({ extra: 'PRIVATE_CANARY', get [key]() { assert.fail('Foreign keys must veto before known getter'); } }));
    invalidResult(find({ get [key]() { throw Error('PRIVATE_CANARY'); } }));
    invalidResult(find(new Proxy({}, { ownKeys() { throw Error('PRIVATE_CANARY'); } })));
  }
});
test('inherited selectors never provide a search or correction section', () => {
  let reads = 0; const inherited = Object.create({ get q() { reads++; return 'PRIVATE_CANARY'; }, get section() { reads++; return 'problem'; } });
  assert.equal(findIllustrativeIssues(inherited).query, ''); assert.equal(findIllustrativeCountries(inherited).query, '');
  assert.equal(sampleCorrectionSection(inherited), null); assert.equal(reads, 0);
});
test('a deleted later own field cannot borrow an inherited selection during capture', () => {
  const input = Object.create({ topic: 'housing' });
  Object.defineProperty(input, 'q', { enumerable: true, get() { delete input.topic; return 'Norway'; } });
  Object.defineProperty(input, 'topic', { configurable: true, enumerable: true, value: 'housing' });
  assert.equal(findIllustrativeIssues(input).kind, 'invalid');
  const hidden = { get q() { Object.defineProperty(hidden, 'topic', { enumerable: false }); return 'Norway'; }, topic: 'housing' };
  assert.equal(findIllustrativeIssues(hidden).kind, 'invalid');
});
test('existing closed scalar grammar default searches and four sections remain unchanged', () => {
  for (const input of [{}, { q: undefined }, { q: '' }, { q: 'Ｎｏｒｗａｙ', topic: 'housing' }]) assert.equal(findIllustrativeIssues(input).kind, 'valid');
  assert.equal(findIllustrativeCountries({ q: 'Norge' }).countries.length, 1);
  assert.equal(findIllustrativeIssues({ q: 'missing' }).issues.length, 0);
  for (const section of ['problem', 'response', 'uncertainty', 'sources']) assert.equal(sampleCorrectionSection({ section }), section);
  assert.equal(sampleCorrectionSection({}), null); assert.equal(sampleCorrectionSection({ section: undefined }), null);
  for (const input of [null, [], { section: ['problem'] }, { section: 'constructor' }, { section: 'PRIVATE_CANARY' }]) assert.equal(sampleCorrectionSection(input), 'invalid');
  for (const input of [null, [], { q: ['Norway'] }, { q: '\u0000' }, { q: 'x'.repeat(81) }]) { assert.equal(findIllustrativeIssues(input).kind, 'invalid'); assert.equal(findIllustrativeCountries(input).kind, 'invalid'); }
});
