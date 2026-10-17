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
export function editorHarness(snapshot, scope = "connected", { autoCommit = true } = {}) {
  let currentInput = snapshot;
  let states = [], refs = [], effects = [], layouts = [], retiredLayouts = [], retired = [], cursor = 0, refCursor = 0, effectCursor = 0, layoutCursor = 0, key;
  const retire = () => {
    retiredLayouts.push(...layouts); retired.push(...effects); layouts = [];
  };
  const flushPassive = () => { for (const effect of retired.splice(0)) effect?.cleanup?.(); };
  const commitLayout = () => { for (const effect of retiredLayouts.splice(0)) effect?.cleanup?.(); for (const effect of layouts) if (effect?.pending) { effect.cleanup?.(); effect.cleanup = effect.callback(); effect.pending = false; } };
  const commit = () => { commitLayout(); flushPassive(); for (const effect of effects) if (effect?.pending) { effect.cleanup?.(); effect.cleanup = effect.callback(); effect.pending = false; } };
  const react = { useId: () => "callback-test", useState(initial) {
    const slot = cursor++, owned = states; if (!(slot in owned)) owned[slot] = initial;
    return [owned[slot], value => { owned[slot] = typeof value === "function" ? value(owned[slot]) : value; }];
  }, useRef(initial) {
    const slot = refCursor++; if (!(slot in refs)) refs[slot] = { current: initial }; return refs[slot];
  }, useLayoutEffect(callback, deps) {
    const slot = layoutCursor++, previous = layouts[slot];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) layouts[slot] = { deps, callback, cleanup: previous?.cleanup, pending: true };
  }, useEffect(callback, deps) {
    const slot = effectCursor++, previous = effects[slot];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects[slot] = { deps, callback, cleanup: previous?.cleanup, pending: true };
  } };
  const { CorrectionDraft, CurrentIssueCorrectionDraft } = correctionModule(react);
  return { states: () => states.slice(), commit, commitLayout, flushPassive, unmount() { retire(); commitLayout(); flushPassive(); states = []; refs = []; effects = []; key = undefined; }, render(next = currentInput) {
    currentInput = next;
    const selected = scope === "current" ? CurrentIssueCorrectionDraft({ issue: next }) : CorrectionDraft(next === undefined ? {} : { connectedSnapshot: next });
    if (typeof selected.type !== "function") { retire(); states = []; refs = []; effects = []; key = undefined; return selected; }
    if (key !== selected.key) { retire(); states = []; refs = []; effects = []; key = selected.key; }
    cursor = 0; refCursor = 0; effectCursor = 0; layoutCursor = 0; const tree = selected.type(selected.props);
    if (autoCommit) {
      commit();
      // Passive admission requests a render; return that represented admitted
      // tree, while autoCommit:false preserves the explicit pre-admission seam.
      cursor = 0; refCursor = 0; effectCursor = 0; layoutCursor = 0;
      return selected.type(selected.props);
    }
    return tree;
  } };
}
