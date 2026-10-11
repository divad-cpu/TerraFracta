import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";

const path = process.env.TF_PUBLIC_NATIVE_SOURCE ?? new URL("../scripts/check_postgres_issue_provider_native.mjs", import.meta.url);
const text = readFileSync(path, "utf8");
const source = ts.createSourceFile("public-native.mjs", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const calls = [];
function visit(node) { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.push(node); ts.forEachChild(node, visit); }
visit(source);
const selected = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "makeReader");
const route = { jurisdictionSlug: "fictional-country", issueSlug: "fictional-share" };
const held = { status: 503, cacheControl: "no-store" };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("every native supplied reader and handler has explicit finite diagnostic ownership", () => {
  const readers = calls.filter(node => node.expression.text === "createPublicIssueReader");
  assert.ok(readers.length > 0);
  for (const node of readers) assert.equal(node.arguments[2]?.getText(source), "record", "Native readers must never dispatch into the default archive");
  const handlers = calls.filter(node => node.expression.text === "createDevelopmentPublicIssueHandler");
  assert.ok(handlers.length > 0);
  for (const node of handlers) assert.equal(node.arguments[1]?.getText(source), "record", "Native handlers must never dispatch into the default archive");
  assert.ok(!calls.some(node => node.expression.text === "recordDevelopmentError"));
});

function nativeReader(record) {
  assert.ok(selected, "A single actual native reader factory must own the explicit recorder");
  // Only the actual named factory executes; no stdin protocol, driver, default
  // archive or database is started. The real application reader is preserved.
  return new Function("createPublicIssueReader", "record", `${selected.getText(source)}; return makeReader;`)(createPublicIssueReader, record);
}

test("actual native factory emits only a fixed technical identity with no exception details", async () => {
  const codes = [], make = nativeReader(async code => { codes.push(code); return "saved"; });
  assert.deepEqual(await make(async () => { throw Error("PRIVATE_CONNECTION_AND_KEY_NOT_RECORDED"); })(route), held);
  await tick(); assert.deepEqual(codes, ["public_issue_read"]);
});

test("actual native factory preserves silent caller cancellation and absent default behavior", async () => {
  const codes = [], make = nativeReader(async code => { codes.push(code); return "saved"; });
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await make(() => { assert.fail("Cancelled provider touched"); })(route, controller.signal), held);
  assert.deepEqual(await make(undefined)(route), held); await tick(); assert.deepEqual(codes, []);
});
