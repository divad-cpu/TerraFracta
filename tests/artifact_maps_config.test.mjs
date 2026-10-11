import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function config(env) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, process: { env } });
  return exports.default;
}

test("ordinary builds and incomplete audit selection never enable source maps", () => {
  for (const env of [{}, { TERRAFRACTA_LOCAL_ARTIFACT_MAPS: "1" },
    { TERRAFRACTA_LOCAL_STANDALONE: "1" },
    { TERRAFRACTA_LOCAL_STANDALONE: "1", TERRAFRACTA_LOCAL_ARTIFACT_MAPS: "true" }]) {
    assert.equal(config(env).productionBrowserSourceMaps, undefined);
  }
});
test("only explicit private standalone audit enables the documented source-map option", () => {
  const value = config({ TERRAFRACTA_LOCAL_STANDALONE: "1", TERRAFRACTA_LOCAL_ARTIFACT_MAPS: "1" });
  assert.equal(value.output, "standalone");
  assert.equal(value.productionBrowserSourceMaps, true);
});
test("audit output retains the existing private archive tracing exclusions", () => {
  const value = config({ TERRAFRACTA_LOCAL_STANDALONE: "1", TERRAFRACTA_LOCAL_ARTIFACT_MAPS: "1" });
  assert.equal(JSON.stringify(value.outputFileTracingExcludes), JSON.stringify(config({}).outputFileTracingExcludes));
  for (const name of [".local-connected-reader", ".local-fictional-runs", ".local-connected-trial"])
    assert.ok(value.outputFileTracingExcludes["/*"].some((path) => path.includes(name)));
});
