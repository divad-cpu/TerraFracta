import assert from "node:assert/strict";
import test from "node:test";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { checkScopeDraft, scopeDraftJson, scopeReferenceKey } from "../src/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { correctionDraftFieldsSchema } from "../src/correction-target.ts";

const node = (h, suffix) => h.nodes().find(item => item.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const review = h => h.nodes().find(item => item.type === "button" && item.props.children === "Review scope draft").props.onClick();
const preview = h => h.nodes().find(item => item.type === "textarea" && item.props.readOnly)?.props.value;
const edit = (h, wording) => node(h, "-population-wording").props.onChange({ currentTarget: { value: wording } });
const choose = (h, context) => node(h, "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value: scopeReferenceKey(context.claims[0].id, 1) }] } });

test("the native wording control has room for a full valid 1200-code-point supplementary string", () => {
  const context = capturedScopeDraftContext(proposalReport()), wording = "😀".repeat(1200);
  const candidate = checkScopeDraft({ schemaVersion: 1, kind: "issue_scope_preparation", binding: context.binding,
    fields: { population: { wording, references: [{ claimId: context.claims[0].id, referenceNumber: 1 }] }, period: null, selectionRationale: null } }, context);
  assert.ok(candidate); assert.equal(typeof scopeDraftJson(candidate, context), "string");
  const h = scopeDraftHarness(context); h.mount();
  try { assert.ok(node(h, "-population-wording").props.maxLength >= wording.length,
    "Browser maxLength counts UTF-16 units; it must not preclude wording admitted by the pinned schema"); }
  finally { h.unmount(); }
});

test("the reader's unsent correction explanation can represent its full admitted supplementary wording", () => {
  const issue = parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope)), wording = "😀".repeat(1000);
  assert.equal(correctionDraftFieldsSchema.shape.details.safeParse(wording).success, true);
  const h = editorHarness(issue, "current");
  try {
    const field = elements(h.render()).find(item => item.props.id?.endsWith("-detail")); assert.ok(field);
    assert.ok(field.props.maxLength >= wording.length, "Native correction input must fit valid Unicode wording");
  } finally { h.unmount(); }
});

test("the reader's explanation counter agrees with the canonical trimmed code-point length", () => {
  const issue = parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope)), h = editorHarness(issue, "current");
  try {
    const field = elements(h.render()).find(item => item.props.id?.endsWith("-detail"));
    field.props.onChange({ target: { value: "  " + "😀".repeat(10) + "  " } });
    const tree = h.render(), hint = elements(tree).find(item => item.props.id?.endsWith("-detail-guidance"));
    assert.ok(hint); assert.match(renderToStaticMarkup(hint), />10 \/ 1000 characters/);
  } finally { h.unmount(); }
});

test("valid Unicode correction text prepares only an unsent exact request; excess wording stays blocked without a request", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Unsent editing has no network action"));
  const issue = parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope)), h = editorHarness(issue, "current");
  const field = () => elements(h.render()).find(item => item.props.id?.endsWith("-detail"));
  const button = () => elements(h.render()).find(item => item.type === "button" && item.props.children === "Review draft");
  try {
    for (const wording of ["x".repeat(1001), "😀".repeat(1001), "e\u0301".repeat(501)]) {
      field().props.onChange({ target: { value: wording } });
      assert.equal(button().props.disabled, true); button().props.onClick();
      assert.equal(h.states().find(value => value?.requestId && value.draft), undefined);
    }
    const wording = "😀".repeat(1000); field().props.onChange({ target: { value: wording } });
    assert.equal(button().props.disabled, false); button().props.onClick();
    const prepared = h.states().find(value => value?.requestId && value.draft); assert.ok(prepared);
    assert.equal(prepared.draft.fields.details, wording); assert.equal(prepared.draft.target.publicationId, issue.publicationId);
    assert.match(renderToStaticMarkup(h.render()), /No message was sent and no record was created/);
  } finally { h.unmount(); }
});

test("valid supplementary wording stays exact through review, while 1201 ASCII characters are held and recoverable", () => {
  const context = capturedScopeDraftContext(proposalReport()), codes = [];
  const observed = scopeDraftHarness(context, code => codes.push(code)); observed.mount();
  try {
    choose(observed, context); edit(observed, "x".repeat(1201)); review(observed);
    assert.equal(node(observed, "-population-wording").props["aria-invalid"], true); assert.equal(preview(observed), undefined);
    const wording = "😀".repeat(1200); edit(observed, wording); review(observed);
    assert.equal(JSON.parse(preview(observed)).fields.population.wording, wording);
    assert.equal(node(observed, "-population-wording").props["aria-invalid"], undefined);
    assert.deepEqual(codes, []);
  } finally { observed.unmount(); }
});

test("the wider native input does not relax the schema for supplementary or combining characters", () => {
  const context = capturedScopeDraftContext(proposalReport()), h = scopeDraftHarness(context); h.mount();
  try {
    choose(h, context);
    for (const wording of ["😀".repeat(1201), "e\u0301".repeat(601)]) {
      edit(h, wording); review(h);
      assert.equal(preview(h), undefined); assert.equal(node(h, "-population-wording").props["aria-invalid"], true);
      assert.equal(node(h, "-population-wording").props.value, wording);
    }
  } finally { h.unmount(); }
});
