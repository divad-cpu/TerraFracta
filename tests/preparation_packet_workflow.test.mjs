import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts, packetReport } from "./helpers/preparation_packet_fixture.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
const flush = () => new Promise(resolve => setImmediate(resolve));
const button = (h, label) => h.nodes().find(node => node.type === "button" && [node.props.children].flat().join("") === label) ?? assert.fail(label);
const click = (h, label) => button(h, label).props.onClick();
const suffix = (h, text) => h.nodes().find(node => node.props.id?.endsWith(text)) ?? assert.fail(text);
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const change = (h, ending, value) => suffix(h, ending).props.onChange({ currentTarget: { value } });
const options = (h, ending, references) => suffix(h, ending).props.onChange({ currentTarget: {
  selectedOptions: references.map(ref => ({ value: `${ref.claimId}:${ref.referenceNumber}` })),
} });
const configurations = {
  policyEvents: { file: "policy-event-draft-view", name: "PolicyEventDraftView", add: "Add event entry", inspect: "Inspect unsent event draft", reopen: "Reopen event preparation", aria: "Unsent event controls" },
  funding: { file: "funding-draft-view", name: "FundingDraftView", add: "Add funding entry", inspect: "Inspect unsent funding draft", reopen: "Reopen funding preparation", aria: "Unsent funding controls" },
  indicators: { file: "indicator-draft-view", name: "IndicatorDraftView", add: "Add indicator entry", inspect: "Inspect unsent indicator draft", reopen: "Reopen indicator preparation", aria: "Unsent indicator controls" },
  delivery: { file: "delivery-draft-view", name: "DeliveryDraftView", add: "Add delivery entry", inspect: "Inspect unsent delivery draft", reopen: "Reopen delivery preparation", aria: "Unsent delivery controls" },
};
const view = (context, config) => responsibilityDraftHarness(context, undefined, { url: new URL(`../src/${config.file}.tsx`, import.meta.url), name: config.name });
const packetView = context => view(context, { file: "preparation-packet-view", name: "PreparationPacketView" });

// Fill names actually rendered by the four native uncontrolled worksheets.
// These are explicit structural control doubles, not DOM or Browser evidence.
function controlValues(h, entry, config) {
  // All four native worksheet reference controls preserve selections while filtering.
  // Drive their actual handlers before collecting the same exact native values.
  for (const node of h.nodes().filter(node => node.props.multiple && node.props.name)) {
      const name = node.props.name, key = name.slice(name.indexOf(".") + 1).replace(/References$/, "");
      const references = entry.fields[key]?.references ?? [];
      node.props.onChange({ currentTarget: { selectedOptions: { length: references.length,
        item: index => references[index] ? { value: `${references[index].claimId}:${references[index].referenceNumber}` } : null } } });
  }
  const controls = h.nodes().filter(node => node.props.name && ["input", "textarea", "select"].includes(node.type)).map(node => {
    const name = node.props.name, fieldName = name.slice(name.indexOf(".") + 1);
    if (node.props.multiple) {
      const field = entry.fields[fieldName.replace(/References$/, "")], selected = field?.references ?? [];
      assert.deepEqual(node.props.value, selected.map(ref => `${ref.claimId}:${ref.referenceNumber}`));
      return { tagName: "SELECT", getAttribute: key => key === "name" ? name : null, multiple: true,
        selectedOptions: { length: selected.length, item: index => selected[index] ? { value: `${selected[index].claimId}:${selected[index].referenceNumber}` } : null } };
    }
    let value;
    if (fieldName === "claim") value = entry.claimId;
    else if (/^(event|reported)(Precision|Value)$/.test(fieldName)) {
      const date = entry.fields[fieldName.startsWith("event") ? "eventDate" : "reportedDate"]?.date;
      value = fieldName.endsWith("Precision") ? date?.precision ?? "" : date ? date.value ?? date.label : "";
    } else { assert.ok(fieldName in entry.fields, fieldName); const field = entry.fields[fieldName]; value = field?.value ?? field?.wording ?? ""; }
    assert.equal(typeof value, "string", fieldName);
    return { tagName: node.type.toUpperCase(), type: "text", getAttribute: key => key === "name" ? name : null, multiple: false, value };
  });
  const root = h.nodes().find(node => node.props["aria-label"] === config.aria); assert.ok(root);
  root.props.ref.current = { elements: { length: controls.length, item: index => controls[index] ?? null } }; root.props.onChange();
}

