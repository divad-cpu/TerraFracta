import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../../src/weekly-rehearsal-status.ts";
import * as exportContract from "../../src/weekly-rehearsal-export.ts";
const path = new URL("../../src/weekly-rehearsal-status-view.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
export function weeklyStatusHarness(observe = null) {
  let cursor = 0, effect, cleanup, layout, layoutCleanup; const cells = [], native = createRequire(path), exports = {};
  const hooks = {
    useState(initial) { const index = cursor++; cells[index] ??= initial; return [cells[index], value => { cells[index] = value; }]; },
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
    useEffect(callback) { effect = callback; },
    useLayoutEffect(callback) { layout = callback; },
  };
  new Function("require", "exports", compiled)(name => name === "react" ? hooks : name === "./weekly-rehearsal-status.ts" ? contract
    : name === "./weekly-rehearsal-export.ts" ? exportContract
    : name === "./client-error-diagnostics.ts" && observe ? { observeClientError: observe } : native(name), exports);
  const render = () => { cursor = 0; return exports.WeeklyRehearsalStatusView(); };
  return { markup: () => renderToStaticMarkup(render()), mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, unmount() { layoutCleanup?.(); cleanup?.(); },
    button() { return nodes(render()).find(item => item.type === "button").props; },
    buttons() { return nodes(render()).filter(item => item.type === "button").map(item => item.props); } };
}
