import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
const path = new URL("../src/correction-review-operation-view.tsx", import.meta.url);
const native = createRequire(path), compiled = ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function harness(initial) {
  let supervised = initial, cursor = 0, effect, cleanup, layout, layoutCleanup;
  const cells = [], exports = {};
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in cells)) cells[i] = value; return [cells[i], next => { cells[i] = next; }]; },
    useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
    useEffect(value) { effect = value; },
    useLayoutEffect(value) { layout = value; },
  };
  new Function("require", "exports", compiled)(name => name === "react" ? hooks : native(name), exports);
  const render = () => { cursor = 0; return exports.CorrectionReviewOperationView({ supervised }); };
  return { mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, unmount() { layoutCleanup?.(); cleanup?.(); },
    switchMode(value) { supervised = value; render(); cleanup?.(); cleanup = effect(); },
    markup: () => renderToStaticMarkup(render()), button: () => nodes(render()).find(value => value.type === "button").props };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
test("settled retired review read describes an available manual observation without claiming a read is running", async t => {
  for (const mode of [false, true]) {
    const replies = [];
    t.mock.method(globalThis, "fetch", (_url, options) => new Promise(resolve => replies.push({ resolve, signal: options.signal })));
    const ui = harness(mode);
    try {
      ui.mount(); ui.switchMode(!mode); assert.equal(replies.length, 1); assert.equal(ui.button().disabled, true);
      assert.match(ui.markup(), /Reading the saved result/);
      replies[0].resolve(Response.json({ state: "idle" })); await turn();
      assert.equal(ui.button().disabled, false); assert.equal(replies.length, 1);
      assert.doesNotMatch(ui.markup(), /Reading the saved result|No retained trial has been started/);
      assert.match(ui.markup(), /Check the saved result to request a new observation/);
      ui.button().onClick(); assert.equal(replies.length, 2); assert.match(ui.markup(), /Reading the saved result/);
      replies[1].resolve(Response.json({ state: "idle" })); await turn();
      assert.match(ui.markup(), /No retained trial has been started/);
    } finally { ui.unmount(); t.mock.reset(); }
  }
});
