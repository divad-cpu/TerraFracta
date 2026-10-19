import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Compile the actual source in process. Only explicit public seams may be
// substituted by callers. This is not framework routing, hydration or Browser.
export function loadTsx(file, intercept = () => undefined, processValue = { env: { NODE_ENV: "development" } }) {
  const url = file instanceof URL ? file : new URL(file), exports = {}, native = createRequire(url);
  const result = ts.transpileModule(readFileSync(url, "utf8"), { reportDiagnostics: true, compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  // Syntactic diagnostics must refuse before emitted code or imported seams run.
  // This is deliberately not semantic type checking or Browser qualification.
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
    throw new SyntaxError("TSX fixture compilation failed.");
  const compiled = result.outputText;
  new Function("require", "exports", "process", compiled)(name => {
    const replacement = intercept(name); if (replacement !== undefined) return replacement;
    if (name.startsWith(".")) {
      const full = new URL(name, url);
      if (full.pathname.endsWith(".tsx") || existsSync(new URL(full.href + ".tsx")))
        return loadTsx(full.pathname.endsWith(".tsx") ? full : new URL(full.href + ".tsx"), intercept, processValue);
      if (existsSync(new URL(full.href + ".ts"))) return native(name + ".ts");
    }
    return native(name);
  }, exports, processValue);
  return exports;
}