function createPartsThroughViews(context) {
  const expected = packetParts(context), actual = {};
  const scope = scopeDraftHarness(context); scope.mount();
  const population = JSON.parse(expected.scope).fields.population;
  change(scope, "-population-wording", population.wording); options(scope, "-population-references", population.references);
  click(scope, "Review scope draft"); actual.scope = output(scope); scope.unmount();
  const responsibility = responsibilityDraftHarness(context); responsibility.mount(); click(responsibility, "Add responsibility entry");
  const entry = JSON.parse(expected.responsibility).entries[0]; change(responsibility, "-1-statement", entry.claimId);
  change(responsibility, "-1-institution-wording", entry.fields.institution.wording); options(responsibility, "-1-institution-references", entry.fields.institution.references);
  click(responsibility, "Review responsibility draft"); actual.responsibility = output(responsibility); responsibility.unmount();
  for (const [name, config] of Object.entries(configurations)) {
    const h = view(context, config); h.mount(); click(h, config.add); controlValues(h, JSON.parse(expected[name]).entries[0], config);
    click(h, config.inspect); actual[name] = output(h); h.unmount();
  }
  assert.deepEqual(actual, expected, "All six actual worksheets must retain the exact same separately defined copying formats");
  return actual;
}

test("joined local editing creates six drafts, packs them, requests exact native bytes, imports a File and reopens every original worksheet", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Joined local editing cannot dispatch network"));
  const context = packetContext(), parts = createPartsThroughViews(context), first = packetView(context); first.mount();
  for (const [name, value] of Object.entries(parts)) change(first, `-part-${name}`, value);
  click(first, "Inspect combined preparation packet"); const json = output(first); assert.ok(json); assert.deepEqual(JSON.parse(json).preparations, parts);
  let blob, clicks = 0, removals = 0, revocations = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), anchor = { click() { clicks++; }, remove() { removals++; } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => anchor, body: { append() {} } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", value => { blob = value; return "blob:fictional-editorial-workflow"; });
  t.mock.method(URL, "revokeObjectURL", () => { revocations++; });
  click(first, "Download private preparation packet"); assert.equal(clicks, 1); assert.equal(removals, 1); assert.equal(revocations, 1);
  assert.equal(await blob.text(), json); first.unmount();
  const second = packetView(context); second.mount();
  suffix(second, "-packet-file").props.onChange({ currentTarget: { files: [new File([blob], "private-local.json")], value: "private-path" } }); await flush();
  assert.equal(output(second), json); const reopened = JSON.parse(output(second)).preparations; second.unmount();
  for (const name of Object.keys(reopened)) {
    const h = name === "scope" ? scopeDraftHarness(context) : name === "responsibility" ? responsibilityDraftHarness(context) : view(context, configurations[name]);
    h.mount(); change(h, name === "scope" || name === "responsibility" ? "-reopen-json" : "-paste", reopened[name]);
    click(h, name === "scope" ? "Reopen scope preparation" : name === "responsibility" ? "Reopen responsibility preparation" : configurations[name].reopen);
    assert.equal(output(h), parts[name], name); h.unmount();
  }
});

