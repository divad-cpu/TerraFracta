import assert from 'node:assert/strict';
import test from 'node:test';
import { responsibilityDraftHarness } from './helpers/responsibility_draft_harness.mjs';
import { proposalReport } from './helpers/proposal_fixture.mjs';
import { encodeProposalCapture } from '../src/server/proposal-capture.ts';
import { capturedScopeDraftContext } from '../src/server/issue-scope-draft.ts';
import { plannedMilestoneDraftFieldLabels, plannedMilestoneDraftJson, PLANNED_MILESTONE_DRAFT_BYTES } from '../src/planned-milestone-draft.ts';

const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const node = (h, predicate) => h.nodes().find(predicate);
const button = (h, text) => node(h, n => n.type === 'button' && [n.props.children].flat().join('') === text) ?? assert.fail(text);
const click = (h, text) => button(h, text).props.onClick();
const paste = h => node(h, n => n.type === 'textarea' && n.props.id?.endsWith('-paste'));
const output = h => node(h, n => n.type === 'textarea' && n.props.readOnly)?.props.value;
const file = h => node(h, n => n.type === 'input' && n.props.type === 'file');
const choose = (h, value) => file(h).props.onChange({ currentTarget: { files: value === undefined ? [] : [value], value: 'private-path' } });
function prepared(t) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson);
  payload.snapshot.claims[0].type = 'policy_action';
  Object.assign(report.capture, encodeProposalCapture(payload));
  const context = capturedScopeDraftContext(report);
  const draft = wording => ({ schemaVersion: 1, kind: 'planned_milestone_preparation', binding: context.binding,
    entries: [{ claimId: context.claims[0].id, fields: Object.fromEntries(Object.keys(plannedMilestoneDraftFieldLabels).map(field =>
      [field, field === 'description' ? { wording, references: [{ claimId: context.claims[0].id, referenceNumber: 2 }] } : null])) }] });
  const json = plannedMilestoneDraftJson(draft('Retained unverified milestone'), context);
  const h = responsibilityDraftHarness(context, undefined, { url: new URL('../src/planned-milestone-draft-view.tsx', import.meta.url), name: 'PlannedMilestoneDraftView' });
  h.mount(); paste(h).props.onChange({ currentTarget: { value: json } }); click(h, 'Reopen milestone preparation');
  assert.equal(output(h), json);
  const milestone = node(h, n => n.props.name === '1.description');
  return { h, context, json, draft, milestone, references: [`${context.claims[0].id}:2`] };
}
function retained(p) {
  assert.equal(node(p.h, n => n.props.name === '1.description')?.props.defaultValue, 'Retained unverified milestone', 'unfinished milestone row remains');
  assert.deepEqual(node(p.h, n => n.props.name === '1.descriptionReferences')?.props.value, p.references, 'selected reference occurrences remain');
  assert.equal(paste(p.h).props.value, p.json, 'exact pasted text remains');
  assert.equal(output(p.h), undefined, 'previous preview is withheld');
}
const bytesFile = bytes => ({ size: bytes.byteLength, slice() { return { arrayBuffer: async () => bytes.buffer }; } });

test('empty File selection retains milestone inputs while retiring old preview', async t => {
  const p = prepared(t); try { choose(p.h, undefined); await tick(); retained(p); } finally { p.h.unmount(); }
});
test('invalid UTF8 File retains milestone inputs and references', async t => {
  const p = prepared(t); try { choose(p.h, bytesFile(new Uint8Array([255, 255]))); await tick(); retained(p); } finally { p.h.unmount(); }
});
test('foreign-comparison File retains milestone inputs without installing foreign content', async t => {
  const p = prepared(t); try {
    const foreign = p.json.replace(p.context.binding.captureId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    choose(p.h, bytesFile(new TextEncoder().encode(foreign))); await tick(); retained(p);
  } finally { p.h.unmount(); }
});
test('oversize File retains milestone inputs before any source byte read', async t => {
  const p = prepared(t); try {
    choose(p.h, { size: PLANNED_MILESTONE_DRAFT_BYTES + 1, slice() { assert.fail('Oversize bytes must not be read'); } });
    await tick(); retained(p);
  } finally { p.h.unmount(); }
});
test('pending and busy File attempts retain inputs and a late retired result cannot replace them', async t => {
  const p = prepared(t), bytes = new TextEncoder().encode(p.json); let settle;
  try {
    choose(p.h, { size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } });
    assert.equal(file(p.h).props.disabled, true);
    choose(p.h, { get size() { assert.fail('Occupied physical read must not inspect another File'); } });
    retained(p);
    settle(bytes.buffer); await tick(); retained(p); assert.equal(file(p.h).props.disabled, false);
  } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
});
test('File deadline retains inputs and physical ownership until original bytes settle', async t => {
  let now = 0, expire; const nativeTimeout = setTimeout;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => ms === 8000 ? (expire = callback, 0) : nativeTimeout(callback, ms, ...args));
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const p = prepared(t), bytes = new TextEncoder().encode(p.json); let settle;
  try {
    choose(p.h, { size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } });
    now = 8000; expire(); retained(p); assert.equal(file(p.h).props.disabled, true);
    settle(bytes.buffer); await tick(); retained(p); assert.equal(file(p.h).props.disabled, false);
  } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
});
test('malformed selector retains milestone inputs without exposing event details', async t => {
  const p = prepared(t); try {
    file(p.h).props.onChange({ get currentTarget() { throw Error('Private event detail'); } }); await tick(); retained(p);
  } finally { p.h.unmount(); }
});
test('successful owned exact File reopening explicitly replaces retained worksheet inputs', async t => {
  const p = prepared(t); try {
    const json = plannedMilestoneDraftJson(p.draft('Explicit replacement milestone'), p.context);
    choose(p.h, bytesFile(new TextEncoder().encode(json))); await tick();
    assert.equal(node(p.h, n => n.props.name === '2.description')?.props.defaultValue, 'Explicit replacement milestone');
    assert.equal(output(p.h), json); assert.equal(paste(p.h).props.value, '');
  } finally { p.h.unmount(); }
});
test('retained File inputs do not survive an explicit clear or replacement context', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  for (const action of ['clear', 'context', 'unmount']) {
    const p = prepared(t), bytes = new TextEncoder().encode(p.json); let settle;
    try {
      choose(p.h, { size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } });
      if (action === 'clear') click(p.h, 'Clear milestone draft');
      else if (action === 'context') { const next = structuredClone(p.context); next.binding.captureId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; p.h.render(next); p.h.commit(); }
      else p.h.unmount();
      settle(bytes.buffer); await tick(); assert.equal(output(p.h), undefined);
      if (action !== 'unmount') { assert.equal(node(p.h, n => n.props.name === '1.description'), undefined); assert.equal(paste(p.h).props.value, ''); }
    } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
  }
});
