import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
const run = (issue, args = []) => spawnSync(process.execPath,
  ["--experimental-strip-types", "scripts/build_invented_correction_wire.mjs", ...args],
  { input: typeof issue === "string" ? issue : JSON.stringify(issue), encoding: "utf8", timeout: 5000 });
const firstIssue = () => ({ ...connectedInput().issue, publicationId: "92bb9213-05e0-550a-8b99-cbf65e786609" });
test("actual checked draft wire has page and visible claim with invented fields only", () => {
  const issue = firstIssue(), result = run(issue);
  assert.equal(result.status, 0, result.stderr);
  const wire = JSON.parse(result.stdout);
  assert.equal(wire.requests.length, 2);assert.equal(wire.requests[0].target.claimId, issue.claims[0].id);
  assert.equal(wire.requests[1].target.claimId, null);
  assert.deepEqual(wire.requests.map(request => request.target.revision), [1, 1]);
  assert.equal(wire.sourceRequests, 0);assert.equal(wire.realReports, 0);assert.equal(wire.submissionEnabled, false);
  assert.doesNotMatch(result.stdout, /reviewState|reportedAt|privatePath|password/);
});
test("foreign routes, mismatched revision, private fields, size and argv refuse before any wire", () => {
  const issue = firstIssue();
  for (const [input, args] of [[{...issue,jurisdictionSlug:"norway"}], [{...issue,revision:2}],
    [{...issue,privatePath:"invented-canary"}], ["x".repeat(65537)], [issue,["--source=other"]]]) {
    const result = run(input, args);assert.notEqual(result.status, 0);assert.equal(result.stdout, "");
  }
});
