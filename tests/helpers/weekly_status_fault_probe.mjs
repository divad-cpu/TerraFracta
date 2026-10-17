// Actual void callbacks and native controller/response seams; no HTTP or Browser.
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";

const mode = process.argv[2];
if (!["setup", "observed", "retired", "layout", "passive", "native", "valid"].includes(mode)) throw Error("Probe mode refused");
const observed = { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} };
let cursor = 0, effect, layout, setters = 0; const cells = [];
const hooks = {
  useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
  useState(value) { const i = cursor++; if (!(i in cells)) cells[i] = value;
    return [cells[i], value => { setters++; cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
  useEffect(fn) { effect = fn; }, useLayoutEffect(fn) { layout = fn; },
};
const View = loadTsx(new URL("../../src/weekly-rehearsal-status-view.tsx", import.meta.url), name => name === "react" ? hooks : undefined).WeeklyRehearsalStatusView;
const render = () => { cursor = 0; return View(); };
const buttons = () => elements(render()).filter(n => n.type === "button").map(n => n.props);
const markup = () => renderToStaticMarkup(render());
const turn = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
let layoutCleanup, passiveCleanup;
const mount = () => { render(); layoutCleanup = layout(); passiveCleanup = effect(); };
let unhandled = 0, invalidTransport = false, downloads = 0, controllerCalls = 0, aborts = 0;
const unhandledListener = () => { unhandled++; }; process.on("unhandledRejection", unhandledListener);
const NativeController = globalThis.AbortController, requests = [];
globalThis.fetch = (url, options) => {
  if (url !== "/api/dev/update-rehearsal/status" || options.method !== "GET" || options.cache !== "no-store" ||
      options.body !== undefined || !(options.signal instanceof AbortSignal)) invalidTransport = true;
  return new Promise(resolve => requests.push({ resolve, signal: options.signal }));
};
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => ms === 1_000 ? (queueMicrotask(fn), null) : nativeTimeout(fn, ms, ...args);
URL.createObjectURL = () => { downloads++; return "blob:weekly-probe"; }; URL.revokeObjectURL = () => {};
globalThis.document = { createElement: () => ({ href: "", download: "", click() {}, remove() {} }), body: { append() {} } };
mount(); const result = { mode };
if (["setup", "observed", "retired", "valid"].includes(mode)) {
  let oldDownload;
  if (mode !== "setup") {
    buttons()[0].onClick(); requests[0].resolve(Response.json(observed)); await turn();
    result.initialObserved = /8 saved receipts/.test(markup()); oldDownload = buttons()[1]?.onClick;
    oldDownload?.(); await turn(); result.initialDownload = downloads;
  }
  const originalWrites = setters, readsBefore = requests.length;
  if (mode !== "valid") globalThis.AbortController = function () {
    controllerCalls++;
    if (mode === "retired") layoutCleanup();
    throw Error("PRIVATE_WEEKLY_CONTROLLER_SETUP");
  };
  buttons()[0].onClick(); await turn();
  result.refusalReads = requests.length - readsBefore; result.controllerCalls = controllerCalls;
  result.retiredSetupWrites = setters - originalWrites;
  result.held = /weekly history could not be verified/.test(markup());
  result.oldResultWithheld = !/8 saved receipts/.test(markup());
  result.oldExportWithheld = !buttons().some(n => n.children === "Download dated rehearsal assessment");
  result.oldNoticeWithheld = !/Download requested/.test(markup());
  const beforeDownload = downloads; oldDownload?.(); result.retainedDownloadAllocations = downloads - beforeDownload;
  globalThis.AbortController = NativeController;
  if (mode === "retired") mount();
  if (mode === "valid") { requests.at(-1).resolve(Response.json(observed)); await turn(); }
  else { buttons()[0].onClick(); requests.at(-1).resolve(Response.json(observed)); await turn(); }
  result.recoveryReads = requests.length; result.recoveryObserved = /8 saved receipts/.test(markup());
  result.recoverySelectable = buttons()[0].disabled === false;
} else {
  let outer;
  globalThis.AbortController = function () {
    const controller = new NativeController();
    if (!outer) { outer = controller; if (mode !== "native") controller.abort = () => { aborts++; throw Error("PRIVATE_WEEKLY_ABORT"); }; }
    return controller;
  };
  buttons()[0].onClick(); await turn(); const retiredControl = buttons()[0].onClick;
  result.escaped = false; result.otherCleanupEscaped = false;
  try { (mode === "passive" ? passiveCleanup : layoutCleanup)(); } catch { result.escaped = true; }
  result.outerSignalAborted = outer.signal.aborted; result.aborts = aborts;
  const writes = setters; retiredControl(); await turn(); result.retiredControlWrites = setters - writes;
  try { (mode === "passive" ? layoutCleanup : passiveCleanup)(); } catch { result.otherCleanupEscaped = true; }
  globalThis.AbortController = NativeController; mount();
  result.waitingDisabled = buttons()[0].disabled;
  buttons()[0].onClick(); await turn(); result.requestsWhileWaiting = requests.length;
  requests[0].resolve(Response.json(observed)); await turn();
  result.availableAfterSettlement = buttons()[0].disabled === false;
  result.oldResultWithheld = !/8 saved receipts/.test(markup());
  result.requestsAfterSettlement = requests.length;
  retiredControl(); await turn(); result.requestsAfterOldControl = requests.length;
  buttons()[0].onClick(); requests.at(-1).resolve(Response.json(observed)); await turn();
  result.recoveryReads = requests.length; result.recoveryObserved = /8 saved receipts/.test(markup());
}
globalThis.AbortController = NativeController; layoutCleanup(); passiveCleanup(); await turn();
result.unhandled = unhandled; result.invalidTransport = invalidTransport; result.privateLeak = /PRIVATE_/.test(markup());
process.removeListener("unhandledRejection", unhandledListener);
process.stdout.write(JSON.stringify(result) + "\n");
