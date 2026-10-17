import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
export function responsibilityDraftHarness(initial, report = undefined, component = undefined) {
 let cursor = 0, next = initial, deferMerges = false; const deferred = []; const cells = [], effects = [], layouts = [];
 const react = { useId: () => "responsibility-test", useRef(value) { const index = cursor++; if (!(index in cells)) cells[index] = { current: value }; return cells[index]; },
  useState(value) { const index = cursor++; if (!(index in cells)) cells[index] = value;
   return [cells[index], update => {
    if (deferMerges && typeof update === "function") { deferred.push(() => { cells[index] = update(cells[index]); }); return; }
    cells[index] = typeof update === "function" ? update(cells[index]) : update;
   }]; },
  useLayoutEffect(callback, deps) { const index = cursor++, previous = layouts[index];
   if (!previous || deps.some((value, i) => value !== previous.deps[i])) layouts[index] = { deps, callback, cleanup: previous?.cleanup, pending: true }; },
  useEffect(callback, deps) { const index = cursor++, previous = effects[index];
   if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects[index] = { deps, callback, cleanup: previous?.cleanup, pending: true }; }
 };
 const View = loadTsx(component?.url ?? new URL("../../src/responsibility-draft-view.tsx", import.meta.url), name => name === "react" ? react : name === "./client-error-diagnostics.ts" && report ? { observeClientError: report } : undefined)[component?.name ?? "ResponsibilityDraftView"];
 const render = (context = next) => { next = context; cursor = 0; return View({ context }); };
 const commit = () => { for (const layout of layouts) if (layout?.pending) { layout.cleanup?.(); layout.cleanup = layout.callback(); layout.pending = false; } for (const effect of effects) if (effect?.pending) { effect.cleanup?.(); effect.cleanup = effect.callback(); effect.pending = false; } };
 return { render, commit, pauseMerges() { deferMerges = true; }, flushMerges() { deferMerges = false; for (const apply of deferred.splice(0)) apply(); }, mount() { render(); commit(); return render(); }, unmount() { for (const layout of layouts) layout?.cleanup?.(); for (const effect of effects) effect?.cleanup?.(); },
  nodes: () => elements(render()) };
}
