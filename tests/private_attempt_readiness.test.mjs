import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parsePrivateAttemptReadiness } from "../src/private-attempt-readiness.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/local_private_attempt_readiness_snapshot.json", import.meta.url), "utf8"));

test("saved local preparation preserves a held historical observation", () => {
  const record = parsePrivateAttemptReadiness(saved);
  assert.equal(record.state, "held");
  assert.equal(record.liveStatus, false);
  assert.equal(record.checks.length, 5);
  assert.equal(record.collectionPermissionIssued, false);
});

test("private fields, live status, permission, request and copy claims are refused", () => {
  for (const [key, value] of [["privatePath", "/private-canary"], ["liveStatus", true],
    ["collectionPermissionIssued", true], ["sourceRequests", 1], ["copyScope", "verified"],
    ["state", "ready"], ["publicationEnabled", true], ["sourceRequests", false]]) {
    assert.throws(() => parsePrivateAttemptReadiness({ ...saved, [key]: value }));
  }
});

test("duplicate, reordered or invented checks cannot look like the saved readiness list", () => {
  const duplicate = structuredClone(saved);
  duplicate.checks[1] = duplicate.checks[0];
  assert.throws(() => parsePrivateAttemptReadiness(duplicate));
  const unknown = structuredClone(saved);
  unknown.checks[2].state = "ready";
  assert.throws(() => parsePrivateAttemptReadiness(unknown));
  const held = structuredClone(saved);
  held.checks[3].state = "held";
  assert.equal(parsePrivateAttemptReadiness(held).checks[3].state, "held");
});
