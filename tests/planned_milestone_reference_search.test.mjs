import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { policyEventContext } from "./helpers/policy_event_fixture.mjs";
import { policyEventControlEntries } from "../src/policy-event-controls.ts";
import { proposalId } from "./helpers/proposal_fixture.mjs";
import { plannedMilestoneDraftJson } from "../src/planned-milestone-draft.ts";
const configs = [{ label: "milestone", file: "planned-milestone-draft-view", component: "PlannedMilestoneDraftView", context: policyEventContext,
 entry(c) { const refs = [{ claimId: c.claims[0].id, referenceNumber: 1 }]; return { claimId: c.claims[0].id, fields: {
 description: { wording: "A documented unverified target", references: refs }, institution: { wording: "A source-described fictional institution", references: [{ claimId: c.claims[0].id, referenceNumber: 2 }] },
 targetDate: { date: { precision: "year", value: "2030" }, references: refs },
 reportedDate: { date: { precision: "day", value: "2026-01-02" }, references: refs } } }; },
 empty: c => ({ schemaVersion: 1, kind: "planned_milestone_preparation", binding: c.binding, entries: [] }),
 json: plannedMilestoneDraftJson, secondary: "institution", selectors: 32 }];
const button = (h, label) => h.nodes().find(n => n.type === "button" && [n.props.children].flat().join("") === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const named = (h, name) => h.nodes().find(n => n.props.name === name) ?? assert.fail(name);
const suffix = (h, ending) => h.nodes().find(n => n.props.id?.endsWith(ending)) ?? assert.fail(ending);
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const html = h => renderToStaticMarkup(h.render());
const optionKeys = n => elements(n.props.children).filter(n => n.type === "option").map(n => n.props.value);
const selected = keys => ({ selectedOptions: { length: keys.length, item: index => keys[index] === undefined ? null : { value: keys[index] } } });
const choose = (h, name, keys) => named(h, name).props.onChange({ currentTarget: selected(keys) });
const query = (h, value) => suffix(h, "-reference-search").props.onChange({ currentTarget: { value } });
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("Private source-choice editing cannot use the network"));
function attach(h, cfg) {
  const root = h.nodes().find(n => n.props["aria-label"] === `Unsent planned-milestone controls`);
  const nodes = elements(root.props.children).filter(n => ["fieldset", "input", "select", "textarea", "button"].includes(n.type));
  const controls = nodes.map(n => ({ getAttribute: key => key === "name" ? n.props.name ?? null : null,
    tagName: n.type.toUpperCase(), type: n.props.type ?? "text", multiple: !!n.props.multiple,
    value: n.props.value ?? n.props.defaultValue ?? "", ...(n.props.multiple ? selected(n.props.value) : {}) }));
  root.props.ref.current = { elements: { length: controls.length, item: index => controls[index] ?? null } }; return { root, nodes };
}
const inspect = (h, cfg) => { attach(h, cfg); click(h, `Inspect unsent ${cfg.label} draft`); };
for (const cfg of configs) {
  const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL(`../src/${cfg.file}.tsx`, import.meta.url), name: cfg.component });
  const reopened = () => {
    const c = cfg.context(), h = harness(c); h.mount(); const draft = cfg.empty(c); draft.entries.push(cfg.entry(c)); const json = cfg.json(draft, c);
    suffix(h, "-paste").props.onChange({ currentTarget: { value: json } }); click(h, `Reopen ${cfg.label} preparation`); assert.equal(output(h), json); return { h, c, json };
  };
  test(`${cfg.label}: source search starts disabled outside inspected controls and adds no submission`, t => {
    noNetwork(t); const h = harness(cfg.context()); assert.equal(suffix(h, "-reference-search").props.disabled, true); h.mount(); click(h, `Add ${cfg.label} entry`);
    const { nodes } = attach(h, cfg); assert.ok(!nodes.some(n => n.props.type === "search")); assert.equal(suffix(h, "-reference-search").props.maxLength, 80);
    assert.doesNotMatch(html(h), /<form|type="submit"|href="https:/); h.unmount();
  });
  test(`${cfg.label}: selected exact occurrences persist outside matches without editing original dates or copied JSON`, t => {
    noNetwork(t); const { h, c, json } = reopened(), first = `${c.claims[0].id}:1`, second = `${c.claims[0].id}:2`;
    query(h, "contradicts"); assert.deepEqual(optionKeys(named(h, "1.targetDateReferences")), [first, second]);
    assert.deepEqual(named(h, "1.targetDateReferences").props.value, [first]); assert.deepEqual(optionKeys(named(h, `1.${cfg.secondary}References`)), [second]);
    assert.match(html(h), /Selected outside this filter/); assert.equal(output(h), json); query(h, "no-such-occurrence"); inspect(h, cfg);
    assert.equal(output(h), json); assert.equal(JSON.parse(output(h)).entries[0].fields.targetDate.date.precision, "year");
    assert.equal(JSON.parse(output(h)).entries[0].fields.reportedDate.date.precision, "day"); h.unmount();
  });
  test(`${cfg.label}: no-match and invalid queries keep selections while explicit reset restores all original choices`, t => {
    noNetwork(t); const { h, c, json } = reopened();
    for (const value of ["absent", "x".repeat(81), "bad\u0000query", "ﬃ".repeat(30)]) {
      query(h, value); assert.deepEqual(optionKeys(named(h, "1.targetDateReferences")), [`${c.claims[0].id}:1`]); assert.equal(output(h), json);
    }
    assert.match(html(h), /Reference search is invalid or unavailable/); click(h, `Show all ${cfg.label} reference choices`);
    assert.equal(optionKeys(named(h, "1.targetDateReferences")).length, 2); assert.equal(output(h), json); h.unmount();
  });
  test(`${cfg.label}: explicit reference editing changes only its exact source occurrence and preserves source precision`, t => {
    noNetwork(t); const { h, c } = reopened(), key = `${c.claims[0].id}:2`; choose(h, "1.targetDateReferences", [key]);
    query(h, "supports"); assert.deepEqual(named(h, "1.targetDateReferences").props.value, [key]); inspect(h, cfg);
    const saved = output(h), entry = JSON.parse(saved).entries[0]; assert.deepEqual(entry.fields.targetDate.date, { precision: "year", value: "2030" });
    assert.equal(entry.fields.targetDate.references[0].referenceNumber, 2); suffix(h, "-paste").props.onChange({ currentTarget: { value: saved } });
    click(h, `Reopen ${cfg.label} preparation`); query(h, "absent"); inspect(h, cfg); assert.equal(output(h), saved); h.unmount();
  });
  test(`${cfg.label}: whole unsafe reference attempts preserve previous choices and hold until explicit valid reselection`, t => {
    noNetwork(t);
    for (const attempt of [key => selected(Array(13).fill(key)), key => selected([key, key]), () => selected([`${proposalId(999)}:1`]),
      () => ({ get selectedOptions() { throw Error("PRIVATE_REFERENCE_FAULT"); } })]) {
      const { h, c } = reopened(), key = `${c.claims[0].id}:1`; named(h, "1.targetDateReferences").props.onChange({ currentTarget: attempt(key) });
      assert.deepEqual(named(h, "1.targetDateReferences").props.value, [key]); assert.match(html(h), /Reference selection held/); assert.doesNotMatch(html(h), /PRIVATE_REFERENCE_FAULT/);
      inspect(h, cfg); assert.equal(output(h), undefined); choose(h, "1.targetDateReferences", [key]); inspect(h, cfg); assert.ok(output(h)); h.unmount();
    }
  });
  test(`${cfg.label}: independent batched query and reference fields merge while same-field nested intent wins`, t => {
    noNetwork(t); const { h, c } = reopened(), first = `${c.claims[0].id}:1`, second = `${c.claims[0].id}:2`;
    named(h, "1.targetDateReferences").props.onChange({ currentTarget: { selectedOptions: { length: 1, item() { choose(h, "1.targetDateReferences", [second]); return { get value() { assert.fail("Retired value observed"); } }; } } } });
    assert.deepEqual(named(h, "1.targetDateReferences").props.value, [second]); h.pauseMerges(); choose(h, "1.targetDateReferences", [first]); choose(h, `1.${cfg.secondary}References`, [first]); query(h, "contradicts");
    h.nodes().find(n => n.props["aria-label"] === `Unsent planned-milestone controls`).props.onChange(); h.flushMerges();
    assert.deepEqual(named(h, "1.targetDateReferences").props.value, [first]); assert.deepEqual(named(h, `1.${cfg.secondary}References`).props.value, [first]);
    assert.equal(suffix(h, "-reference-search").props.value, "contradicts"); inspect(h, cfg); assert.ok(output(h)); h.unmount();
  });
  test(`${cfg.label}: current query reset retires a reading query while a stale reset cannot erase a newer pending query`, t => {
    noNetwork(t); const { h, json } = reopened(); query(h, "supports"); let reset = button(h, `Show all ${cfg.label} reference choices`).props.onClick;
    suffix(h, "-reference-search").props.onChange({ currentTarget: { get value() { reset(); return "older"; } } });
    assert.equal(suffix(h, "-reference-search").props.value, ""); query(h, "supports"); reset = button(h, `Show all ${cfg.label} reference choices`).props.onClick;
    h.pauseMerges(); query(h, "contradicts"); reset(); h.flushMerges(); assert.equal(suffix(h, "-reference-search").props.value, "contradicts"); assert.equal(output(h), json); h.unmount();
  });
  test(`${cfg.label}: fresh Clear can retire pending native selection while old Clear cannot erase newer input`, t => {
    noNetwork(t);
    for (const boundary of ["target", "item", "value"]) {
      const { h, c } = reopened(), oldClear = button(h, `Clear ${cfg.label} draft`).props.onClick, edit = named(h, "1.targetDateReferences").props.onChange;
      const clear = () => { oldClear(); assert.ok(h.nodes().some(n => n.props.name === "1.targetDateReferences")); click(h, `Clear ${cfg.label} draft`); };
      edit({ get currentTarget() { if (boundary === "target") { clear(); return new Proxy({}, { get() { assert.fail("Retired target observed"); } }); }
        return { selectedOptions: { length: 1, get item() { if (boundary === "item") { clear(); return () => assert.fail("Retired method invoked"); }
          return () => ({ get value() { clear(); return `${c.claims[0].id}:1`; } }); } } }; } });
      assert.ok(!h.nodes().some(n => n.props.name?.endsWith(".claim"))); assert.equal(output(h), undefined); h.unmount();
    }
  });
  test(`${cfg.label}: row removal capture replacement and unmount deny retained query and reference events before access`, t => {
    noNetwork(t); const forbidden = new Proxy({}, { get() { assert.fail("Retired event observed"); } });
    for (const action of ["remove", "context", "unmount"]) {
      const { h, c } = reopened(), refs = named(h, "1.targetDateReferences").props.onChange, search = suffix(h, "-reference-search").props.onChange;
      if (action === "remove") click(h, `Remove ${cfg.label} entry 1`);
      if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(917); h.render(next); }
      if (action === "unmount") h.unmount(); refs(forbidden); search(forbidden); assert.equal(output(h), undefined); h.unmount();
    }
  });
  test(`${cfg.label}: maximum30 statements360 references and eight rows filter within existing native control bounds`, t => {
    noNetwork(t); const c = cfg.context(), original = structuredClone(c.claims[0]);
    c.claims = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(original), id: proposalId(200 + i),
      evidence: Array.from({ length: 12 }, (_, j) => ({ ...original.evidence[j % 2], title: `date-needle-${i + 1}-${j + 1}` })) }));
    const h = harness(c); h.mount(); for (let i = 0; i < 8; i++) click(h, `Add ${cfg.label} entry`);
    const selectors = () => h.nodes().filter(n => n.props.multiple && n.props.name?.endsWith("References"));
    assert.equal(selectors().length, cfg.selectors); assert.equal(selectors().reduce((sum, n) => sum + optionKeys(n).length, 0), cfg.selectors * 360);
    query(h, "date-needle-30-12"); assert.ok(selectors().every(n => optionKeys(n).length === 1)); assert.match(html(h), /1 of 360 recorded reference choices match/);
    const { root, nodes } = attach(h, cfg); assert.ok(nodes.length <= 128); assert.ok(!nodes.some(n => n.props.type === "search"));
    assert.equal(policyEventControlEntries(root.props.ref.current, () => true).filter(([name]) => name.endsWith("References")).length, 0); h.unmount();
  });
}

