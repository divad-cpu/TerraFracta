import assert from "node:assert/strict";
import test from "node:test";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
import { currentIssueFilterActions } from "../src/current-issue-filter-actions.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const rows = sample();
const decision = await createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)), () => performance.now(), () => {})(rows.requestedRoute);
assert.equal(decision.status, 200);
const issue = decision.issue;
const params = action => Object.fromEntries(new URL(action.href, "https://example.invalid").searchParams);
const selected = (view, query = {}) => currentIssueSelection(view, { edition: issue.publicationId, ...query });

test("individual source filters remove exactly one field and bind the current edition", () => {
  const actions = currentIssueFilterActions(issue, selected("sources", { q: "cell A1", type: "condition", relation: "supports" }));
  assert.deepEqual(actions.map(a => a.field), ["q", "type", "relation"]);
  for (const action of actions) {
    const expected = { edition: issue.publicationId, q: "cell A1", type: "condition", relation: "supports" };
    delete expected[action.field];
    assert.deepEqual(params(action), expected);
    assert.ok(currentIssueSelection("sources", params(action)));
    assert.equal(new URL(action.href, "https://example.invalid").pathname, `/reader-preview/${issue.jurisdictionSlug}/${issue.issueSlug}/sources`);
  }
  assert.equal(actions[1].value, "Observed condition");
  assert.equal(actions[2].value, "Supports this wording");
  assert.ok(Object.isFrozen(actions) && actions.every(Object.isFrozen));
});
test("search removal preserves the remaining query or type and never introduces a reference role", () => {
  const actions = currentIssueFilterActions(issue, selected("search", { q: "cell A1", type: "condition" }));
  assert.deepEqual(actions.map(a => a.field), ["q", "type"]);
  assert.deepEqual(params(actions[0]), { edition: issue.publicationId, type: "condition" });
  assert.deepEqual(params(actions[1]), { edition: issue.publicationId, q: "cell A1" });
  assert.deepEqual(currentIssueFilterActions(issue, selected("search")), []);
  assert.deepEqual(currentIssueFilterActions(issue, selected("issue")), []);
});
test("a checked directory selection survives each filter removal without becoming dossier search words", () => {
  const local = { ...issue, jurisdictionSlug: "norway", issueSlug: "housing-costs" };
  const selection = selected("sources", { q: "footnote", relation: "context", directoryView: "issues", directoryQ: "Norway housing", directoryCountry: "norway", directoryTopic: "housing" });
  assert.ok(selection);
  const actions = currentIssueFilterActions(local, selection);
  assert.equal(actions.length, 2);
  for (const action of actions) {
    const query = params(action);
    assert.equal(query.directoryQ, "Norway housing");
    assert.equal(query.directoryView, "issues");
    assert.equal(query.directoryCountry, "norway");
    assert.equal(query.directoryTopic, "housing");
    assert.equal(query.q, action.field === "q" ? undefined : "footnote");
    assert.ok(currentIssueSelection("sources", query));
  }
});
test("an unbound caller cannot acquire directory context through filter removal", () => {
  const local = { ...issue, jurisdictionSlug: "norway", issueSlug: "housing-costs" };
  const bound = currentIssueSelection("sources", { edition: issue.publicationId, q: "footnote", relation: "context", directoryView: "issues", directoryQ: "Norway housing", directoryCountry: "norway", directoryTopic: "housing" });
  assert.ok(bound?.directory);
  const actions = currentIssueFilterActions(local, { ...bound, publicationId: null });
  assert.equal(actions.length, 2);
  for (const action of actions) {
    const q = params(action);
    assert.equal(q.edition, issue.publicationId);
    assert.ok(!Object.keys(q).some(key => key.startsWith("directory")));
    assert.equal(q.q, action.field === "q" ? undefined : "footnote");
    assert.equal(q.relation, action.field === "relation" ? undefined : "context");
    assert.ok(currentIssueSelection("sources", q));
  }
});
test("filters use the existing normalization and URL encoding without accepting a different edition", () => {
  const actions = currentIssueFilterActions(issue, selected("sources", { q: "Ａ1 & <script>", relation: "context" }));
  assert.equal(params(actions.find(a => a.field === "relation")).q, "A1 & <script>");
  assert.ok(!actions.some(a => a.href.includes("<script>")));
  assert.deepEqual(currentIssueFilterActions(issue, { ...selected("sources", { q: "cell" }), publicationId: "aa000000-0000-4000-8000-000000000099" }), []);
  assert.deepEqual(currentIssueFilterActions(issue, { ...selected("sources"), relation: "constructor" }), []);
  assert.deepEqual(currentIssueFilterActions(issue, { ...selected("search"), relation: "supports" }), []);
});
test("own closed fields are captured once and invalid input produces no filter actions", () => {
  let observed = 0;
  const input = { ...selected("sources", { type: "condition" }), get query() { observed++; return observed === 1 ? "cell A1" : "LATER_PRIVATE_CANARY"; } };
  const actions = currentIssueFilterActions(issue, input);
  assert.equal(observed, 1);
  assert.equal(params(actions.find(a => a.field === "type")).q, "cell A1");
  const unknown = { ...input, extra: "unsupported" };
  observed = 0;
  Object.defineProperty(unknown, "query", { enumerable: true, get() { observed++; throw new Error("PRIVATE_FAILURE"); } });
  assert.deepEqual(currentIssueFilterActions(issue, unknown), []);
  assert.equal(observed, 0);
  assert.deepEqual(currentIssueFilterActions(issue, Object.create(selected("sources", { q: "cell" }))), []);
  assert.deepEqual(currentIssueFilterActions(issue, Object.defineProperty(selected("sources"), "query", { enumerable: true, get() { throw new Error("PRIVATE_FAILURE"); } })), []);
});
