// Native child observes actual view callbacks; no HTTP or Browser is involved.
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./tsx_loader.mjs";
import { elements } from "./correction_draft_harness.mjs";

const variants = {
  parent: { file: "current-parent-source-view", component: "CurrentParentSourceView", endpoint: "/api/dev/parent-source", held: /current comparison is unavailable/ },
  copy: { file: "current-copy-scope-view", component: "CurrentCopyScopeView", endpoint: "/api/dev/copy-scope", held: /copy-setting observation is unavailable/ },
  preparation: { file: "current-private-preparation-view", component: "CurrentPrivatePreparationView", endpoint: "/api/dev/source-readiness", held: /local observation is unavailable/ },
  manual: { file: "correction-review-operation-view", component: "CorrectionReviewOperationView", endpoint: "/api/dev/correction-review", held: /saved result is unavailable/ },
  supervised: { file: "correction-review-operation-view", component: "CorrectionReviewOperationView", endpoint: "/api/dev/supervised-correction-review", held: /saved result is unavailable/ },
};
const variant = process.argv[2];
if (!Object.hasOwn(variants, variant)) throw Error("Probe variant refused");
const v = variants[variant], automatic = variant === "manual" || variant === "supervised";
let cursor = 0, effect, layout, cleanup, layoutCleanup; const cells = [];
const hooks = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
  return [cells[i], next => { cells[i] = typeof next === "function" ? next(cells[i]) : next; }]; },
  useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
  useEffect(fn) { effect = fn; }, useLayoutEffect(fn) { layout = fn; } };
const View = loadTsx(new URL(`../../src/${v.file}.tsx`, import.meta.url), name => name === "react" ? hooks : undefined)[v.component];
const render = () => { cursor = 0; return View({ supervised: variant === "supervised" }); };
const button = () => elements(render()).find(n => n.type === "button").props;
const markup = () => renderToStaticMarkup(render());
const turn = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
let unhandledRejections = 0, controllerCalls = 0, transportCalls = 0, invalidTransport = false;
const unhandled = () => { unhandledRejections++; }; process.on("unhandledRejection", unhandled);
const NativeController = globalThis.AbortController;
globalThis.AbortController = function () { controllerCalls++; throw Error("PRIVATE_OBSERVATION_SETUP"); };
globalThis.fetch = async (url, options) => {
  transportCalls++;
  if (url !== v.endpoint || options.method !== "GET" || options.cache !== "no-store" || options.body !== undefined || !(options.signal instanceof AbortSignal)) invalidTransport = true;
  return new Response(null, { status: 503 });
};
render(); layoutCleanup = layout?.(); cleanup = effect();
if (!automatic) button().onClick(); await turn();
const observation = { variant, unhandledRejections, controllerCalls, transportCalls, held: v.held.test(markup()),
  selectable: button().disabled === false, privateLeak: /PRIVATE_/.test(markup()) };
globalThis.AbortController = NativeController;
button().onClick(); await turn();
observation.recoveryReads = transportCalls; observation.recoveryHeld = v.held.test(markup());
observation.recoverySelectable = button().disabled === false; observation.invalidTransport = invalidTransport;
const retired = button().onClick; layoutCleanup?.(); cleanup?.(); retired(); await turn();
observation.retiredReads = transportCalls; observation.totalUnhandledRejections = unhandledRejections;
process.removeListener("unhandledRejection", unhandled); process.stdout.write(JSON.stringify(observation) + "\n");
