import assert from "node:assert/strict";
import test from "node:test";
import { interpretPublicReadCandidate } from "../src/public-read-outcome.ts";

test("only SQL null means a missing route", () => {
  assert.deepEqual(interpretPublicReadCandidate(null), { kind: "absent" });
  for (const input of [undefined, false, "", [], {}, { candidate_state: "rejected" }]) {
    assert.deepEqual(interpretPublicReadCandidate(input), { kind: "rejected" });
  }
});

test("a marker with unexpected data cannot become an issue or an absent route", () => {
  assert.deepEqual(
    interpretPublicReadCandidate({ candidate_state: "rejected", private_note: "canary" }),
    { kind: "rejected" },
  );
  assert.deepEqual(
    interpretPublicReadCandidate({ requestedRoute: {}, private_note: "canary" }),
    { kind: "rejected" },
  );
});
