// Isolated native process: observe the actual void file-event callback without
// intercepting its promise or suppressing the parent test runner's rejection policy.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
import { scopeDraftHarness } from "./scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
import { scopeDraftJson } from "../../src/issue-scope-draft.ts";
import { proposalReport } from "./proposal_fixture.mjs";
import { buildDiagnosticReport } from "../../src/diagnostic-report.ts";
import { makeDiagnosticEvent } from "../../src/error-diagnostics.ts";
import { exportFictionalSavedRun } from "../../src/fictional-saved-run-export.ts";

const variant = process.argv[2];
if (!["diagnostic", "selected", "earlier", "scope"].includes(variant)) throw Error("Probe variant refused");
const scope = variant === "scope", diagnostic = variant === "diagnostic";
const suffix = scope || diagnostic ? "-file" : `-${variant}-file`;
let h, body;
if (scope) {
  const context = capturedScopeDraftContext(proposalReport()); h = scopeDraftHarness(context);
  body = scopeDraftJson({ schemaVersion: 1, kind: "issue_scope_preparation", binding: context.binding,
    fields: { population: null, period: null, selectionRationale: null } }, context);
} else {
  let cursor = 0; const cells = [], effects = [], layouts = [];
  const hooks = { useId: () => "setup-probe", useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
    useState(value) { const i = cursor++; if (!(i in cells)) cells[i] = typeof value === "function" ? value() : value;
      return [cells[i], next => { cells[i] = typeof next === "function" ? next(cells[i]) : next; }]; },
    useEffect(fn) { effects.push(fn); }, useLayoutEffect(fn) { layouts.push(fn); } };
  const name = diagnostic ? "diagnostic-import-view" : "fictional-saved-run-import-view";
  const View = loadTsx(new URL(`../../src/${name}.tsx`, import.meta.url), n => n === "react" ? hooks : undefined)[diagnostic ? "DiagnosticImportView" : "FictionalSavedRunImportView"];
  let cleanup = [], layoutCleanup = [];
  const render = () => { cursor = 0; return View(); };
  h = { render, nodes: () => elements(render()), mount() { render(); layoutCleanup = layouts.map(fn => fn()); cleanup = effects.map(fn => fn()); },
    unmount() { for (const fn of layoutCleanup) fn?.(); for (const fn of cleanup) fn?.(); } };
  body = diagnostic ? JSON.stringify(buildDiagnosticReport({ events: [makeDiagnosticEvent("weekly_assessment_export",
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", new Date("2026-10-03T12:00:00Z"))], unreadable: 0, filesObserved: 1, stable: true, locked: false }, new Date("2026-10-03T13:00:00Z")))
    : exportFictionalSavedRun({ execution: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "local_fictional", scenario: "standard", executedAt: "2026-10-10T10:00:00Z", durationMs: 1 },
      report: JSON.parse(readFileSync(new URL("../../fixtures/fictional_update_report.json", import.meta.url))) });
}
const input = () => h.nodes().find(n => n.type === "input" && n.props.id?.endsWith(suffix)).props;
const markup = () => renderToStaticMarkup(h.render());
const turn = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
let unhandledRejections = 0, controllerCalls = 0, fileReads = 0, transportCalls = 0;
const unhandled = () => { unhandledRejections++; };
process.on("unhandledRejection", unhandled);
const NativeController = globalThis.AbortController;
globalThis.fetch = () => { transportCalls++; throw Error("Probe transport refused"); };
h.mount();
globalThis.AbortController = function () { controllerCalls++; throw Error("PRIVATE_SETUP_FAILURE"); };
const file = new File([body], "PRIVATE_FILE_NAME.json"), nativeSlice = file.slice.bind(file);
file.slice = (...args) => { fileReads++; return nativeSlice(...args); };
const event = { files: [file], value: "PRIVATE_FILE_NAME" };
input().onChange({ currentTarget: event }); await turn();
const held = scope ? /could not be checked/.test(markup()) : /could not be read/.test(markup());
const observation = { variant, unhandledRejections, controllerCalls, fileReads, transportCalls, held,
  selectable: input().disabled === false, inputReset: event.value === "", privateLeak: /PRIVATE_/.test(markup()) };
globalThis.AbortController = NativeController;
input().onChange({ currentTarget: { files: [file], value: "" } }); await turn();
observation.recovered = (scope ? /Local preparation file opened/ : diagnostic ? /1 validated records/ : new RegExp(`Inspect the ${variant} historical file`)).test(markup());
observation.recoveryReads = fileReads; observation.totalUnhandledRejections = unhandledRejections;
observation.totalTransportCalls = transportCalls;
h.unmount(); process.removeListener("unhandledRejection", unhandled);
process.stdout.write(JSON.stringify(observation) + "\n");
