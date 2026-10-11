import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { compareShares } from "../src/share-change.ts";

test("hypothetical shares distinguish exact percentage points from rounded relative changes", () => {
  assert.deepEqual(compareShares('10', '12'), { kind: 'comparison', before: '10', after: '12',
    percentagePoints: '2', relativePercent: '20', direction: 'increase' });
  assert.deepEqual(compareShares('12', '10'), { kind: 'comparison', before: '12', after: '10',
    percentagePoints: '-2', relativePercent: '-16.6667', direction: 'decrease' });
  assert.equal(compareShares('10', '20').relativePercent, '100');
  assert.equal(compareShares('20', '10').relativePercent, '-50');
  assert.equal(compareShares('0.1', '0.3').percentagePoints, '0.2');
  assert.equal(compareShares('0.1', '0.3').relativePercent, '200');
});
test("zero baselines have no relative result, same shares are unchanged and four-place decimal points remain exact", () => {
  for (const next of ['0', '12', '100']) assert.equal(compareShares('0', next).relativePercent, null);
  assert.equal(compareShares('0', '0').direction, 'unchanged');
  assert.equal(compareShares('100', '0').relativePercent, '-100');
  assert.equal(compareShares('000,1000', ' 0.3000 ').relativePercent, '200');
  assert.equal(compareShares('0.0001', '100').relativePercent, '99999900');
  assert.equal(compareShares('99.9999', '100').percentagePoints, '0.0001');
  assert.equal(compareShares('100', '99.9999').percentagePoints, '-0.0001');
});
test("invalid hypothetical shares are ordinary input refusals without partial arithmetic", () => {
  for (const value of [null, undefined, 10, [], '', ' ', '-1', '+1', '101', '100.0001', '0.00001',
    '1e2', '10%', '1,2.3', '1,000.0', 'NaN', 'Infinity', '<script>', ' '.repeat(13)]) {
    assert.deepEqual(compareShares(value, '12'), { kind: 'invalid' });
    assert.deepEqual(compareShares('10', value), { kind: 'invalid' });
  }
});
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value?.props ? [value, ...walk(value.props.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' ? value : '';
function harness() {
  let cursor = 0; const cells = [], file = new URL('../src/share-change-view.tsx', import.meta.url), exports = {};
  const native = createRequire(file), hooks = {
    useId: () => 'invented-share-example',
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => { cells[i] = value; }]; },
  };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', code)(name => name === 'react' ? hooks : native(name), exports);
  const render = () => { cursor = 0; return exports.ShareChangeExample(); };
  return { markup: () => renderToStaticMarkup(render()),
    input(index) { return walk(render()).filter(node => node.type === 'input')[index].props; },
    button(label) { return walk(render()).find(node => node.type === 'button' && text(node.props.children) === label).props; },
    compare() { let prevented = 0; walk(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() { prevented++; } }); assert.equal(prevented, 1); },
  };
}
test("actual example callbacks perform only requested arithmetic, clear obsolete results and keep causal limits", () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw new Error('Network forbidden'); };
  try {
    const ui = harness(); assert.doesNotMatch(ui.markup(), /Hypothetical calculation:/);
    ui.button('Fill the 10% to 12% example').onClick(); assert.equal(ui.input(0).value, '10'); assert.equal(ui.input(1).value, '12');
    assert.doesNotMatch(ui.markup(), /Hypothetical calculation:/); ui.compare();
    assert.match(ui.markup(), /2 percentage points/); assert.match(ui.markup(), /20% relative to the earlier share/);
    assert.match(ui.markup(), /cannot establish a policy effect/); assert.match(ui.markup(), /causal evidence must be checked separately/);
    ui.input(1).onChange({ target: { value: '5' } }); assert.doesNotMatch(ui.markup(), /Hypothetical calculation:/);
    ui.compare(); assert.match(ui.markup(), /-5 percentage points/); assert.match(ui.markup(), /a decrease/);
    ui.button('Clear share example').onClick(); assert.equal(ui.input(0).value, ''); assert.equal(ui.input(1).value, '');
    assert.doesNotMatch(ui.markup(), /Hypothetical calculation:/); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
test("actual invalid and zero-baseline views are accessible and permit explicit recovery", () => {
  const ui = harness(); ui.compare(); assert.match(ui.markup(), /role="alert"/);
  assert.equal(ui.input(0).inputMode, 'decimal'); assert.equal(ui.input(0)['aria-invalid'], true);
  const beforeHelp = ui.input(0)['aria-describedby'], afterHelp = ui.input(1)['aria-describedby']; assert.equal(beforeHelp, afterHelp);
  ui.input(0).onChange({ target: { value: '0' } }); assert.doesNotMatch(ui.markup(), /role="alert"/);
  ui.input(1).onChange({ target: { value: '12' } }); ui.compare();
  assert.match(ui.markup(), /12 percentage points/); assert.match(ui.markup(), /Not defined: the earlier share is zero/);
  assert.doesNotMatch(ui.markup(), /Infinity|NaN/); assert.match(ui.markup(), /role="status"/);
});
