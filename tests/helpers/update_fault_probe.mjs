// Native controllers/responses with a controlled POST seam: no server or archive.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
const mode = process.argv[2];
if (!["setup", "saved", "retired", "changed", "layout", "passive", "native", "valid"].includes(mode)) throw Error("Probe mode refused");
const report = JSON.parse(readFileSync(new URL("../../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const receipt = { execution: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "local_fictional", scenario: "standard",
  executedAt: "2026-10-10T10:01:00Z", durationMs: 1 }, report: {
    ...structuredClone(report), trigger: "manual", scheduledDueAt: null, requestKey: "manual:fictional-country:local-probe",
  } };
let cursor = 0, setters = 0; const cells = [], effects = [], layouts = [];
const hooks = { useId: () => "update-native-fault",
  useRef(v) { const i = cursor++; if (!(i in cells)) cells[i] = { current: v }; return cells[i]; },
  useState(v) { const i = cursor++; if (!(i in cells)) cells[i] = v;
    return [cells[i], v => { setters++; cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
  useEffect(fn) { effects.push(fn); }, useLayoutEffect(fn) { layouts.push(fn); } };
const History = () => null, Candidate = () => null, Comparison = () => null;
const View = loadTsx(new URL("../../app/update-preview/operation.tsx", import.meta.url), n => n === "react" ? hooks :
  n === "./history" ? { FictionalHistory: History } : n === "./candidate" ? { FictionalCandidate: Candidate } :
  n === "./comparison" ? { FictionalComparison: Comparison } : undefined).UpdateOperation;
const render = () => { cursor = 0; effects.length = 0; layouts.length = 0; return View({ initialReport: report }); };
const html = () => renderToStaticMarkup(render());
const nodes = () => elements(render()); const field = () => nodes().find(n => n.type === "select").props;
let prevented = 0; const submit = () => nodes().find(n => n.type === "form").props.onSubmit({ preventDefault() { prevented++; } });
const button = () => nodes().find(n => n.type === "button" && n.props.type === "submit").props;
let layoutCleanups, passiveCleanups;
const mount = () => { render(); const ls = [...layouts], es = [...effects]; layoutCleanups = ls.map(fn => fn()); passiveCleanups = es.map(fn => fn()); };
const retireLayout = () => { for (const fn of layoutCleanups) fn?.(); };
const retirePassive = () => { for (const fn of passiveCleanups) fn?.(); };
const turn = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const NativeController = AbortController, requests = []; let unhandled = 0, invalidTransport = false, aborts = 0;
process.on("unhandledRejection", () => { unhandled++; });
globalThis.fetch = (url, options) => {
  if (url !== "/api/dev/update-rehearsal" || options.method !== "POST" || options.cache !== "no-store" ||
      options.headers?.["content-type"] !== "application/json" || options.body !== JSON.stringify({ trigger: "manual", scenario: "standard" }) ||
      !(options.signal instanceof AbortSignal)) invalidTransport = true;
  return new Promise(resolve => requests.push({ resolve, signal: options.signal }));
};
mount(); const result = { mode };
if (["setup", "saved", "retired", "changed", "valid"].includes(mode)) {
  if (mode === "saved") nodes().find(n => n.type === History).props.onInspect(receipt);
  result.initialSaved = /Saved local execution/.test(html()); const originalWrites = setters;
  if (mode !== "valid") globalThis.AbortController = function () {
    if (mode === "retired") retireLayout();
    if (mode === "changed") field().onChange({ target: { value: "revised_value" } });
    throw Error("PRIVATE_UPDATE_SETUP");
  };
  submit(); await turn(); result.refusalRequests = requests.length; result.refusalWrites = setters - originalWrites;
  result.held = /local rehearsal could not be started/.test(html());
  result.noDispatchNotice = /No request was sent/.test(html());
  result.savedPreserved = /Saved local execution/.test(html()); result.choiceAfterFault = field().value;
  globalThis.AbortController = NativeController;
  if (mode === "retired") mount();
  if (mode === "changed") field().onChange({ target: { value: "standard" } });
  if (mode !== "valid") submit();
  requests.at(-1).resolve(Response.json(receipt)); await turn();
  result.recoveryRequests = requests.length; result.recoveryFresh = /Fresh local execution/.test(html());
  result.recoverySelectable = button().disabled === false;
} else {
  let outer;
  globalThis.AbortController = function () { const c = new NativeController(); if (!outer) {
    outer = c; if (mode !== "native") c.abort = () => { aborts++; throw Error("PRIVATE_UPDATE_ABORT"); }; } return c; };
  const oldSubmit = nodes().find(n => n.type === "form").props.onSubmit; submit(); await turn();
  result.escaped = false; result.otherCleanupEscaped = false;
  try { (mode === "passive" ? retirePassive : retireLayout)(); } catch { result.escaped = true; }
  result.outerSignalAborted = outer.signal.aborted; result.aborts = aborts;
  const writes = setters; oldSubmit({ preventDefault() { prevented++; } }); await turn(); result.retiredControlWrites = setters - writes;
  try { (mode === "passive" ? retireLayout : retirePassive)(); } catch { result.otherCleanupEscaped = true; }
  globalThis.AbortController = NativeController; mount(); result.waitingDisabled = button().disabled;
  submit(); await turn(); result.requestsWhileWaiting = requests.length;
  requests[0].resolve(Response.json(receipt)); await turn();
  result.oldResultWithheld = !/Fresh local execution/.test(html()); result.availableAfterSettlement = button().disabled === false;
  result.requestsAfterSettlement = requests.length; oldSubmit({ preventDefault() { prevented++; } }); await turn();
  result.requestsAfterOldControl = requests.length;
  submit(); requests.at(-1).resolve(Response.json(receipt)); await turn();
  result.recoveryRequests = requests.length; result.recoveryFresh = /Fresh local execution/.test(html());
}
globalThis.AbortController = NativeController; retireLayout(); retirePassive(); await turn();
result.unhandled = unhandled; result.invalidTransport = invalidTransport; result.privateLeak = /PRIVATE_/.test(html()); result.prevented = prevented;
process.stdout.write(JSON.stringify(result) + "\n");
