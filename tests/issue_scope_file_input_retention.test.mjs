import assert from 'node:assert/strict';
import test from 'node:test';
import { scopeDraftHarness } from './helpers/scope_draft_harness.mjs';
import { capturedScopeDraftContext } from '../src/server/issue-scope-draft.ts';
import { scopeDraftJson, SCOPE_DRAFT_BYTES } from '../src/issue-scope-draft.ts';
import { proposalReport } from './helpers/proposal_fixture.mjs';
const field = (h, tag, end) => h.nodes().find(n => n.type === tag && n.props.id?.endsWith(end))?.props ?? assert.fail(end);
const button = (h, label) => h.nodes().find(n => n.type === 'button' && n.props.children === label)?.props ?? assert.fail(label);
const output = h => h.nodes().find(n => n.type === 'textarea' && n.props.readOnly)?.props.value;
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const choose = (h, file) => field(h, 'input', '-file').onChange({ currentTarget: { value: 'PRIVATE_NAME', files: file === undefined ? [] : [file] } });
const encoded = raw => new TextEncoder().encode(raw);
const bytesFile = bytes => ({ size: bytes.byteLength, slice() { return { arrayBuffer: async () => bytes.buffer }; } });
function prepared(t) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  const context = capturedScopeDraftContext(proposalReport()), h = scopeDraftHarness(context);
  const candidate = wording => ({ schemaVersion: 1, kind: 'issue_scope_preparation', binding: context.binding,
    fields: { population: { wording, references: [{ claimId: context.claims[0].id, referenceNumber: 2 }] }, period: null, selectionRationale: null } });
  const pasted = scopeDraftJson(candidate('Exact saved source wording'), context);
  h.mount(); field(h, 'textarea', '-reopen-json').onChange({ currentTarget: { value: pasted } }); button(h, 'Reopen scope preparation').onClick();
  field(h, 'textarea', '-population-wording').onChange({ currentTarget: { value: 'Unfinished retained scope wording' } }); button(h, 'Review scope draft').onClick();
  const json = output(h); assert.equal(JSON.parse(json).fields.population.wording, 'Unfinished retained scope wording');
  return { h, context, candidate, pasted, json, references: [`${context.claims[0].id}:2`] };
}
function retained(p) {
  assert.equal(field(p.h, 'textarea', '-population-wording').value, 'Unfinished retained scope wording', 'unfinished scope wording retained');
  assert.deepEqual(field(p.h, 'select', '-population-references').value, p.references, 'exact selected occurrences retained');
  assert.equal(field(p.h, 'textarea', '-reopen-json').value, p.pasted, 'exact pasted text retained');
  assert.equal(output(p.h), undefined, 'old preview withheld');
}
for (const kind of ['cancelled', 'invalid UTF8', 'foreign comparison', 'oversize']) test(`${kind} scope File retains editable wording references and pasted text`, async t => {
  const p = prepared(t); try {
    const file = kind === 'cancelled' ? undefined : kind === 'invalid UTF8' ? bytesFile(new Uint8Array([255, 255]))
      : kind === 'foreign comparison' ? bytesFile(encoded(p.pasted.replace(p.context.binding.captureId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')))
      : { size: SCOPE_DRAFT_BYTES + 1, slice() { assert.fail('Oversize bytes must not be read'); } };
    choose(p.h, file); await tick(); retained(p);
    button(p.h, 'Review scope draft').onClick(); assert.equal(output(p.h), p.json, 'retained fields remain representable for explicit reinspection');
  } finally { p.h.unmount(); }
});
test('scope pending busy and retired late File result preserve unfinished inputs and physical read ownership', async t => {
  const p = prepared(t), bytes = encoded(p.pasted); let settle;
  try {
    choose(p.h, { size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } });
    assert.equal(field(p.h, 'input', '-file').disabled, true);
    choose(p.h, { get size() { assert.fail('Busy File cannot be inspected'); } }); retained(p);
    settle(bytes.buffer); await tick(); retained(p); assert.equal(field(p.h, 'input', '-file').disabled, false);
  } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
});
test('scope deadline withholds late output but retains editable inputs until actual File settlement', async t => {
  let clock = 0, expire; const originalTimeout = setTimeout;
  t.mock.method(performance, 'now', () => clock);
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => delay === 8000 ? (expire = callback, 0) : originalTimeout(callback, delay, ...args));
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const p = prepared(t), bytes = encoded(p.pasted); let settle;
  try {
    choose(p.h, { size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } });
    clock = 8000; expire(); retained(p); assert.equal(field(p.h, 'input', '-file').disabled, true);
    settle(bytes.buffer); await tick(); retained(p); assert.equal(field(p.h, 'input', '-file').disabled, false);
  } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
});
test('malformed scope selector preserves all editable fields while withholding copied output', async t => {
  const p = prepared(t); try {
    field(p.h, 'input', '-file').onChange({ get currentTarget() { throw Error('PRIVATE_SELECTOR'); } }); await tick(); retained(p);
  } finally { p.h.unmount(); }
});
test('only successful exact owned scope reopening replaces fields and clears the independently pasted text', async t => {
  const p = prepared(t); try {
    const json = scopeDraftJson(p.candidate('Explicit File replacement'), p.context);
    choose(p.h, bytesFile(encoded(json))); await tick(); assert.equal(output(p.h), json);
    assert.equal(field(p.h, 'textarea', '-population-wording').value, 'Explicit File replacement');
    assert.deepEqual(field(p.h, 'select', '-population-references').value, p.references);
    assert.equal(field(p.h, 'textarea', '-reopen-json').value, '');
  } finally { p.h.unmount(); }
});
test('late scope File cannot restore data discarded by explicit Clear or comparison replacement', async t => {
  for (const action of ['clear', 'context', 'unmount']) {
    const p = prepared(t), bytes = encoded(p.pasted); let settle;
    try {
      choose(p.h, { size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } });
      if (action === 'clear') button(p.h, 'Clear scope draft').onClick();
      else if (action === 'context') { const next = structuredClone(p.context); next.binding.captureId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; p.h.render(next); p.h.commit(); }
      else p.h.unmount();
      settle(bytes.buffer); await tick(); assert.equal(output(p.h), undefined);
      if (action !== 'unmount') { assert.equal(field(p.h, 'textarea', '-population-wording').value, ''); assert.equal(field(p.h, 'textarea', '-reopen-json').value, ''); }
    } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
  }
});
