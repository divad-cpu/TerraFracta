import assert from "node:assert/strict";
import test from "node:test";
import { interpretPublicReadCandidate as interpret } from "../src/public-read-outcome.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const rejected = { kind: "rejected" };
test("a refused key observation returns the established opaque candidate rejection", () => {
  const input = new Proxy(sample(), { ownKeys() { throw Error("PRIVATE_CANDIDATE_CANARY"); } });
  assert.deepEqual(interpret(input), rejected);
});
test("a refused descriptor observation cannot expose an exception or partial issue", () => {
  const input = new Proxy(sample(), {
    getOwnPropertyDescriptor() { throw Error("PRIVATE_DESCRIPTOR_CANARY"); },
  });
  assert.deepEqual(interpret(input), rejected);
});
test("a revoked candidate is rejected even before its keys can be inspected", () => {
  const { proxy, revoke } = Proxy.revocable(sample(), {});
  revoke();
  assert.deepEqual(interpret(proxy), rejected);
});
test("ordinary valid and absent outcomes retain the existing public boundary", () => {
  const input = sample(), checked = interpret(input);
  assert.equal(checked.kind, "issue");
  assert.equal(interpret(new Proxy(input, {})).issue.publicationId, checked.issue.publicationId);
  assert.deepEqual(interpret(null), { kind: "absent" });
  assert.doesNotMatch(JSON.stringify(checked), /PRIVATE|registration_state|machine_binding/);
  const unexpected = { ...input, private_note: "PRIVATE_CANDIDATE_CANARY" };
  assert.deepEqual(interpret(unexpected), rejected);
});
