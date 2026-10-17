import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId, proposalScope } from "./helpers/proposal_fixture.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
const context = () => capturedScopeDraftContext(proposalReport());
const field = (h, tag, name) => h.nodes().find(node => node.type === tag && node.props.id?.endsWith(name));
const button = (h, name) => h.nodes().find(node => node.type === "button" && node.props.children === name);
const json = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const wording = (h, value, name = "population") => field(h, "textarea", `-${name}-wording`).props.onChange({ currentTarget: { value } });
const refs = (h, values, name = "population") => field(h, "select", `-${name}-references`).props.onChange({ currentTarget: { selectedOptions: values.map(value => ({ value })) } });
test("blank fields preview explicit unknowns without auto-copying captured statement periods", () => {
 const h = scopeDraftHarness(context()), first = h.render(); assert.ok(elements(first).filter(node => node.type === "button").every(node => node.props.disabled));
 h.mount(); button(h, "Review scope draft").props.onClick(); const candidate = JSON.parse(json(h));
 assert.deepEqual(candidate.fields, { population: null, period: null, selectionRationale: null });
 assert.match(renderToStaticMarkup(h.render()), /Unknown — no wording or references supplied/);
});
test("supplied wording retains exact statement and reference positions, escapes markup and only creates an unsent local preview", () => {
 const h = scopeDraftHarness(context()); h.mount(); wording(h, "<img src=x onerror=alert(1)> invented scope");
 refs(h, [`${proposalId(3)}:2`]); button(h, "Review scope draft").props.onClick();
 const value = JSON.parse(json(h)); assert.equal(value.fields.population.references[0].referenceNumber, 2);
 const html = renderToStaticMarkup(h.render()); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(html, new RegExp(`href="#proposal-proposed-reference-${proposalId(3)}-2"`));
 assert.match(html, /Nothing is submitted, saved to the archive or published/); assert.doesNotMatch(html, /<form|href="https:|<img src=x/);
});
test("editing and malformed reference selections withhold a previously valid preview, and clear removes all local values", () => {
 const h = scopeDraftHarness(context()); h.mount(); wording(h, "Invented scope"); refs(h, [`${proposalId(3)}:1`]); button(h, "Review scope draft").props.onClick(); assert.ok(json(h));
 wording(h, "Changed wording"); assert.equal(json(h), undefined);
 refs(h, ["PRIVATE_CANARY"]); button(h, "Review scope draft").props.onClick(); assert.equal(json(h), undefined);
 assert.match(renderToStaticMarkup(h.render()), /Previous preview is withheld/);
 refs(h, [`${proposalId(3)}:1`, `${proposalId(3)}:1`]); button(h, "Review scope draft").props.onClick(); assert.equal(json(h), undefined);
 button(h, "Clear scope draft").props.onClick(); assert.equal(field(h, "textarea", "-population-wording").props.value, ""); assert.equal(json(h), undefined);
});
test("replacement invalid-context roundtrip and unmount permanently retire older handlers before effects commit", () => {
 const initial = context(), h = scopeDraftHarness(initial); h.mount(); wording(h, "Invented prior scope"); refs(h, [`${proposalId(3)}:1`]);
 const old = button(h, "Review scope draft").props.onClick;
 const replacement = structuredClone(initial); replacement.binding.captureId = proposalId(99);
 h.render(replacement); old(); assert.equal(json(h), undefined); h.commit();
 button(h, "Review scope draft").props.onClick(); assert.equal(JSON.parse(json(h)).fields.population, null);
 const current = button(h, "Review scope draft").props.onClick; h.render({}); h.render(replacement); current(); assert.equal(json(h), undefined);
 h.commit(); const after = button(h, "Review scope draft").props.onClick; h.unmount(); after(); assert.equal(json(h), undefined);
});
test("actual finite-byte private page exposes disabled preparation only after a checked capture and withholds it on the next changed read", async () => {
 const report = proposalReport(), calls = [];
 const reader = createProposalReader(async (scope, signal) => { calls.push({ scope, signal }); return new TextEncoder().encode(JSON.stringify(calls.length === 1 ? report : { schemaVersion: 1, status: "changed", requested: scope })); }, () => 0, () => assert.fail("diagnostic"));
 const Page = loadTsx(new URL("../app/editorial-preview/held/proposal/page.tsx", import.meta.url), name => name === "next/navigation" ? { unstable_rethrow() {}, notFound() { assert.fail("refusal"); } } : name.endsWith("operator-proposal-reader.ts") ? { readCapturedProposal: reader } : undefined).default;
 const first = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(proposalScope()) }));
 assert.match(first, /Prepare missing dossier scope — unsent/); assert.match(first, /<button type="button" disabled="">Review scope draft/); assert.doesNotMatch(first, /Unsent scope draft<|<form|href="https:/);
 const second = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(proposalScope()) })); assert.match(second, /Comparison changed/); assert.doesNotMatch(second, /scope-preparation|Invented coverage|Review scope draft/);
 assert.equal(calls.length, 2); assert.ok(calls.every(row => row.signal.aborted));
});

