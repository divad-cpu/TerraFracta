import assert from "node:assert/strict";
import test from "node:test";
import { decidePublicReadResponse } from "../src/public-read-response.ts";

test("absent and rejected candidates get distinct non-cached, detail-free decisions", () => {
  assert.deepEqual(decidePublicReadResponse({ kind: "absent" }),
    { status: 404, cacheControl: "no-store" });
  assert.deepEqual(decidePublicReadResponse({ kind: "rejected" }),
    { status: 503, cacheControl: "no-store" });
});

test("only a validated issue outcome carries display data", () => {
  const issue = { issueSlug: "fictional-issue" };
  const result = decidePublicReadResponse({ kind: "issue", issue });
  assert.equal(result.status, 200);
  assert.equal(result.cacheControl, "no-store");
  assert.strictEqual(result.issue, issue);
});
