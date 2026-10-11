import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { correctionRequestSchema } from "../src/correction-request.ts";
const run = (issue, args = []) => spawnSync(process.execPath,
  ["--experimental-strip-types", "scripts/build_invented_correction_request_wire.mjs", ...args],
  { input: typeof issue === "string" ? issue : JSON.stringify(issue), encoding: "utf8", timeout: 5000 });
const issue = () => ({ ...connectedInput().issue, publicationId: "92bb9213-05e0-550a-8b99-cbf65e786609" });
test("actual request wire keeps deterministic invented identities across process retries", () => {
  const first = run(issue()), repeated = run(issue());
  assert.equal(first.status, 0, first.stderr); assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(first.stdout, repeated.stdout);
  const wire = JSON.parse(first.stdout);
  assert.equal(wire.requests.length, 2);
  for (const request of wire.requests) correctionRequestSchema.parse(request);
  assert.notEqual(wire.requests[0].requestId, wire.requests[1].requestId);
  assert.equal(wire.requests[0].draft.target.claimId, issue().claims[0].id);
  assert.equal(wire.requests[1].draft.target.claimId, null);
  assert.equal(wire.submissionEnabled, false);
  assert.doesNotMatch(first.stdout, /reviewState|reportId|privatePath|password/);
});
test("successor has distinct request identities bound to its own edition", () => {
  const successor = { ...issue(), revision: 2, publicationId: "6ac005f4-f9a0-5021-a3b5-28e1f1607397" };
  const first = JSON.parse(run(issue()).stdout), next = run(successor);
  assert.equal(next.status, 0, next.stderr);
  const second = JSON.parse(next.stdout);
  for (let i = 0; i < 2; i++) {
    assert.notEqual(first.requests[i].requestId, second.requests[i].requestId);
    assert.equal(second.requests[i].draft.target.revision, 2);
  }
});
test("foreign, private, oversized and command-controlled input yields no requests", () => {
  for (const [input, args] of [[{ ...issue(), jurisdictionSlug: "norway" }], [{ ...issue(), revision: 2 }],
    [{ ...issue(), reviewState: "closed" }], ["x".repeat(65_537)], [issue(), ["--submit"]]]) {
    const result = run(input, args); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
  }
});
