// Actual owned SQL bytes -> actual strict reader -> actual React SSR view.
// Private stdin and explicit injected test provider; no operational transport,
// credentials, HTTP, Browser, source requests or path selectors are installed.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { operatorAuditEnvelopeSchema, operatorAuditScopeSchema } from "../src/operator-audit-report.ts";
import { createOperatorAuditReader, readOperatorAudit } from "../src/server/operator-audit-reader.ts";

// Reuse the established in-process TSX loader: actual PageIntro is compiled,
// and installed dependencies are loaded natively. No presentation substitute.
const modules = new Map();
function load(source) {
  if (modules.has(source.href)) return modules.get(source.href);
  const exports = {}, native = createRequire(source);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  modules.set(source.href, exports);
  new Function("require", "exports", compiled)(name => {
    if (name.startsWith(".")) {
      const candidate = new URL(name.endsWith(".tsx") ? name : name + ".tsx", source);
      if (existsSync(candidate)) return load(candidate);
    }
    return native(name);
  }, exports);
  return exports;
}
const { OperatorAuditView } = load(new URL("../src/operator-audit-view.tsx", import.meta.url));
const render = (decision, selection) => renderToStaticMarkup(createElement(OperatorAuditView, { decision, selection }));
const labels = { changed: "Publication ledger changed", not_found: "No matching recorded audit",
  unavailable: "Recorded audit unavailable", unconfigured: "Recorded audit connection unavailable" };

if (process.argv.length !== 2) throw new Error("Fixed audit output checker accepts no arguments");
const chunks = []; let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length; if (size > 262144) throw new Error("Private audit output input too large");
  chunks.push(chunk);
}
const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
assert.deepEqual(Object.keys(input), ["outputs"]); assert.ok(Array.isArray(input.outputs));
assert.ok(input.outputs.length >= 4 && input.outputs.length <= 20);
let ok = 0, held = 0, providerCalls = 0;
for (const output of input.outputs) {
  assert.deepEqual(Object.keys(output).sort(), ["name", "report", "scope"]);
  assert.match(output.name, /^[a-z][a-z0-9-]{0,63}$/);
  const scope = operatorAuditScopeSchema.parse(output.scope), report = operatorAuditEnvelopeSchema.parse(output.report);
  assert.deepEqual(report.requested, scope);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 65536);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
  let calls = 0, childSignal;
  const reader = createOperatorAuditReader(async (actualScope, signal) => {
    calls++; providerCalls++; childSignal = signal;
    assert.deepEqual(actualScope, scope); assert.ok(Object.isFrozen(actualScope));
    if (scope.cursor !== null) assert.ok(Object.isFrozen(actualScope.cursor));
    assert.equal(signal.aborted, false);
    return new TextEncoder().encode(JSON.stringify(output.report));
  });
  const decision = await reader(output.scope);
  assert.equal(calls, 1); assert.equal(childSignal.aborted, true);
  assert.equal(decision.kind, report.status);
  const html = render(decision, scope);
  assert.ok(html.includes('<h1>Recorded source and publication audit</h1>'));
  assert.ok(!html.includes("PRIVATE_"));
  if (report.status === "ok") {
    ok++; assert.deepEqual(decision.report, report);
    assert.ok(html.includes('dateTime="' + report.observedAt + '"'));
    for (const source of report.sources) assert.ok(html.includes(source.sourceKey));
    for (const publication of report.history.publications) {
      assert.ok(html.includes(publication.publicationId));
      assert.ok(html.includes("Revision " + publication.revision + " · "));
    }
    assert.ok(html.includes("These issue revisions are not attributed to the selected run."));
    if (!report.expectedSourcesKnown) assert.ok(html.includes("complete coverage cannot be inferred"));
  } else {
    held++; assert.deepEqual(decision, { kind: report.status });
    assert.ok(html.includes(labels[report.status]));
    for (const text of ["audit-a", "Stored publication history", "Query observed at (UTC)"])
      assert.ok(!html.includes(text));
  }
}
const selected = operatorAuditScopeSchema.parse(input.outputs[0].scope);
const unavailable = await createOperatorAuditReader(async () => { throw new Error("PRIVATE_PROVIDER_FAILURE"); })(selected);
assert.deepEqual(unavailable, { kind: "unavailable" });
const defaultDecision = await readOperatorAudit(selected);
assert.deepEqual(defaultDecision, { kind: "unconfigured" });
for (const decision of [unavailable, defaultDecision]) {
  const html = render(decision, selected); assert.ok(html.includes(labels[decision.kind]));
  for (const text of ["PRIVATE_", "audit-a", "Stored publication history", "Query observed at (UTC)"])
    assert.ok(!html.includes(text));
}
process.stdout.write(JSON.stringify({ checkedActualSqlOutputs: input.outputs.length, closedSharedContract: true,
  actualReaderProviderCalls: providerCalls, actualSsrOk: ok, actualSsrHeld: held,
  unavailableAndDefaultUnconfigured: true, injectedByteProviderOnly: true, livePgTransportVerified: false,
  sourceRequests: 0, primaryChanged: false, httpVerified: false, browserVerified: false }) + "\n");
