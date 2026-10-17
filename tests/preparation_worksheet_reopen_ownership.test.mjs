import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
import * as scope from "../src/issue-scope-draft.ts";
import * as responsibility from "../src/responsibility-draft.ts";
const cases = [
  { part: "scope", create: c => scopeDraftHarness(c), reopen: "Reopen scope preparation", clear: "Clear scope draft", paste: "-reopen-json" },
  { part: "responsibility", create: c => responsibilityDraftHarness(c), reopen: "Reopen responsibility preparation", clear: "Clear responsibility draft", paste: "-reopen-json" },
  ...[
    ["policyEvents", "policy-event-draft-view", "PolicyEventDraftView", "Reopen event preparation", "Clear event draft"],
    ["funding", "funding-draft-view", "FundingDraftView", "Reopen funding preparation", "Clear funding draft"],
    ["indicators", "indicator-draft-view", "IndicatorDraftView", "Reopen indicator preparation", "Clear indicator draft"],
    ["delivery", "delivery-draft-view", "DeliveryDraftView", "Reopen delivery preparation", "Clear delivery draft"],
  ].map(([part, file, name, reopen, clear]) => ({ part, reopen, clear, paste: "-paste", create: c => responsibilityDraftHarness(c, undefined, { url: new URL(`../src/${file}.tsx`, import.meta.url), name }) })),
];
const button = (h, name) => h.nodes().find(n => n.type === "button" && n.props.children === name)?.props.onClick ?? assert.fail(name);
const paste = (h, config, value) => h.nodes().find(n => n.type === "textarea" && n.props.id?.endsWith(config.paste)).props.onChange({ currentTarget: { value } });
const body = h => renderToStaticMarkup(h.render());
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;

for (const config of cases) for (const action of ["Clear", "newer copied text", "newer valid reopen"]) {
  test(`${config.part} old invalid Reopen cannot alter ${action} admitted during original parsing`, t => {
    t.mock.method(globalThis, "fetch", () => assert.fail("No source request permitted"));
    const c = packetContext(), json = packetParts(c)[config.part], h = config.create(c); h.mount();
    const invalid = "OLD_INVALID_WORKSHEET_COPY"; paste(h, config, invalid); const parse = JSON.parse;
    let retired = false, expected;
    t.mock.method(JSON, "parse", (text, ...args) => {
      if (!retired && text === invalid) {
        retired = true;
        if (action === "Clear") button(h, config.clear)();
        else { paste(h, config, action === "newer valid reopen" ? json : "NEWER_PRIVATE_COPIED_TEXT"); if (action === "newer valid reopen") { button(h, config.reopen)(); assert.equal(output(h), json); } }
        expected = body(h);
      }
      return parse(text, ...args);
    });
    button(h, config.reopen)(); assert.equal(retired, true); assert.equal(body(h), expected, "An old failed parser must preserve the complete newer display and editable copies"); h.unmount();
  });
}

for (const config of cases) test(`${config.part} an old valid Reopen cannot reinstall its fields after a newer Clear during parsing`, t => {
  const c = packetContext(), json = packetParts(c)[config.part], h = config.create(c); h.mount(); paste(h, config, json);
  const parse = JSON.parse; let retired = false, expected;
  t.mock.method(JSON, "parse", (text, ...args) => {
    if (!retired && text === json) { retired = true; button(h, config.clear)(); expected = body(h); }
    return parse(text, ...args);
  });
  button(h, config.reopen)(); assert.equal(retired, true); assert.equal(body(h), expected, "A checked old copy must not undo newer Clear"); assert.equal(output(h), undefined); h.unmount();
});

for (const config of [
  { part: "scope", file: "issue-scope-draft-view", name: "IssueScopeDraftView", module: "./issue-scope-draft.ts", actual: scope,
    check: "checkScopeDraft", json: "scopeDraftJson", feedback: "scopeDraftFieldFeedback", clear: "Clear scope draft", review: "Review scope draft" },
  { part: "responsibility", file: "responsibility-draft-view", name: "ResponsibilityDraftView", module: "./responsibility-draft.ts", actual: responsibility,
    check: "checkResponsibilityDraft", json: "responsibilityDraftJson", feedback: "responsibilityDraftFieldFeedback", clear: "Clear responsibility draft", review: "Review responsibility draft" },
]) for (const port of ["check", "json", "feedback"]) test(`${config.part} Review cannot undo Clear observed by its original ${port} function`, () => {
  let h, retired = false, expected;
  const create = sharedViewModule(new URL(`../src/${config.file}.tsx`, import.meta.url), config.name, name => name === config.module ? {
    ...config.actual, [config[port]](...args) {
      const result = config.actual[config[port]](...args);
      if (!retired) { retired = true; button(h, config.clear)(); expected = h.html(); }
      return result;
    },
  } : undefined);
  h = create({ context: packetContext() }); h.commit();
  if (port === "feedback") {
    if (config.part === "scope") h.nodes().find(n => n.type === "textarea" && n.props.id?.endsWith("-population-wording")).props.onChange({ currentTarget: { value: "Unreferenced preparation" } });
    else button(h, "Add responsibility entry")();
  }
  button(h, config.review)(); assert.equal(retired, true); assert.equal(h.html(), expected); assert.equal(output(h), undefined); h.unmount();
});