test("copied scope preparation restores field values and exact references, while malformed and changed evidence imports withhold prior preview", () => {
 const h = scopeDraftHarness(context()); h.mount(); wording(h, "Invented original scope"); refs(h, [`${proposalId(3)}:2`]); button(h, "Review scope draft").props.onClick(); const saved = json(h);
 button(h, "Clear scope draft").props.onClick();
 field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: saved } }); button(h, "Reopen scope preparation").props.onClick();
 assert.equal(json(h), saved); assert.equal(field(h, "textarea", "-population-wording").props.value, "Invented original scope");
 assert.deepEqual(field(h, "select", "-population-references").props.value, [`${proposalId(3)}:2`]);
 field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: saved.replace('"kind": "issue_scope_preparation"', '"kind": "accepted"') } });
 assert.equal(json(h), undefined); button(h, "Reopen scope preparation").props.onClick(); assert.equal(json(h), undefined);
 const changed = context(); changed.binding.comparisonSha256 = "c".repeat(64); h.render(changed); h.commit();
 field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: saved } }); button(h, "Reopen scope preparation").props.onClick(); assert.equal(json(h), undefined);
 assert.match(renderToStaticMarkup(h.render()), /Previous preview is withheld/);
});
test("a changed source receipt with identical proposal text immediately retires scope controls and copied values", () => {
 const report = proposalReport(), h = scopeDraftHarness(capturedScopeDraftContext(report)); h.mount(); wording(h, "Invented scope"); refs(h, [`${proposalId(3)}:1`]); button(h, "Review scope draft").props.onClick(); assert.ok(json(h));
 const oldReview = button(h, "Review scope draft").props.onClick, oldReopen = button(h, "Reopen scope preparation").props.onClick;
 report.sourceReceipts[1].contentSha256 = "c".repeat(64); const successor = capturedScopeDraftContext(report); h.render(successor);
 oldReview(); oldReopen(); assert.equal(json(h), undefined); assert.ok(button(h, "Review scope draft").props.disabled);
 h.commit(); assert.equal(field(h, "textarea", "-population-wording").props.value, ""); assert.equal(field(h, "textarea", "-reopen-json").props.value, "");
});

test("old review actions cannot restore wording after an edit clear or successful reopening in the same capture", () => {
 const h = scopeDraftHarness(context()); h.mount(); wording(h, "Invented original scope"); refs(h, [`${proposalId(3)}:1`]);
 const oldReview = button(h, "Review scope draft").props.onClick;
 wording(h, "Invented replacement scope"); oldReview(); assert.equal(json(h), undefined);
 button(h, "Review scope draft").props.onClick(); const saved = json(h); assert.equal(JSON.parse(saved).fields.population.wording, "Invented replacement scope");
 const beforeClear = button(h, "Review scope draft").props.onClick; button(h, "Clear scope draft").props.onClick(); beforeClear(); assert.equal(json(h), undefined);
 const blankReview = button(h, "Review scope draft").props.onClick;
 field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: saved } }); button(h, "Reopen scope preparation").props.onClick();
 blankReview(); assert.equal(JSON.parse(json(h)).fields.population.wording, "Invented replacement scope");
});
test("old reopen and clear actions cannot overwrite newer paste or editing in the same capture", () => {
 const h = scopeDraftHarness(context()); h.mount(); wording(h, "Invented original scope"); refs(h, [`${proposalId(3)}:2`]); button(h, "Review scope draft").props.onClick(); const saved = json(h);
 field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: saved } }); const oldReopen = button(h, "Reopen scope preparation").props.onClick;
 wording(h, "Invented newer scope"); oldReopen(); assert.equal(json(h), undefined); assert.equal(field(h, "textarea", "-population-wording").props.value, "Invented newer scope");
 const oldClear = button(h, "Clear scope draft").props.onClick;
 wording(h, "Invented latest scope"); oldClear(); assert.equal(field(h, "textarea", "-population-wording").props.value, "Invented latest scope");
 field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: "{}" } }); oldReopen(); assert.equal(json(h), undefined);
 button(h, "Clear scope draft").props.onClick(); oldReopen(); assert.equal(json(h), undefined);
});
