import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { proposalReport, proposalScope } from "./helpers/proposal_fixture.mjs";
import { heldReport, heldScope } from "./helpers/operator_held_fixture.mjs";
import { packetReport } from "./helpers/preparation_packet_fixture.mjs";
import { assertUnsentProposalControls, assertReadOnlyHeldForms } from "./helpers/inspection_controls.mjs";

const Proposal = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)).ProposalComparisonView;
const Held = loadTsx(new URL("../src/operator-held-decisions-view.tsx", import.meta.url)).HeldDecisionsView;
const proposal = () => renderToStaticMarkup(createElement(Proposal, {
  decision: { kind: "ok", report: proposalReport() }, selection: proposalScope(),
}));
const held = () => renderToStaticMarkup(createElement(Held, {
  decision: { kind: "ok", report: heldReport() }, selection: heldScope(),
}));

const joinedPreparationButtons = ["Clear reference finder", "Show all reference choices",
    "Reopen scope preparation", "Review scope draft", "Clear scope draft", "Show all responsibility reference choices", "Add responsibility entry",
    "Review responsibility draft", "Clear responsibility draft", "Reopen responsibility preparation",
    "Show all event reference choices", "Add event entry", "Inspect unsent event draft", "Clear event draft", "Reopen event preparation",
    "Show all funding reference choices", "Add funding entry", "Inspect unsent funding draft", "Clear funding draft", "Reopen funding preparation",
    "Show all indicator reference choices", "Add indicator entry", "Inspect unsent indicator draft", "Clear indicator draft", "Reopen indicator preparation",
    "Show all delivery reference choices", "Add delivery entry", "Inspect unsent delivery draft", "Clear delivery draft", "Reopen delivery preparation",
    "Show all milestone reference choices", "Add milestone entry", "Inspect unsent milestone draft", "Clear milestone draft", "Reopen milestone preparation",
    "Show all evaluation reference choices", "Add evaluation entry", "Review evaluation draft", "Clear evaluation draft", "Reopen evaluation preparation",
    "Inspect combined preparation packet", "Clear preparation packet", "Read saved preparation packet", "Reopen preparation packet",
    "Review separate evaluation bundle", "Clear separate evaluation bundle", "Reopen separate evaluation bundle", "Inspect preparations together", "Clear preparation overview"];

test("actual checked proposals keep captured content immutable and local preparation unadmitted in server markup", () => {
  assertUnsentProposalControls(proposal());
});

test("proposal guard detects injected enabled, submit and foreign preparation controls", () => {
  const original = proposal();
  for (const changed of [original.replace(/(<details class="issue-scope-preparation"[\s\S]*?) disabled=""/, "$1"),
    original.replace(/(<button\b[^>]*?) disabled=""/, "$1"),
    original.replace('type="button"', 'type="submit"'),
    original + '<button type="button" disabled="">Approve publication</button>']) {
    assert.notEqual(changed, original);
    assert.throws(() => assertUnsentProposalControls(changed), assert.AssertionError);
  }
});

test("all eight private worksheets and separate packet File controls remain unadmitted in actual server markup", () => {
  const html = renderToStaticMarkup(createElement(Proposal, {
    decision: { kind: "ok", report: packetReport() }, selection: proposalScope(),
  }));
  assertUnsentProposalControls(html, joinedPreparationButtons);
  assert.match(html, /type="file"[^>]*disabled=""/);
  assert.doesNotMatch(html, />Download private preparation packet<|readOnly=""/);
});

test("actual held references and reasons use only the two fixed GET inspection forms", () => {
  assertReadOnlyHeldForms(held());
});

test("held guard detects write methods, foreign actions and per-button write overrides", () => {
  const original = held();
  for (const changed of [original.replace('method="get"', 'method="post"'),
    original.replace('action="/editorial-preview/held"', 'action="https://foreign.invalid/write"'),
    original.replace('type="submit"', 'type="submit" formmethod="post"'),
    ...["submit", "image", "button", "reset"].map(type =>
      original.replace('</form>', `<input type="${type}" value="Approve publication"/></form>`))]) {
    assert.notEqual(changed, original);
    assert.throws(() => assertReadOnlyHeldForms(changed), assert.AssertionError);
  }
});

// The additional controls stay under the exact existing no-submit/no-write guard.
test("new milestone evaluation and bundle buttons cannot become enabled or submitting in server markup", () => {
  const html = renderToStaticMarkup(createElement(Proposal, { decision: { kind: "ok", report: packetReport() }, selection: proposalScope() }));
  assertUnsentProposalControls(html, joinedPreparationButtons);
  for (const label of ["Show all milestone reference choices", "Add milestone entry", "Inspect unsent milestone draft", "Clear milestone draft", "Reopen milestone preparation",
    "Show all evaluation reference choices", "Add evaluation entry", "Review evaluation draft", "Clear evaluation draft", "Reopen evaluation preparation",
    "Review separate evaluation bundle", "Clear separate evaluation bundle", "Reopen separate evaluation bundle", "Inspect preparations together", "Clear preparation overview"]) {
    const tag = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]).find(value => value.endsWith(`>${label}</button>`));
    assert.ok(tag, label); assert.match(tag, / disabled=""/); assert.match(tag, /type="button"/);
    for (const changed of [tag.replace(' disabled=""', ''), tag.replace('type="button"', 'type="submit"')])
      assert.throws(() => assertUnsentProposalControls(html.replace(tag, changed), joinedPreparationButtons), assert.AssertionError, label);
  }
});
