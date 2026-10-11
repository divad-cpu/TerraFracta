import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createPublicIssueReader, createDevelopmentPublicIssueHandler } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const candidate = () => sample();
const route = () => candidate().requestedRoute;
const path = () => `/api/dev/public-issue/${route().jurisdictionSlug}/${route().issueSlug}`;
const url = () => `http://127.0.0.1:3100${path()}`;
const context = () => ({ params: Promise.resolve({ country: route().jurisdictionSlug, issue: route().issueSlug }) });
const request = (method = "GET", headers = {}, signal) => new Request(url(), {
  method, signal, headers: { "sec-fetch-site": "same-origin", ...headers },
});
const bytes = value => new TextEncoder().encode(JSON.stringify(value));

test("production refusal precedes params, provider, method and source access", async () => {
  let calls = 0;
  const handle = createDevelopmentPublicIssueHandler(createPublicIssueReader(async () => { calls++; return bytes(candidate()); }));
  const forbidden = { then() { assert.fail("Production route parameters opened"); } };
  for (const environment of [undefined, "test", "production"])
    assert.equal((await handle(request(), { params: forbidden }, environment)).status, 404);
  assert.equal(calls, 0);
});
test("method, local origin and route selectors refuse before a candidate read", async () => {
  let calls = 0;
  const handle = createDevelopmentPublicIssueHandler(createPublicIssueReader(async () => { calls++; return bytes(candidate()); }));
  for (const method of ["POST", "PUT", "DELETE", "HEAD"])
    assert.equal((await handle(request(method), context(), "development")).status, 405);
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await handle(request("GET", headers), context(), "development")).status, 403);
  for (const suffix of ["?sql=private-canary", "#private-canary"])
    assert.equal((await handle(new Request(url() + suffix, { headers: { "sec-fetch-site": "same-origin" } }), context(), "development")).status, 403);
  for (const params of [{ country: route().jurisdictionSlug, issue: "../private" },
    { country: route().jurisdictionSlug, issue: route().issueSlug, source: "canary" },
    { country: "another-country", issue: route().issueSlug }])
    assert.equal((await handle(request(), { params: Promise.resolve(params) }, "development")).status, 404);
  assert.equal(calls, 0);
});
test("a canonical request calls once and responds with only the checked issue and no-store", async () => {
  let calls = 0, value = candidate();
  value.country.private_note = "private-canary";
  const handle = createDevelopmentPublicIssueHandler(createPublicIssueReader(async input => {
    calls++; assert.deepEqual(input, route()); return bytes(value);
  }));
  const response = await handle(request(), context(), "development");
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("allow"), "GET");
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["issue"]);
  assert.equal(body.issue.issueSlug, route().issueSlug);
  assert.ok(!JSON.stringify(body).includes("private-canary"));
});
test("null, rejected, wrong-route, withdrawn and failed reads keep distinct safe responses", async () => {
  const withdrawn = candidate(); withdrawn.sources[0].registration.allow_public_derived = false;
  const wrong = candidate();
  // This internally consistent original route is valid; the external route is different.
  const otherContext = { params: Promise.resolve({ country: "another-country", issue: route().issueSlug }) };
  const otherRequest = new Request(`http://127.0.0.1:3100/api/dev/public-issue/another-country/${route().issueSlug}`, { headers: { "sec-fetch-site": "same-origin" } });
  const other = createDevelopmentPublicIssueHandler(createPublicIssueReader(async () => bytes(wrong)));
  assert.deepEqual(await (await other(otherRequest, otherContext, "development")).json(), { error: "read_unavailable" });
  for (const [value, status, error] of [[null, 404, "not_found"], [{ candidate_state: "rejected", note: "canary" }, 503, "read_unavailable"], [withdrawn, 503, "read_unavailable"]]) {
    const handle = createDevelopmentPublicIssueHandler(createPublicIssueReader(async () => bytes(value)));
    const response = await handle(request(), context(), "development");
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error });
  }
  const failed = createDevelopmentPublicIssueHandler(createPublicIssueReader(async () => { throw new Error("private-canary"); }));
  assert.deepEqual(await (await failed(request(), context(), "development")).json(), { error: "read_unavailable" });
});
test("cancelled requests cannot dispatch or return a late successful issue", async () => {
  let calls = 0, finish;
  const handle = createDevelopmentPublicIssueHandler(createPublicIssueReader(async () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  }));
  const parent = new AbortController(); parent.abort();
  assert.equal((await handle(request("GET", {}, parent.signal), context(), "development")).status, 503);
  assert.equal(calls, 0);
  const active = new AbortController(), pending = handle(request("GET", {}, active.signal), context(), "development");
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(calls, 1); active.abort();
  const response = await pending;
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "read_unavailable" });
  finish(bytes(candidate()));
});
test("actual Next route wrapper passes exact Request/context and cannot activate a default provider", async () => {
  const source = new URL("../app/api/dev/public-issue/[country]/[issue]/route.ts", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  for (const environment of ["development", "production"]) {
    const exports = {}, seen = [], read = createDevelopmentPublicIssueHandler();
    const nativeRequire = createRequire(source);
    new Function("require", "exports", "process", compiled)(name => name.endsWith("public-issue-reader") ? {
      handleDevelopmentPublicIssueRead: async (...args) => { seen.push(args); return read(...args); },
    } : nativeRequire(name), exports, { env: { NODE_ENV: environment } });
    const req = request(), ctx = context(), response = await exports.GET(req, ctx);
    assert.equal(exports.runtime, "nodejs"); assert.equal(exports.dynamic, "force-dynamic");
    assert.equal(seen.length, 1); assert.strictEqual(seen[0][0], req); assert.strictEqual(seen[0][1], ctx);
    assert.equal(seen[0][2], environment); assert.equal(response.status, environment === "development" ? 503 : 404);
  }
});

test("handler validates the final injected reader decision before exposing display fields", async () => {
  const accepted = await createPublicIssueReader(async () => bytes(candidate()))(route());
  for (const decision of [
    { ...accepted, issue: { ...accepted.issue, privatePath: "private-canary" } },
    { ...accepted, issue: { ...accepted.issue, issueSlug: "another-issue" } },
    { ...accepted, status: 201 },
  ]) {
    const handle = createDevelopmentPublicIssueHandler(async () => decision);
    const response = await handle(request(), context(), "development");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "read_unavailable" });
  }
});
