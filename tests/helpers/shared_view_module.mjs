import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
import { renderToStaticMarkup } from "react-dom/server";

// One actual compiled module, separate finite hook cells per mounted instance.
// This observes explicit lifecycle/port seams; it is not React/DOM scheduling.
export function sharedViewModule(file, exportName, intercept = () => undefined) {
  let active, nextId = 0;
  const hooks = {
    useId() { return `${active.id}-${active.cursor++}`; },
    useState(initial) { const state = active, i = state.cursor++;
      if (!(i in state.cells)) state.cells[i] = typeof initial === "function" ? initial() : initial;
      return [state.cells[i], value => { state.cells[i] = typeof value === "function" ? value(state.cells[i]) : value; }]; },
    useRef(initial) { const state = active, i = state.cursor++;
      if (!(i in state.cells)) state.cells[i] = { current: initial }; return state.cells[i]; },
    useEffect(callback, deps) { register(active.effects, callback, deps); },
    useLayoutEffect(callback, deps) { register(active.layouts, callback, deps); },
  };
  function register(list, callback, deps) {
    const i = active.cursor++, old = list[i];
    if (!old || !deps || deps.some((value, n) => value !== old.deps?.[n])) list[i] = { callback, deps, pending: true, cleanup: old?.cleanup };
  }
  const Component = loadTsx(file, name => name === "react" ? hooks : intercept(name))[exportName];
  return props => {
    const state = { id: `view-module-${++nextId}`, cursor: 0, cells: [], effects: [], layouts: [] };
    const render = () => { active = state; state.cursor = 0; return Component(props); };
    const setup = list => { for (const item of list) if (item?.pending) { item.cleanup?.(); item.cleanup = item.callback(); item.pending = false; } };
    return { render, nodes: () => elements(render()), html: () => renderToStaticMarkup(render()),
      commit() { render(); setup(state.layouts); setup(state.effects); },
      unmount() { for (const item of [...state.layouts, ...state.effects]) item?.cleanup?.(); } };
  };
}
