import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { responsibilityDraftHarness } from './helpers/responsibility_draft_harness.mjs';
import { elements } from './helpers/correction_draft_harness.mjs';
import { proposalReport } from './helpers/proposal_fixture.mjs';
import { encodeProposalCapture } from '../src/server/proposal-capture.ts';
import { capturedScopeDraftContext } from '../src/server/issue-scope-draft.ts';
import { evaluationFieldLabels, evaluationDraftJson } from '../src/evaluation-draft.ts';
const button = (h, label) => h.nodes().find(n => n.type === 'button' && [n.props.children].flat().join('') === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const suffix = (h, ending) => h.nodes().find(n => n.props.id?.endsWith(ending)) ?? assert.fail(ending);
const named = (h, name) => h.nodes().find(n => n.props.name === name) ?? assert.fail(name);
const output = h => h.nodes().find(n => n.type === 'textarea' && n.props.readOnly)?.props.value;
const markup = h => renderToStaticMarkup(h.render());
const query = (h, value) => suffix(h, '-reference-search').props.onChange({ currentTarget: { value } });
const options = n => elements(n.props.children).filter(n => n.type === 'option').map(n => n.props.value);
const selected = values => ({ selectedOptions: { length: values.length, item: i => values[i] === undefined ? null : { value: values[i] } } });
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const forbidden = new Proxy({}, { get() { assert.fail('Retired event must not be observed'); } });
function prepared(t, entries = 1) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Search must stay local'));
  const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson);
  payload.snapshot.claims[0].type = 'evaluation'; Object.assign(report.capture, encodeProposalCapture(payload));
  const context = capturedScopeDraftContext(report), first = `${context.claims[0].id}:1`, second = `${context.claims[0].id}:2`;
  const value = { schemaVersion: 1, kind: 'evaluation_preparation', binding: context.binding,
    entries: Array.from({ length: entries }, (_, i) => ({ claimId: context.claims[0].id,
      fields: Object.fromEntries(Object.keys(evaluationFieldLabels).map(field => [field, field === 'design'
        ? { wording: `An attributed design ${i + 1}`, references: [{ claimId: context.claims[0].id, referenceNumber: 1 }] }
        : field === 'finding' ? { wording: 'Source-described uncertain finding', references: [{ claimId: context.claims[0].id, referenceNumber: 2 }] } : null])) })) };
  const json = evaluationDraftJson(value, context);
  const h = responsibilityDraftHarness(context, undefined, { url: new URL('../src/evaluation-draft-view.tsx', import.meta.url), name: 'EvaluationDraftView' });
  h.mount(); suffix(h, '-paste').props.onChange({ currentTarget: { value: json } }); click(h, 'Reopen evaluation preparation'); assert.equal(output(h), json);
  return { h, context, first, second, json };
}
function attach(h) {
  const root = h.nodes().find(n => n.props['aria-label'] === 'Unsent evaluation controls');
  const nodes = elements(root.props.children).filter(n => ['fieldset', 'input', 'select', 'textarea', 'button'].includes(n.type));
  const controls = nodes.map(n => ({ getAttribute: key => key === 'name' ? n.props.name ?? null : null,
    tagName: n.type.toUpperCase(), type: n.props.type ?? 'text', multiple: !!n.props.multiple,
    value: n.props.value ?? n.props.defaultValue ?? '', ...(n.props.multiple ? selected(n.props.value) : {}) }));
  root.props.ref.current = { elements: { length: controls.length, item: i => controls[i] ?? null } }; return nodes;
}
const inspect = h => { attach(h); click(h, 'Review evaluation draft'); };

