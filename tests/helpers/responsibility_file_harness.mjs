import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";

// Several hook instances share one actual compiled component/module, keeping
// its physical File reservation real across replacement mounts. No DOM claim.
export function responsibilityFileModule(context) {
  let active, number = 0;
  const register = (list, callback, deps) => {
    const i = active.cursor++, old = list[i];
    if (!old || deps.some((value, index) => value !== old.deps[index])) list[i] = { callback, deps, cleanup: old?.cleanup, pending: true };
  };
  const hooks = {
    useId: () => active.id,
    useRef(value) { const state = active, i = state.cursor++; if (!(i in state.cells)) state.cells[i] = { current: value }; return state.cells[i]; },
    useState(value) { const state = active, i = state.cursor++; if (!(i in state.cells)) state.cells[i] = value;
      return [state.cells[i], value => { state.cells[i] = typeof value === "function" ? value(state.cells[i]) : value; }]; },
    useEffect(callback, deps) { register(active.effects, callback, deps); },
    useLayoutEffect(callback, deps) { register(active.layouts, callback, deps); },
  };
  const View = loadTsx(new URL("../../src/responsibility-draft-view.tsx", import.meta.url), name => name === "react" ? hooks : undefined).ResponsibilityDraftView;
  return () => {
    const state = { id: `responsibility-file-${++number}`, context, cursor: 0, cells: [], layouts: [], effects: [] };
    const render = () => { active = state; state.cursor = 0; return View({ context: state.context }); };
    const setup = list => { for (const item of list) if (item?.pending) { item.cleanup?.(); item.cleanup = item.callback(); item.pending = false; } };
    const nodes = () => elements(render());
    const input = () => nodes().find(node => node.type === "input" && node.props.type === "file").props;
    return { render, nodes, input,
      mount() { render(); setup(state.layouts); setup(state.effects); },
      unmount() { for (const item of [...state.layouts, ...state.effects]) item?.cleanup?.(); },
      retireLayout() { for (const item of state.layouts) item?.cleanup?.(); },
      choose(file) { input().onChange({ currentTarget: { files: [file], value: "PRIVATE_FILE_NAME" } }); },
      preview: () => nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value,
    };
  };
}
