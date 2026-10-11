import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as fields from "../../src/correction-target.ts";
import * as context from "../../src/connected-correction-draft.ts";
import * as requests from "../../src/correction-request.ts";

// Exact TSX compiled in memory. The optional hook seam exercises its actual
// callbacks without a DOM. It does not establish React hydration or Browser use.
export function correctionModule(react) {
  const source = new URL("../../app/corrections/draft-form.tsx", import.meta.url), nativeRequire = createRequire(source), exports = {};
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const imports = { "../../src/correction-target": fields, "../../src/connected-correction-draft": context,
    "../../src/correction-request": requests };
  if (react) imports.react = react;
  new Function("require", "exports", compiled)(name => imports[name] ?? nativeRequire(name), exports);
  return exports;
}
export function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !tree.props) return [];
  return [tree, ...elements(tree.props.children)];
}
export function editorHarness(snapshot, scope = "connected") {
  let states = [], cursor = 0, key;
  const react = { useId: () => "callback-test", useState(initial) {
    const slot = cursor++; if (!(slot in states)) states[slot] = initial;
    return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
  } };
  const { CorrectionDraft, CurrentIssueCorrectionDraft } = correctionModule(react);
  return { states: () => states.slice(), render(next = snapshot) {
    const selected = scope === "current" ? CurrentIssueCorrectionDraft({ issue: next }) : CorrectionDraft(next === undefined ? {} : { connectedSnapshot: next });
    if (typeof selected.type !== "function") { states = []; key = undefined; return selected; }
    if (key !== selected.key) { states = []; key = selected.key; }
    cursor = 0; return selected.type(selected.props);
  } };
}
