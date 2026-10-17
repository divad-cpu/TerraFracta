import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";

// Adapt the existing file_dispatch_slot shared-module hook double. Two fresh
// component instances must share one actual module-level physical-read map.
// This does not simulate DOM, React reconciliation, hydration or Browser tasks.
export function packetFileHarnessFactory(intercept = () => undefined) {
  let active, serial = 0;
  const register = (list, callback, deps) => {
    const index = active.cursor++, old = list[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) list[index] = { callback, deps, cleanup: old?.cleanup, pending: true };
  };
  const hooks = {
    useId: () => active.id,
    useRef(value) { const state = active, index = state.cursor++; if (!(index in state.cells)) state.cells[index] = { current: value }; return state.cells[index]; },
    useState(value) { const state = active, index = state.cursor++; if (!(index in state.cells)) state.cells[index] = value;
      return [state.cells[index], next => { state.cells[index] = typeof next === "function" ? next(state.cells[index]) : next; }]; },
    useEffect(callback, deps) { register(active.effects, callback, deps); },
    useLayoutEffect(callback, deps) { register(active.layouts, callback, deps); },
  };
  const View = loadTsx(new URL("../../src/preparation-packet-view.tsx", import.meta.url), name => name === "react" ? hooks : intercept(name)).PreparationPacketView;
  return initial => {
    const state = { id: `packet-file-${++serial}`, cursor: 0, cells: [], layouts: [], effects: [] }; let context = initial;
    const render = (next = context) => { context = next; active = state; state.cursor = 0; return View({ context }); };
    const run = list => { for (const item of list) if (item?.pending) { item.cleanup?.(); item.cleanup = item.callback(); item.pending = false; } };
    return { render, nodes: () => elements(render()), commit() { run(state.layouts); run(state.effects); },
      mount() { render(); run(state.layouts); run(state.effects); return render(); },
      unmount() { for (const item of [...state.layouts, ...state.effects]) item?.cleanup?.(); } };
  };
}