test("a new source receipt with unchanged proposal wording requires a new captured handoff and refuses the old saved packet", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Receipt-bound file reopening cannot dispatch network"));
  const report = packetReport(), before = capturedScopeDraftContext(report), first = packetView(before); first.mount();
  change(first, "-part-scope", packetParts(before).scope); click(first, "Inspect combined preparation packet"); const saved = output(first); first.unmount();
  report.sourceReceipts[1].contentSha256 = "c".repeat(64); const next = capturedScopeDraftContext(report); assert.ok(next);
  assert.equal(next.binding.proposalSha256, before.binding.proposalSha256); assert.notEqual(next.binding.comparisonSha256, before.binding.comparisonSha256);
  const h = packetView(next); h.mount(); const currentScope = packetParts(next).scope; change(h, "-part-scope", currentScope);
  suffix(h, "-packet-file").props.onChange({ currentTarget: { files: [new File([saved], "private-local.json")], value: "private-path" } }); await flush();
  assert.equal(output(h), undefined); assert.equal(suffix(h, "-part-scope").props.value, currentScope);
  click(h, "Inspect combined preparation packet"); assert.equal(JSON.parse(output(h)).binding.comparisonSha256, next.binding.comparisonSha256); h.unmount();
});

test("six actual worksheet outputs can be read together before replacement and then reopened in their original editors", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Private joined reading cannot dispatch network"));
  const context = packetContext(), parts = createPartsThroughViews(context), first = packetView(context); first.mount();
  for (const [name, value] of Object.entries(parts)) change(first, `-part-${name}`, value);
  click(first, "Inspect combined preparation packet"); const json = output(first); assert.ok(json); first.unmount();
  const second = packetView(context); second.mount(); change(second, "-part-scope", "UNFINISHED_CURRENT_SCOPE");
  change(second, "-part-responsibility", "UNFINISHED_CURRENT_RESPONSIBILITY"); change(second, "-packet-paste", json);
  click(second, "Read saved preparation packet"); const html = renderToStaticMarkup(second.render());
  assert.match(html, /<h3>Saved preparation reading/); assert.match(html, /What Reopen would do to typed copies/);
  for (const value of ["Invented local population", "Invented authority", "Announcement", "-0.000", "Withheld", "Pilot"]) assert.ok(html.includes(value), value);
  assert.equal(suffix(second, "-part-scope").props.value, "UNFINISHED_CURRENT_SCOPE");
  assert.equal(suffix(second, "-part-responsibility").props.value, "UNFINISHED_CURRENT_RESPONSIBILITY"); assert.equal(output(second), undefined);
  click(second, "Reopen preparation packet"); assert.equal(output(second), json);
  const reopened = JSON.parse(output(second)).preparations; second.unmount();
  for (const name of Object.keys(reopened)) {
    const h = name === "scope" ? scopeDraftHarness(context) : name === "responsibility" ? responsibilityDraftHarness(context) : view(context, configurations[name]);
    h.mount(); change(h, name === "scope" || name === "responsibility" ? "-reopen-json" : "-paste", reopened[name]);
    click(h, name === "scope" ? "Reopen scope preparation" : name === "responsibility" ? "Reopen responsibility preparation" : configurations[name].reopen);
    assert.equal(output(h), parts[name], name); h.unmount();
  }
});

test("saved-copy reading refuses a source-receipt-only comparison change without silently rebinding unfinished typed material", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Source-bound saved reading cannot dispatch network"));
  const report = packetReport(), before = capturedScopeDraftContext(report), first = packetView(before); first.mount();
  change(first, "-part-scope", packetParts(before).scope); click(first, "Inspect combined preparation packet"); const json = output(first); first.unmount();
  report.sourceReceipts[1].contentSha256 = "d".repeat(64); const next = capturedScopeDraftContext(report); assert.ok(next);
  assert.equal(next.binding.proposalSha256, before.binding.proposalSha256); assert.notEqual(next.binding.comparisonSha256, before.binding.comparisonSha256);
  const h = packetView(next); h.mount(); change(h, "-part-scope", "CURRENT_UNFINISHED_PRIVATE_COPY"); change(h, "-packet-paste", json);
  click(h, "Read saved preparation packet"); const html = renderToStaticMarkup(h.render());
  assert.match(html, /Saved preparation reading held/); assert.doesNotMatch(html, /<h4>Private preparation reading|What Reopen would do to typed copies/);
  assert.equal(suffix(h, "-part-scope").props.value, "CURRENT_UNFINISHED_PRIVATE_COPY"); assert.equal(output(h), undefined); h.unmount();
});
