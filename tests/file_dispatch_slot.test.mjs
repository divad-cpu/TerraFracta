import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";

const turn = () => new Promise(setImmediate);
const variants = [
  { name: "diagnostics", file: "diagnostic-import-view", component: "DiagnosticImportView" },
  { name: "selected run", file: "fictional-saved-run-import-view", component: "FictionalSavedRunImportView", suffix: "-selected-file" },
  { name: "earlier run", file: "fictional-saved-run-import-view", component: "FictionalSavedRunImportView", suffix: "-earlier-file" },
  { name: "weekly report", file: "weekly-rehearsal-report-view", component: "WeeklyRehearsalReportView" },
];
function sharedModule(v) {
  let active, next = 0;
  const hooks = {
    useId: () => active.id,
    useState(initial) { const state = active, i = state.cursor++; if (!(i in state.cells)) state.cells[i] = typeof initial === "function" ? initial() : initial;
      return [state.cells[i], value => { state.cells[i] = typeof value === "function" ? value(state.cells[i]) : value; }]; },
    useRef(initial) { const state = active, i = state.cursor++; if (!(i in state.cells)) state.cells[i] = { current: initial }; return state.cells[i]; },
    useEffect(callback, deps) { register(active.effects, callback, deps); },
    useLayoutEffect(callback, deps) { register(active.layouts, callback, deps); },
  };
  function register(list, callback, deps) {
    const i = active.cursor++, old = list[i];
    if (!old || !deps || deps.some((value, index) => value !== old.deps?.[index])) list[i] = { callback, deps, cleanup: old?.cleanup, pending: true };
  }
  const Component = loadTsx(new URL(`../src/${v.file}.tsx`, import.meta.url), name => name === "react" ? hooks : undefined)[v.component];
  return () => {
    const state = { id: `owned-file-${++next}`, cells: [], cursor: 0, layouts: [], effects: [] };
    const render = () => { active = state; state.cursor = 0; return Component(); };
    const setup = list => { for (const item of list) if (item?.pending) { item.cleanup?.(); item.cleanup = item.callback(); item.pending = false; } };
    const input = () => elements(render()).find(item => item.type === "input" && item.props.type === "file" && (!v.suffix || item.props.id?.endsWith(v.suffix))).props;
    return { mount() { render(); setup(state.layouts); setup(state.effects); },
      unmount() { for (const item of [...state.layouts, ...state.effects]) item?.cleanup?.(); },
      input, choose(file) { input().onChange({ currentTarget: { files: [file], value: "INVENTED_FILE_NAME" } }); },
      html: () => renderToStaticMarkup(render()) };
  };
}

for (const v of variants) for (const originalThrows of [false, true])
  test(`${v.name}: file-read replacement retains one physical owner, original throws ${originalThrows}`, async t => {
    t.mock.method(globalThis, "fetch", () => assert.fail("local file reopening cannot dispatch transport"));
    const bytes = new TextEncoder().encode("{}"), instances = [], create = sharedModule(v);
    let old, next, finish, firstReads = 0, nextReads = 0;
    const nextFile = { size: bytes.length, slice() { return { arrayBuffer() { nextReads++; return Promise.resolve(bytes.buffer); } }; } };
    const original = { size: bytes.length, slice() { return { arrayBuffer() {
      firstReads++; old.unmount(); next = create(); instances.push(next); next.mount(); next.choose(nextFile);
      if (originalThrows) throw Error("PRIVATE_ORIGINAL_FILE_FAULT");
      return new Promise(resolve => { finish = resolve; });
    } }; } };
    old = create(); instances.push(old); old.mount();
    try {
      old.choose(original);
      assert.equal(firstReads, 1); assert.equal(nextReads, 0, "new file bytes cannot start during the original invocation");
      await turn();
      if (!originalThrows) { assert.equal(next.input().disabled, true); finish(bytes.buffer); await turn(); }
      assert.equal(next.input().disabled, false); assert.equal(nextReads, 0, "settlement cannot implicitly reopen a file");
      assert.doesNotMatch(next.html(), /PRIVATE_|Saved individual references|8 recorded receipts/);
      next.choose(nextFile); await turn(); assert.equal(nextReads, 1); assert.equal(next.input().disabled, false);
      assert.doesNotMatch(next.html(), /PRIVATE_|Saved individual references|8 recorded receipts/);
    } finally { instances.forEach(item => item.unmount()); finish?.(bytes.buffer); await turn(); }
  });
