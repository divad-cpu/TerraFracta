import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../../src/current-copy-scope.ts";

const path = new URL("../../src/current-copy-scope-view.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
export function copyScopeHarness() {
  let cursor = 0, effect, cleanup; const cells = [], native = createRequire(path), exports = {};
  const hooks = {
    useState(initial) { const index = cursor++; cells[index] ??= initial; return [cells[index], value => { cells[index] = value; }]; },
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
    useEffect(callback) { effect = callback; },
  };
  new Function("require", "exports", compiled)(name => name === "react" ? hooks : name === "./current-copy-scope.ts" ? contract : native(name), exports);
  const render = () => { cursor = 0; return exports.CurrentCopyScopeView(); };
  return { markup: () => renderToStaticMarkup(render()), mount() { render(); cleanup = effect(); }, unmount() { cleanup?.(); },
    button() { return nodes(render()).find(item => item.type === "button").props; } };
}
