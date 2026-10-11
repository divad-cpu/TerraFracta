import assert from "node:assert/strict";
import test from "node:test";
import * as navigation from "../src/current-issue-navigation.ts";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";

const issue = () => parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const selected = navigation.currentIssueSelection;
const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("issue inspection retains a normalized bounded search selection separately from its complete dossier", () => {
  const record = issue();
  const result = selected("issue", { edition: record.publicationId, returnView: "search", returnQ: " Ｃｅｌｌ A1 ", returnType: "condition" });
  assert.deepEqual(result, { view: "issue", publicationId: record.publicationId, query: "", statementType: "", relation: "",
    returnTo: { view: "search", query: "Cell A1", statementType: "condition", relation: "" } });
  assert.ok(Object.isFrozen(result.returnTo));
});

test("reference returns retain a source role and all closed statement types without changing the plain issue contract", () => {
  const record = issue();
  for (const type of ["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation", ""])
    for (const relation of ["supports", "contradicts", "context", ""]) {
      const result = selected("issue", { edition: record.publicationId, returnView: "sources", returnType: type, returnRelation: relation });
      assert.deepEqual(result.returnTo, { view: "sources", query: "", statementType: type, relation });
    }
  assert.deepEqual(selected("issue", {}), { view: "issue", publicationId: null, query: "", statementType: "", relation: "" });
  assert.equal(selected("issue", { q: "cell" }), null);
});

test("return context requires its own edition and closed view and never accepts duplicate private or foreign selectors", () => {
  const valid = { edition: issue().publicationId, returnView: "search" };
  for (const query of [{ returnView: "search" }, { ...valid, edition: [valid.edition] }, { ...valid, edition: "" },
    { ...valid, returnView: undefined }, { ...valid, returnView: ["search"] }, { ...valid, returnView: "issue" },
    { ...valid, returnView: "/private" }, { ...valid, returnView: "https://example.invalid" },
    { ...valid, returnType: "constructor" }, { ...valid, returnRelation: "" }, { ...valid, returnRelation: "supports" },
    { ...valid, returnQ: ["one", "two"] }, { ...valid, returnQ: null }, { ...valid, returnQ: "q\u0000" },
    { ...valid, returnQ: "x".repeat(81) }, { ...valid, returnQ: "\ufdfa".repeat(5) },
    { ...valid, q: "cell" }, { ...valid, returnTo: "private" }, { ...valid, source: "private" },
    { edition: valid.edition, returnQ: "cell" }, { ...valid, returnView: "sources", returnRelation: "__proto__" }])
    assert.equal(selected("issue", query), null);
  for (const view of ["search", "sources"]) assert.equal(selected(view, valid), null);
});

test("own enumerable selectors are captured once before validation and hidden inherited or throwing fields cannot choose a return", () => {
  const record = issue(); let editionReads = 0, queryReads = 0;
  const input = { get edition() { editionReads++; return editionReads === 1 ? record.publicationId : other; },
    get q() { queryReads++; return queryReads === 1 ? "cell A1" : "changed"; } };
  const legacy = selected("search", input);
  assert.equal(legacy.publicationId, record.publicationId); assert.equal(legacy.query, "cell A1");
  assert.equal(editionReads, 1); assert.equal(queryReads, 1);
  let hiddenReads = 0;
  const inherited = Object.create({ get returnView() { hiddenReads++; return "search"; }, get edition() { hiddenReads++; return record.publicationId; } });
  assert.deepEqual(selected("issue", inherited), selected("issue", {})); assert.equal(hiddenReads, 0);
  const hidden = {};
  Object.defineProperty(hidden, "returnView", { get() { hiddenReads++; return "search"; } });
  assert.deepEqual(selected("issue", hidden), selected("issue", {})); assert.equal(hiddenReads, 0);
  assert.equal(selected("issue", Object.assign(Object.create({ edition: record.publicationId }), { returnView: "search" })), null);
  assert.doesNotThrow(() => assert.equal(selected("issue", { get edition() { throw new Error("UNTRUSTED"); } }), null));
});

test("a checked return is caller independent and semantic bounds apply after compatibility normalization", () => {
  const input = { edition: issue().publicationId, returnView: "sources", returnQ: "  Ｌｏｃａｔｉｏｎ  ", returnType: "funding", returnRelation: "context" };
  const result = selected("issue", input); input.returnQ = "changed"; input.returnView = "search"; input.returnRelation = "supports";
  assert.deepEqual(result.returnTo, { view: "sources", query: "Location", statementType: "funding", relation: "context" });
  assert.equal(selected("issue", { edition: input.edition, returnView: "search", returnQ: "x".repeat(80) }).returnTo.query.length, 80);
});

test("native local inspection and return URLs round trip the selected query type role and edition without foreign routing", () => {
  const record = issue();
  assert.equal(typeof navigation.currentIssueInspectionHref, "function"); assert.equal(typeof navigation.currentIssueReturnHref, "function");
  for (const [view, q, type, relation] of [["search", "A1 & returnView=sources?#", "condition", ""], ["sources", "Ｃｅｌｌ", "funding", "context"], ["sources", "", "", ""]]) {
    const selection = selected(view, { edition: record.publicationId, q, type, ...(view === "sources" ? { relation } : {}) });
    const inspection = new URL(navigation.currentIssueInspectionHref(record, selection), "https://example.invalid");
    assert.equal(inspection.pathname, "/reader-preview/imaginary-place/sample-housing-measure/issue");
    assert.equal(inspection.searchParams.get("edition"), record.publicationId); assert.equal(inspection.searchParams.get("returnView"), view);
    const checked = selected("issue", Object.fromEntries(inspection.searchParams)); assert.ok(checked);
    const restored = new URL(navigation.currentIssueReturnHref(record, checked), "https://example.invalid");
    assert.equal(restored.pathname, "/reader-preview/imaginary-place/sample-housing-measure/" + view);
    const back = selected(view, Object.fromEntries(restored.searchParams)); assert.deepEqual(back, selection);
    assert.equal(navigation.currentIssueReturnHref(record, { ...checked, publicationId: other }), null);
  }
  assert.equal(navigation.currentIssueReturnHref(record, selected("issue", { edition: record.publicationId })), null);
});
