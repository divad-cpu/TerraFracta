// Native controlled status transport only; no server, trial, archive or source.
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
const mode = process.argv[2];
if (!["initial", "retired", "reentrant", "pending-get", "pending-post", "native"].includes(mode)) throw Error("Mode refused");
let cursor = 0, setters = 0, faultInProgress = false; const cells = [], effects = [], layouts = [], requests = [], codes = [];
const register = (list, fn, deps) => { const i = cursor++, old = list[i];
  if (!old || deps.some((v, j) => v !== old.deps[j])) list[i] = { fn, deps, cleanup: old?.cleanup, pending: true }; };
const hooks = { useRef(v) { const i = cursor++; if (!(i in cells)) cells[i] = { current: v }; return cells[i]; },
  useState(v) { const i = cursor++; if (!(i in cells)) cells[i] = v;
    return [cells[i], v => { setters++; cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
  useEffect(fn, deps) { register(effects, fn, deps); }, useLayoutEffect(fn, deps) { register(layouts, fn, deps); } };
const View = loadTsx(new URL("../../src/private-custodian-operation-view.tsx", import.meta.url), n => n === "react" ? hooks :
  n.endsWith("client-error-diagnostics.ts") ? { observeClientError: code => codes.push(code) } : undefined).PrivateCustodianOperationView;
const render = () => { cursor = 0; return View(); };
const markup = () => renderToStaticMarkup(render()), button = () => elements(render()).find(n => n.type === "button").props;
const setup = list => { const jobs = list.filter(v => v?.pending); for (const v of jobs) {
  v.cleanup?.(); v.cleanup = v.fn();
  if (faultInProgress) { outerWrites = setters - outerWrites; faultInProgress = false; }
  v.pending = false; } };
const commit = () => { render(); setup(layouts); setup(effects); };
const clean = list => { for (const v of list) v?.cleanup?.(); };
const recreate = () => { for (const v of [...layouts, ...effects]) if (v) v.pending = true; commit(); };
const replaceObservation = () => { const v = effects.find(Boolean); v.cleanup?.(); v.pending = true; setup(effects); };
const turn = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
globalThis.setTimeout = (callback, ms) => { if (![1_000, 5_000].includes(ms)) throw Error("Unexpected timer"); return { callback, ms }; };
globalThis.clearTimeout = () => {};
let invalidTransport = false, unhandled = 0; const NativeController = AbortController;
process.on("unhandledRejection", () => { unhandled++; });
globalThis.fetch = (url, options) => {
  if (url !== "/api/dev/private-custodian" || options.cache !== "no-store" || !(options.signal instanceof AbortSignal) ||
      !["GET", "POST"].includes(options.method) || (options.method === "GET" ? options.body !== undefined :
        options.body !== '{"action":"run_invented_custodian"}' || options.headers?.["content-type"] !== "application/json")) invalidTransport = true;
  return new Promise(resolve => requests.push({ resolve, signal: options.signal, method: options.method }));
};
const result = { mode }; let pending, escaped = false, outerWrites = 0;
if (mode.startsWith("pending")) {
  commit(); pending = requests[0];
  if (mode === "pending-post") {
    pending.resolve(Response.json({ state: "idle" })); await turn(); commit();
    button().onClick(); pending = requests.at(-1); await turn();
  }
}
if (mode !== "native") globalThis.AbortController = function () {
  if (mode === "retired") clean(layouts);
  if (mode === "reentrant") { globalThis.AbortController = NativeController; replaceObservation(); }
  outerWrites = setters; faultInProgress = true; throw Error("PRIVATE_OBSERVATION_ALLOCATION");
};
try { if (pending) { clean(layouts); clean(effects); recreate(); } else commit(); }
catch { escaped = true; if (faultInProgress) { outerWrites = setters - outerWrites; faultInProgress = false; } }
await turn(); result.escaped = escaped;
result.outerWrites = outerWrites;
result.beforeRecoveryRequests = requests.length;
result.held = /local test status could not be read here/.test(markup());
result.disabled = button().disabled;
result.privateLeak = /PRIVATE_/.test(markup());
globalThis.AbortController = NativeController;
if (pending) {
  pending.resolve(Response.json({ state: mode === "pending-post" ? "running" : "idle" })); await turn(); commit();
  result.afterOldSettlementRequests = requests.length;
  result.oldResultWithheld = !/last confirmed status was running|new sample test is available/.test(markup());
}
if (mode !== "native" && mode !== "reentrant") { clean(layouts); clean(effects); recreate(); }
if (requests.at(-1)?.method === "GET") { requests.at(-1).resolve(Response.json({ state: "idle" })); await turn(); commit(); }
result.recoveredIdle = button().disabled === false;
result.finalGets = requests.filter(v => v.method === "GET").length;
result.finalPosts = requests.filter(v => v.method === "POST").length;
clean(layouts); clean(effects); await turn();
result.unhandled = unhandled; result.invalidTransport = invalidTransport; result.codes = codes;
process.stdout.write(JSON.stringify(result) + "\n");