test('milestone search never releases a pending physical File read or changes its owned exact result', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  const c = policyEventContext(), cfg = configs[0], draft = cfg.empty(c); draft.entries.push(cfg.entry(c));
  const json = cfg.json(draft,c), bytes = new TextEncoder().encode(json); let settle;
  const h = responsibilityDraftHarness(c,undefined,{url:new URL('../src/planned-milestone-draft-view.tsx',import.meta.url),name:'PlannedMilestoneDraftView'});
  h.mount();
  try {
    suffix(h,'-file').props.onChange({currentTarget:{files:[{size:bytes.length,slice(){return{arrayBuffer:()=>new Promise(resolve=>{settle=resolve;})};}}],value:''}});
    query(h,'contradicts'); assert.equal(suffix(h,'-file').props.disabled,true);
    click(h,'Show all milestone reference choices'); assert.equal(suffix(h,'-file').props.disabled,true);
    settle(bytes.buffer); for(let i=0;i<16;i++)await Promise.resolve();
    assert.equal(output(h),json);assert.equal(suffix(h,'-file').props.disabled,false);
  } finally {settle?.(bytes.buffer);for(let i=0;i<16;i++)await Promise.resolve();h.unmount();}
});
test('milestone throwing query access withholds matching choices without echoing details or changing accepted local output',()=>{
 const c=policyEventContext(),cfg=configs[0],draft=cfg.empty(c);draft.entries.push(cfg.entry(c));const json=cfg.json(draft,c);
 const h=responsibilityDraftHarness(c,undefined,{url:new URL('../src/planned-milestone-draft-view.tsx',import.meta.url),name:'PlannedMilestoneDraftView'});h.mount();
 try{suffix(h,'-paste').props.onChange({currentTarget:{value:json}});click(h,'Reopen milestone preparation');
 suffix(h,'-reference-search').props.onChange({get currentTarget(){throw Error('PRIVATE_QUERY_DETAIL');}});
 assert.equal(output(h),json);assert.match(html(h),/Reference search is invalid or unavailable/);assert.doesNotMatch(html(h),/PRIVATE_QUERY_DETAIL/);
 assert.deepEqual(optionKeys(named(h,'1.targetDateReferences')),[`${c.claims[0].id}:1`]);
 click(h,'Show all milestone reference choices');assert.equal(optionKeys(named(h,'1.targetDateReferences')).length,2);
 }finally{h.unmount();}
});
