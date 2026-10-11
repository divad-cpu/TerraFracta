import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { updateRunReportSchema } from "../src/update-run-report.ts";
const source = new URL("../app/update-preview/operation.tsx", import.meta.url);
const Operation = loadTsx(source).UpdateOperation;
const report = later => JSON.parse(readFileSync(new URL(`../fixtures/${later ? "fictional_revised_update_report" : "fictional_update_report"}.json`, import.meta.url)));
const html = input => renderToStaticMarkup(createElement(Operation, { initialReport: input }));
function pair(markup, input) {
  const forward = [...markup.matchAll(/<a href="#([^"]+)">Inspect this item’s checked draft<\/a>/g)];
  const back = [...markup.matchAll(/<a href="#([^"]+)">Return to checked item ([0-9]+)<\/a>/g)];
  assert.equal(forward.length, 1, "The actual operation has no exact draft link"); assert.equal(back.length, 1);
  const index = input.items.findIndex(item => item.itemKey === input.fictionalCandidate.itemKey);
  assert.equal(Number(back[0][2]), index + 1);
  const origin = [...markup.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].find(match => match[1].includes(`id="${back[0][1]}"`));
  assert.ok(origin); assert.ok(origin[2].includes(forward[0][0])); assert.match(origin[2], /Passed the rehearsal checks/);
  assert.ok(markup.includes(`<div id="${forward[0][1]}"><section class="update-candidate"`));
  assert.equal(forward[0][1].replace(/-draft$/, ""), back[0][1].replace(/-item-[0-9]+$/, ""));
  return { draft: forward[0][1], item: back[0][1] };
}
test("the actual initial operation connects its checked decision and actual draft in both directions", () => {
  const input = report(false); assert.equal(updateRunReportSchema.safeParse(input).success, true); pair(html(input), input);
});
test("the actual revised operation preserves a reordered origin’s original ordinal", () => {
  const input = report(true); input.items.reverse(); assert.equal(updateRunReportSchema.safeParse(input).success, true);
  assert.ok(pair(html(input), input).item.endsWith("-item-3"));
});
test("opaque operation fragment targets do not derive from arbitrary valid item-key characters", () => {
  const input = report(false), item = input.items.find(item => item.itemKey === input.fictionalCandidate.itemKey);
  item.itemKey = 'odd key : / ? # < & "'; input.fictionalCandidate.itemKey = item.itemKey;
  assert.equal(updateRunReportSchema.safeParse(input).success, true); const links = pair(html(input), input);
  assert.match(links.draft, /^[A-Za-z0-9_:-]+-draft$/); assert.match(links.item, /^[A-Za-z0-9_:-]+-item-0$/);
});
test("new targets stay inside each installed-React operation instance including repeated report objects", () => {
  const input = report(false), markup = renderToStaticMarkup(createElement(Fragment, null,
    ...[input, report(true), input].map((value, key) => createElement(Operation, { initialReport: value, key }))));
  const forward = [...markup.matchAll(/href="#([^"]+)">Inspect this item’s checked draft/g)].map(m => m[1]);
  const back = [...markup.matchAll(/href="#([^"]+)">Return to checked item/g)].map(m => m[1]);
  assert.equal(forward.length, 3); assert.equal(back.length, 3); assert.equal(new Set([...forward, ...back]).size, 6);
  for (let i = 0; i < 3; i++) assert.equal(forward[i].replace(/-draft$/, ""), back[i].replace(/-item-0$/, ""));
  // Existing static operation heading IDs are outside this navigation scope.
  for (const target of [...forward, ...back]) assert.equal([...markup.matchAll(/\sid="([^"]+)"/g)].filter(m => m[1] === target).length, 1);
});
test("closed no-draft reports and malformed or unbound reports cannot acquire new navigation", () => {
  const missing = report(false); Object.assign(missing, { state: "partial", coveredSourceKeys: [], items: [], fictionalCandidate: null });
  assert.equal(updateRunReportSchema.safeParse(missing).success, true);
  const held = report(false); Object.assign(held.items[0], { outcome: "held", reasonCodes: ["source_reference_invalid"], source: null, sourceBindingValid: false });
  Object.assign(held, { state: "partial", coveredSourceKeys: [], fictionalCandidate: null });
  assert.equal(updateRunReportSchema.safeParse(held).success, true);
  const unbound = report(false); unbound.fictionalCandidate.itemKey = "unbound-item";
  const privateField = { ...report(false), rawBody: "PRIVATE_CANARY" };
  const publicChange = { ...report(false), publicChanges: 1 };
  for (const value of [missing, held, unbound, privateField, publicChange])
    assert.doesNotMatch(html(value), /Inspect this item|Return to checked item|id="[^"]+-(?:draft|item-[0-9]+)"/);
});
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
test("the actual operation updates the pair from saved selection to fresh settlement without new navigation callbacks", async () => {
  let cursor = 0, effects = [], finish; const cells = [], requests = [];
  const hooks = { useId: () => "operation-port", useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], value => { cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; }, useEffect(fn) { effects.push(fn); } };
  const History = () => null, Candidate = () => null, Comparison = () => null;
  const ui = loadTsx(source, name => name === "react" ? hooks : name === "./history" ? { FictionalHistory: History } :
    name === "./candidate" ? { FictionalCandidate: Candidate } : name === "./comparison" ? { FictionalComparison: Comparison } :
    name === "../../src/fictional-update-request" ? { requestFictionalUpdate(...args) { requests.push(args); return new Promise(resolve => { finish = resolve; }); } } : undefined).UpdateOperation;
  const render = () => { cursor = 0; effects = []; return ui({ initialReport: report(false) }); };
  const boundPair = input => {
    const all = nodes(render()), index = input.items.findIndex(item => item.itemKey === input.fictionalCandidate.itemKey);
    const forward = all.filter(node => node.type === "a" && node.props.children === "Inspect this item’s checked draft");
    const back = all.filter(node => node.type === "a" && Array.isArray(node.props.children) && node.props.children[0] === "Return to checked item ");
    assert.equal(forward.length, 1); assert.equal(back.length, 1); assert.equal(forward[0].props.href, "#operation-port-draft");
    assert.equal(back[0].props.href, `#operation-port-item-${index}`); assert.equal(back[0].props.children[1], index + 1);
    assert.ok(all.some(node => node.type === "li" && node.props.id === `operation-port-item-${index}` && nodes(node).includes(forward[0])));
    assert.deepEqual(all.find(node => node.type === Candidate).props.candidate, input.fictionalCandidate);
    assert.equal(forward[0].props.onClick, undefined); assert.equal(back[0].props.onClick, undefined);
  };
  render(); const cleanup = effects[0](); render();
  const saved = { execution: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "local_fictional", scenario: "revised_value", executedAt: "2026-10-10T10:01:00Z", durationMs: 1 }, report: report(true) };
  saved.report.items.reverse(); nodes(render()).find(node => node.type === History).props.onInspect(saved); boundPair(saved.report);
  nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(requests.length, 1);
  const fresh = { ...saved, execution: { ...saved.execution, scenario: "standard" }, report: report(false) };
  finish(fresh); await new Promise(resolve => setImmediate(resolve)); boundPair(fresh.report); cleanup();
});
