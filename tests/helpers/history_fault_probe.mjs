// Controlled native responses and actual callbacks, without archive writes or HTTP.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
import { handleFictionalHistoryPageRequest } from "../../src/server/fictional-receipt-page.ts";

const mode = process.argv[2];
if (!["setup", "loaded", "retired", "layout", "passive", "native", "valid"].includes(mode)) throw Error("Probe mode refused");
const report = JSON.parse(readFileSync(new URL("../../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const entries = Array.from({ length: 10 }, (_, i) => ({ execution: {
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`, kind: "local_fictional", scenario: "standard",
  executedAt: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`, durationMs: 1,
}, report: structuredClone(report) }));
let diagnosticCalls = 0;
const response = url => handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"),
  { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => ({ entries, totalReceipts: 10,
    unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true }), async () => { diagnosticCalls++; });
let cursor = 0, effect, layout, setters = 0, inspected = 0; const cells = [];
const hooks = { useRef(v) { const i = cursor++; if (!(i in cells)) cells[i] = { current: v }; return cells[i]; },
  useState(v) { const i = cursor++; if (!(i in cells)) cells[i] = v;
    return [cells[i], v => { setters++; cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
  useEffect(fn) { effect = fn; }, useLayoutEffect(fn) { layout = fn; } };
const View = loadTsx(new URL("../../app/update-preview/history.tsx", import.meta.url), n => n === "react" ? hooks : undefined).FictionalHistory;
const render = () => { cursor = 0; return View({ onInspect() { inspected++; }, onUseEarlier() { inspected++; } }); };
const html = () => renderToStaticMarkup(render());
const text = n => Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" ? text(n.props?.children) : String(n ?? "");
const button = label => elements(render()).find(n => n.type === "button" && text(n).startsWith(label))?.props;
const load = () => elements(render()).find(n => n.type === "form").props.onSubmit({ preventDefault() {} });
const turn = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
let lc, pc; const mount = () => { render(); lc = layout(); pc = effect(); };
const requests = [], NativeController = AbortController; let invalidTransport = false, unhandled = 0, aborts = 0;
process.on("unhandledRejection", () => { unhandled++; });
globalThis.fetch = (url, options) => {
  if (url !== "/api/dev/update-rehearsal/history/page" || options.method !== "GET" || options.cache !== "no-store" ||
      options.body !== undefined || !(options.signal instanceof AbortSignal)) invalidTransport = true;
  return new Promise(resolve => requests.push({ url, resolve, signal: options.signal }));
};
mount(); const result = { mode };
if (["setup", "loaded", "retired", "valid"].includes(mode)) {
  let oldRow;
  if (mode !== "setup") { load(); requests[0].resolve(await response(requests[0].url)); await turn();
    result.initialRows = /Page 1 of 2/.test(html()); oldRow = button("Inspect saved")?.onClick; }
  const reads = requests.length, writes = setters;
  if (mode !== "valid") globalThis.AbortController = function () { if (mode === "retired") lc(); throw Error("PRIVATE_HISTORY_SETUP"); };
  load(); await turn(); result.refusalReads = requests.length - reads; result.retiredWrites = setters - writes;
  result.held = /local fictional history could not be read/.test(html()); result.oldRowsWithheld = !/Page 1 of 2/.test(html());
  oldRow?.(); result.retainedRowSelections = inspected;
  globalThis.AbortController = NativeController;
  if (mode === "retired") mount();
  if (mode !== "valid") load();
  requests.at(-1).resolve(await response(requests.at(-1).url)); await turn();
  result.recoveryReads = requests.length; result.recoveryRows = /Page 1 of 2/.test(html());
  result.recoverySelectable = button("Load filtered").disabled === false;
} else {
  let outer;
  globalThis.AbortController = function () { const c = new NativeController(); if (!outer) {
    outer = c; if (mode !== "native") c.abort = () => { aborts++; throw Error("PRIVATE_HISTORY_ABORT"); }; } return c; };
  const oldLoad = button("Load filtered").onClick; load(); await turn();
  result.escaped = false; result.otherCleanupEscaped = false;
  try { (mode === "passive" ? pc : lc)(); } catch { result.escaped = true; }
  result.outerSignalAborted = outer.signal.aborted; result.aborts = aborts;
  const writes = setters; oldLoad(); await turn(); result.retiredControlWrites = setters - writes;
  try { (mode === "passive" ? lc : pc)(); } catch { result.otherCleanupEscaped = true; }
  globalThis.AbortController = NativeController; mount();
  result.waitingDisabled = button("Reading").disabled; load(); await turn(); result.requestsWhileWaiting = requests.length;
  requests[0].resolve(await response(requests[0].url)); await turn();
  result.oldRowsWithheld = !/Page 1 of 2/.test(html()); result.availableAfterSettlement = button("Load filtered").disabled === false;
  result.requestsAfterSettlement = requests.length; oldLoad(); await turn(); result.requestsAfterOldControl = requests.length;
  load(); requests.at(-1).resolve(await response(requests.at(-1).url)); await turn();
  result.recoveryReads = requests.length; result.recoveryRows = /Page 1 of 2/.test(html());
}
globalThis.AbortController = NativeController; lc(); pc(); await turn();
result.unhandled = unhandled; result.invalidTransport = invalidTransport; result.privateLeak = /PRIVATE_/.test(html());
result.diagnosticCalls = diagnosticCalls;
process.stdout.write(JSON.stringify(result) + "\n");
