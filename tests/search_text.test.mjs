import assert from "node:assert/strict";
import test from "node:test";
import { searchText } from "../src/search-text.ts";
import { connectedSearch } from "../src/connected-fictional-reader.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

test("display search normalizes ordinary and full-width text within the same bound", () => {
  assert.deepEqual(searchText("  Ｎｏｒｗａｙ  "), { kind: "valid", query: "Norway" });
  assert.deepEqual(searchText(""), { kind: "valid", query: "" });
  assert.equal(searchText("a".repeat(80)).kind, "valid");
});
test("duplicate fields, controls and overlong normalization are invalid", () => {
  for (const value of [["Norway", "other"], null, 1, "a".repeat(81), "Norway\0", "Norway\n", "\ufdfa".repeat(5)]) {
    assert.deepEqual(searchText(value), { kind: "invalid", query: "" });
  }
});
test("connected search refuses an expanding query and retains reviewed matching behavior", () => {
  const snapshot = { ...connectedInput(), generation: 1 };
  assert.deepEqual(connectedSearch(snapshot, "\ufdfa".repeat(5)), { kind: "invalid", query: "", matches: false });
  assert.equal(connectedSearch(snapshot, "  ＦＩＣＴＩＯＮＡＬ  ").matches, true);
  assert.equal(connectedSearch(snapshot, "absent-topic").matches, false);
});
