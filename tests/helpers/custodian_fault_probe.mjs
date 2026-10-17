// Controlled native transport and explicit timer seams. No trial or server runs.
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
const mode = process.argv[2];
if (!["get-layout", "get-passive", "get-native", "post-layout", "post-passive", "post-native", "get-error", "post-error", "setup-start", "retired-start"].includes(mode)) throw Error("Mode refused");
let cursor = 0, setters = 0; const cells = [], effects = [], layouts = [], codes = [], requests = [];
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
  v.cleanup?.(); v.cleanup = v.fn(); v.pending = false; } };
const commit = () => { render(); setup(layouts); setup(effects); };
const clean = list => { for (const v of list) v?.cleanup?.(); };
const recreate = () => { for (const v of [...layouts, ...effects]) if (v) v.pending = true; commit(); };
const turn = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
globalThis.setTimeout = (callback, ms) => { if (![1_000, 5_000].includes(ms)) throw Error("Unexpected timer"); return { callback, ms }; };
globalThis.clearTimeout = () => {};
let invalidTransport = false, unhandled = 0, aborts = 0; const NativeController = AbortController;
process.on("unhandledRejection", () => { unhandled++; });
globalThis.fetch = (url, options) => {
  if (url !== "/api/dev/private-custodian" || options.cache !== "no-store" || !(options.signal instanceof AbortSignal) ||
      !["GET", "POST"].includes(options.method) || (options.method === "GET" ? options.body !== undefined :
        options.body !== '{"action":"run_invented_custodian"}' || options.headers?.["content-type"] !== "application/json")) invalidTransport = true;
  return new Promise(resolve => requests.push({ resolve, signal: options.signal, method: options.method }));
};
const result = { mode };
if (mode.endsWith("start")) {
  commit(); requests[0].resolve(Response.json({ state: "idle" })); await turn(); commit();
  result.initialAdmitted = button().disabled === false;
  const writes = setters;
  globalThis.AbortController = function () { if (mode === "retired-start") clean(layouts); throw Error("PRIVATE_CUSTODIAN_SETUP"); };
  button().onClick(); await turn(); result.setupWrites = setters - writes;
  result.held = /invented test could not be started here/.test(markup()); result.noPostNotice = /No start request was sent/.test(markup());
  result.setupPosts = requests.filter(v => v.method === "POST").length;
  globalThis.AbortController = NativeController;
  if (mode === "retired-start") { clean(effects); recreate();
    requests.at(-1).resolve(Response.json({ state: "idle" })); await turn(); commit(); }
  button().onClick(); requests.at(-1).resolve(Response.json({ state: "running" })); await turn(); commit();
  result.recoveryPosts = requests.filter(v => v.method === "POST").length;
  result.recoveryRunning = /last confirmed status was running/.test(markup());
} else {
  const post = mode.startsWith("post"), native = mode.endsWith("native"), passive = mode.endsWith("passive");
  let outer;
  const fault = () => { globalThis.AbortController = function () { const c = new NativeController(); if (!outer) {
    outer = c; if (!native) c.abort = () => { aborts++; throw Error("PRIVATE_CUSTODIAN_ABORT"); }; } return c; }; };
  if (!post) fault(); commit();
  if (post) { requests[0].resolve(Response.json({ state: "idle" })); await turn(); commit(); fault(); button().onClick(); await turn(); }
  const pending = requests.at(-1), oldControl = button().onClick, firstWrites = setters;
  result.escaped = false; result.otherCleanupEscaped = false;
  try { clean(passive ? effects : layouts); } catch { result.escaped = true; }
  result.outerSignalAborted = outer.signal.aborted;
  const afterRetirement = setters; oldControl(); await turn(); result.retiredControlWrites = setters - afterRetirement;
  try { clean(passive ? layouts : effects); } catch { result.otherCleanupEscaped = true; }
  globalThis.AbortController = NativeController; recreate(); result.waitingDisabled = button().disabled;
  button().onClick(); await turn(); result.beforeSettlementRequests = requests.length;
  const beforeReply = setters;
  pending.resolve(mode.endsWith("error") ? new Response(null, { status: 503 }) : Response.json({ state: post ? "running" : "idle" }));
  await turn(); result.lateResultWrites = setters - beforeReply; commit();
  result.afterSettlementRequests = requests.length;
  result.oldResultWithheld = !/last confirmed status was running|new sample test is available/.test(markup());
  result.freshObservationPending = requests.at(-1) !== pending && requests.at(-1).method === "GET";
  if (result.freshObservationPending) { requests.at(-1).resolve(Response.json({ state: "idle" })); await turn(); commit(); }
  result.freshIdleAdmitted = button().disabled === false; oldControl(); await turn();
  result.finalPosts = requests.filter(v => v.method === "POST").length;
  result.retirementHadNoWrites = afterRetirement === firstWrites;
}
globalThis.AbortController = NativeController; clean(layouts); clean(effects); await turn();
result.unhandled = unhandled; result.invalidTransport = invalidTransport; result.privateLeak = /PRIVATE_/.test(markup());
result.codes = codes; result.aborts = aborts;
process.stdout.write(JSON.stringify(result) + "\n");
