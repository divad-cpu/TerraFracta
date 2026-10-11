import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFictionalAuthenticatedPublication } from "../src/fictional-authenticated-publication.ts";
const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_authenticated_publication_snapshot.json", import.meta.url)));
test("actual redacted fictional authenticated outcomes remain bounded", () => {
  assert.equal(parseFictionalAuthenticatedPublication(saved).resultingActivations, 1);
});
test("private fields and live acceptance cannot be added to the saved proof", () => {
  for (const change of [{ runId: "private" }, { livePublicationEnabled: true }, { websiteVisibilityVerified: true }, { expiredPermissionRolledBack: false }, { resultingActivations: 2 }, { realSourceRequests: 1 }]) {
    assert.throws(() => parseFictionalAuthenticatedPublication({ ...saved, ...change }));
  }
});
