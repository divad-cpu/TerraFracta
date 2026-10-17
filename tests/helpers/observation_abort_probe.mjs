// Actual native callbacks and controlled responses in an isolated process.
// Cancellation never certifies backend completion or releases a physical slot.
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";
const variants = {
  parent: ["current-parent-source-view", "CurrentParentSourceView", "/api/dev/parent-source"],
  copy: ["current-copy-scope-view", "CurrentCopyScopeView", "/api/dev/copy-scope"],
  preparation: ["current-private-preparation-view", "CurrentPrivatePreparationView", "/api/dev/source-readiness"],
  manual: ["correction-review-operation-view", "CorrectionReviewOperationView", "/api/dev/correction-review"],
  supervised: ["correction-review-operation-view", "CorrectionReviewOperationView", "/api/dev/supervised-correction-review"],
};
const [variant, retirement] = process.argv.slice(2);
if (!Object.hasOwn(variants, variant) || !["layout", "passive", "native"].includes(retirement)) throw Error("Probe arguments refused");
const v = variants[variant], automatic = variant === "manual" || variant === "supervised", fault = retirement !== "native";
let cursor = 0, effect, layout, cleanup, layoutCleanup, writes = 0; const cells = [];
const hooks = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
  return [cells[i], next => { writes++; cells[i] = typeof next === "function" ? next(cells[i]) : next; }]; },
  useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
  useEffect(fn) { effect = fn; }, useLayoutEffect(fn) { layout = fn; } };
const View = loadTsx(new URL(`../../src/${v[0]}.tsx`, import.meta.url), name => name === "react" ? hooks : undefined)[v[1]];
const render = () => { cursor = 0; return View({ supervised: variant === "supervised" }); };
const button = () => elements(render()).find(n => n.type === "button").props;
const markup = () => renderToStaticMarkup(render());
const mount = () => { render(); layoutCleanup = layout?.(); cleanup = effect(); };
const turn = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const NativeController = globalThis.AbortController;
let outer, aborts = 0, invalidTransport = false, unhandled = 0; const requests = [];
const onUnhandled = () => { unhandled++; }; process.on("unhandledRejection", onUnhandled);
globalThis.AbortController = function () {
  const controller = new NativeController();
  if (!outer) { outer = controller; if (fault) controller.abort = () => { aborts++; throw Error("PRIVATE_ABORT_FAULT"); }; }
  return controller;
};
globalThis.fetch = (url, options) => {
  if (url !== v[2] || options.method !== "GET" || options.cache !== "no-store" || options.body !== undefined || !(options.signal instanceof AbortSignal)) invalidTransport = true;
  return new Promise(resolve => requests.push({ resolve, signal: options.signal }));
};
mount(); if (!automatic) button().onClick(); const old = button().onClick;
let escaped = false;
try { retirement === "passive" ? cleanup?.() : layoutCleanup?.(); } catch { escaped = true; }
const retiredWrites = writes; old();
const observation = { variant, retirement, escaped, aborts, outerSignalAborted: outer.signal.aborted,
  retiredControlWrites: writes - retiredWrites, requestsBeforeReadmission: requests.length };
// Both cleanup phases are independently quiet. A fresh visit must await the
// original deferred response and require a new explicit read after settlement.
try { layoutCleanup?.(); cleanup?.(); } catch { observation.otherCleanupEscaped = true; }
observation.otherCleanupEscaped ??= false;
mount(); const waiting = button(); old(); waiting.onClick();
observation.waitingDisabled = waiting.disabled; observation.requestsWhileWaiting = requests.length;
requests[0].resolve(new Response(null, { status: 503 })); await turn();
observation.availableAfterSettlement = button().disabled === false;
observation.oldResultWithheld = !/current comparison is unavailable|copy-setting observation is unavailable|local observation is unavailable|saved result is unavailable/.test(markup());
old(); observation.requestsAfterOldControl = requests.length;
button().onClick(); observation.explicitRecoveryReads = requests.length;
requests[1]?.resolve(new Response(null, { status: 503 })); await turn();
observation.recoveryHeld = /current comparison is unavailable|copy-setting observation is unavailable|local observation is unavailable|saved result is unavailable/.test(markup());
observation.invalidTransport = invalidTransport; observation.unhandled = unhandled; observation.privateLeak = /PRIVATE_/.test(markup());
layoutCleanup?.(); cleanup?.(); process.removeListener("unhandledRejection", onUnhandled);
process.stdout.write(JSON.stringify(observation) + "\n");