test('evaluation search is local and outside the inspected native controls, initially unadmitted', t => {
  const { h } = prepared(t); try {
    assert.equal(suffix(h, '-reference-search').props.maxLength, 80);
    assert.ok(!attach(h).some(n => n.props.type === 'search'));
    assert.doesNotMatch(markup(h), /<form|type="submit"|href="https:/);
  } finally { h.unmount(); }
});
test('evaluation search keeps original occurrence numbers and selected outside-filter choices without changing JSON', t => {
  const p = prepared(t); try {
    query(p.h, 'contradicts'); assert.deepEqual(options(named(p.h, '1.designReferences')), [p.first, p.second]);
    assert.deepEqual(options(named(p.h, '1.findingReferences')), [p.second]);
    assert.deepEqual(named(p.h, '1.designReferences').props.value, [p.first]);
    assert.match(markup(p.h), /Selected outside this filter/); assert.equal(output(p.h), p.json);
    query(p.h, 'no-such-occurrence'); inspect(p.h); assert.equal(output(p.h), p.json);
  } finally { p.h.unmount(); }
});
test('invalid and Unicode-expanding queries withhold matches, preserve selected references and reset explicitly', t => {
  const p = prepared(t); try {
    for (const text of ['absent', 'x'.repeat(81), 'bad\0query', 'ﬃ'.repeat(30)]) {
      query(p.h, text); assert.deepEqual(options(named(p.h, '1.designReferences')), [p.first]); assert.equal(output(p.h), p.json);
    }
    assert.match(markup(p.h), /Reference search is invalid or unavailable/);
    click(p.h, 'Show all evaluation reference choices'); assert.equal(suffix(p.h, '-reference-search').props.value, '');
    assert.deepEqual(options(named(p.h, '1.designReferences')), [p.first, p.second]); assert.equal(output(p.h), p.json);
  } finally { p.h.unmount(); }
});
test('explicit evaluation reference edits preserve original wording and exact reference identity through search and inspection', t => {
  const p = prepared(t); try {
    named(p.h, '1.designReferences').props.onChange({ currentTarget: selected([p.second]) }); assert.equal(output(p.h), undefined);
    query(p.h, 'supports'); inspect(p.h);
    const saved = JSON.parse(output(p.h)); assert.equal(saved.entries[0].fields.design.wording, 'An attributed design 1');
    assert.deepEqual(saved.entries[0].fields.design.references, [{ claimId: p.context.claims[0].id, referenceNumber: 2 }]);
  } finally { p.h.unmount(); }
});
test('newest query intent wins reentrant getters, while stale reset cannot erase a newer deferred query', t => {
  const p = prepared(t); try {
    let handler = suffix(p.h, '-reference-search').props.onChange;
    handler({ get currentTarget() { handler({ currentTarget: { value: 'newest' } }); return { get value() { assert.fail('Retired query value'); } }; } });
    assert.equal(suffix(p.h, '-reference-search').props.value, 'newest');
    const stale = button(p.h, 'Show all evaluation reference choices').props.onClick;
    p.h.pauseMerges(); query(p.h, 'contradicts'); stale(); p.h.flushMerges();
    assert.equal(suffix(p.h, '-reference-search').props.value, 'contradicts'); assert.equal(output(p.h), p.json);
  } finally { p.h.unmount(); }
});
test('query failure withholds unselected options and current reset retires the interrupted query', t => {
  const p = prepared(t); try {
    suffix(p.h, '-reference-search').props.onChange({ get currentTarget() { throw Error('PRIVATE_QUERY'); } });
    assert.deepEqual(options(named(p.h, '1.designReferences')), [p.first]); assert.doesNotMatch(markup(p.h), /PRIVATE_QUERY/);
    const reset = button(p.h, 'Show all evaluation reference choices').props.onClick;
    suffix(p.h, '-reference-search').props.onChange({ currentTarget: { get value() { reset(); return 'retired'; } } });
    assert.equal(suffix(p.h, '-reference-search').props.value, ''); assert.equal(output(p.h), p.json);
  } finally { p.h.unmount(); }
});
test('search during pending evaluation File read does not retire the file or alter its exact result', async t => {
  const p = prepared(t), bytes = new TextEncoder().encode(p.json); let settle;
  try {
    suffix(p.h, '-file').props.onChange({ currentTarget: { value: '', files: [{ size: bytes.length, slice() { return { arrayBuffer: () => new Promise(resolve => { settle = resolve; }) }; } }] } });
    query(p.h, 'contradicts'); assert.equal(suffix(p.h, '-file').props.disabled, true);
    settle(bytes.buffer); await tick(); assert.equal(output(p.h), p.json); assert.equal(suffix(p.h, '-reference-search').props.value, 'contradicts');
    assert.deepEqual(options(named(p.h, '2.designReferences')), [p.first, p.second]);
  } finally { settle?.(bytes.buffer); await tick(); p.h.unmount(); }
});
test('clear row removal comparison replacement and unmount retire old search callbacks before event access', t => {
  for (const action of ['clear', 'remove', 'context', 'unmount']) {
    const p = prepared(t); try {
      query(p.h, 'contradicts'); const old = suffix(p.h, '-reference-search').props.onChange;
      if (action === 'clear') click(p.h, 'Clear evaluation draft');
      else if (action === 'remove') click(p.h, 'Remove evaluation entry 1');
      else if (action === 'context') { const next = structuredClone(p.context); next.binding.captureId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; p.h.render(next); p.h.commit(); }
      else p.h.unmount();
      old(forbidden); assert.equal(output(p.h), undefined);
      if (action === 'clear' || action === 'context') assert.equal(suffix(p.h, '-reference-search').props.value, '');
    } finally { p.h.unmount(); }
  }
});
test('four evaluation rows retain all32 selected reference controls within existing native bound under no matches', t => {
  const p = prepared(t, 4); try {
    query(p.h, 'no-such-occurrence'); const nodes = attach(p.h);
    assert.equal(nodes.filter(n => n.props.multiple).length, 32); assert.ok(nodes.length <= 128);
    assert.ok(!nodes.some(n => n.props.type === 'search')); click(p.h, 'Review evaluation draft'); assert.equal(output(p.h), p.json);
  } finally { p.h.unmount(); }
});

test('fresh evaluation search and reset refuse callbacks before mount and expose no submit controls', t => {
  const p = prepared(t); p.h.unmount();
  const h = responsibilityDraftHarness(p.context, undefined, { url: new URL('../src/evaluation-draft-view.tsx', import.meta.url), name: 'EvaluationDraftView' });
  try {
    assert.equal(suffix(h, '-reference-search').props.disabled, true);
    assert.equal(button(h, 'Show all evaluation reference choices').props.disabled, true);
    suffix(h, '-reference-search').props.onChange(forbidden);
    assert.equal(suffix(h, '-reference-search').props.value, '');
    const html = markup(h); assert.doesNotMatch(html, /<form|type="submit"/);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.filter(id => id.endsWith('-reference-search-status')).length, 1);
  } finally { h.unmount(); }
});
