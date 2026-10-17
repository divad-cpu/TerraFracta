import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
const assertion = "A fictional authority records an example provision.";
async function example() {
  const rows = sixStagePilotRows();
  for (const type of ["funding", "delivery"]) {
    const claim = rows.publication.snapshot.claims.find(row => row.type === type); claim.assertion = assertion;
    const stored = rows.claims.find(row => row.id === claim.id); stored.assertion = assertion; stored.assertion_review.display_assertion = assertion;
  }
  const read = createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)), () => 0, () => assert.fail("diagnostic"));
  const decision = await read(rows.requestedRoute); assert.equal(decision.status, 200); return decision.issue;
}
const control = (tree, type, suffix) => elements(tree).find(row => row.type === type && row.props.id?.endsWith(`-${suffix}`));
const choices = tree => elements(control(tree, "select", "claim")).filter(row => row.type === "option");
const option = (tree, id) => choices(tree).find(row => row.props.value === id);
const prepare = tree => elements(tree).find(row => row.type === "button" && row.props.children === "Review draft").props.onClick();
const request = editor => editor.states().find(value => value?.requestId && value.draft);

test("duplicate current wording has unique numbered type and period choices matching the dossier order", async () => {
  const issue = await example(), editor = editorHarness(issue, "current"), tree = editor.render();
  const funding = issue.claims.find(row => row.type === "funding"), delivery = issue.claims.find(row => row.type === "delivery");
  const fundingHtml = renderToStaticMarkup(option(tree, funding.id)), deliveryHtml = renderToStaticMarkup(option(tree, delivery.id));
  assert.match(fundingHtml, /Statement 3.*Funding.*Example 2024 budget/);
  assert.match(deliveryHtml, /Statement 4.*Delivery.*Example 2025 delivery/);
  assert.ok(fundingHtml.includes(assertion)); assert.ok(deliveryHtml.includes(assertion));
  assert.equal(choices(tree).length, 7); assert.equal(choices(tree)[0].props.children, "Entire page");
  const html = renderToStaticMarkup(tree); assert.match(html, /Numbers follow this edition&#x27;s statement order/);
});

test("actual target selection and preview distinguish identical wording without changing minimal unsent request", async () => {
  const issue = await example(), editor = editorHarness(issue, "current");
  let previousId;
  for (const [type, number, label] of [["funding", 3, "Funding"], ["delivery", 4, "Delivery"]]) {
    const claim = issue.claims.find(row => row.type === type); let tree = editor.render();
    control(tree, "select", "claim").props.onChange({ target: { value: claim.id } }); tree = editor.render();
    assert.equal(control(tree, "textarea", "detail").props.value, ""); assert.equal(request(editor), undefined);
    control(tree, "textarea", "detail").props.onChange({ target: { value: "Invented note about the exact selected statement." } }); tree = editor.render(); prepare(tree); tree = editor.render();
    const intent = request(editor); assert.equal(intent.draft.target.claimId, claim.id); assert.equal(intent.draft.target.publicationId, issue.publicationId);
    assert.notEqual(intent.requestId, previousId); previousId = intent.requestId;
    const preview = /<div class="correction-preview__card">([\s\S]*?)<p class="correction-preview__status">/.exec(renderToStaticMarkup(tree))?.[1] ?? "";
    assert.match(preview, new RegExp(`Statement ${number}.*${label}.*${claim.periodLabel}`)); assert.ok(preview.includes(assertion));
    const anchor = elements(tree).find(row => row.type === "a" && row.props.children === "Inspect the affected statement and its references");
    assert.equal(anchor.props.href, `#claim-${claim.id}`);
    const { IssueEvidence } = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url));
    const dossier = renderToStaticMarkup(IssueEvidence({ issue }));
    assert.equal((dossier.match(new RegExp(`id="claim-${claim.id}"`, "g")) ?? []).length, 1);
    assert.deepEqual(Object.keys(intent.draft).sort(), ["fields", "target"]); assert.ok(!Object.hasOwn(intent.draft, "statementNumber"));
  }
});

test("same type period and wording remain distinguishable by edition order while page scope has no invented statement number", async () => {
  const issue = await example(); const first = structuredClone(issue.claims[0]);
  issue.claims = [first, { ...structuredClone(first), id: "bb000000-0000-4000-8000-000000000001" }];
  const editor = editorHarness(issue, "current"); let tree = editor.render();
  for (const [index, claim] of issue.claims.entries()) assert.match(renderToStaticMarkup(option(tree, claim.id)), new RegExp(`Statement ${index + 1}.*Observed condition.*Example year`));
  control(tree, "textarea", "detail").props.onChange({target:{value:"Invented page-scoped note for this example."}});tree=editor.render();prepare(tree);tree=editor.render();
  const preview=/<div class="correction-preview__card">([\s\S]*?)<p class="correction-preview__status">/.exec(renderToStaticMarkup(tree))?.[1]??"";
  assert.match(preview,/Entire page/);assert.doesNotMatch(preview,/<dt>Statement reference<\/dt>/);assert.equal(request(editor).draft.target.claimId,null);
});
