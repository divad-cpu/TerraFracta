import { diagnosticIntentSchema, diagnosticCodes, type DiagnosticCode } from "./error-diagnostics.ts";

export function createClientErrorReporter(environment: string | undefined,
  send: typeof fetch = fetch, uuid: () => string = () => crypto.randomUUID(), now = () => performance.now()) {
  let windowStart = -Infinity, count = 0, active = false, observingClock = false;
  return async (code: DiagnosticCode): Promise<string | null> => {
    if (environment !== "development" || diagnosticCodes[code]?.origin !== "browser" || active || observingClock) return null;
    let time: number;
    observingClock = true;
    try { time = now(); } catch { return null; }
    finally { observingClock = false; }
    if (!Number.isFinite(time) || time < windowStart) return null;
    if (time - windowStart >= 60_000) { windowStart = time; count = 0; }
    if (count >= 10) return null;
    count++; active = true;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    let deadline: Promise<null>;
    let retired = false, expired = false;
    // Establish all resources before entropy or dispatch. Failed setup retires
    // only the unused slot; an actual send owns its slot until settlement.
    try {
      controller = new AbortController();
      let expire = () => {};
      deadline = new Promise<null>(resolve => {
        expire = () => {
          if (retired) return;
          expired = true;
          try { controller.abort(); } catch { /* Deadline refusal still settles. */ }
          resolve(null);
        };
      });
      timer = setTimeout(expire, 1_500);
    } catch { retired = true; active = false; return null; }
    const work = (async () => {
      try {
        const intent = diagnosticIntentSchema.parse({ eventId: uuid(), code });
        if (expired || controller.signal.aborted) return null;
        const response = await send("/api/dev/error-log", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(intent), cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const elapsed = now() - time;
        return !expired && !controller.signal.aborted && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1_500 && response.status === 204 ? intent.eventId : null;
      } catch { return null; }
      finally { active = false; }
    })();
    // An unacknowledged send keeps the single owned slot after the caller's
    // timeout. Later errors cannot create unbounded suspended sends.
    try { return await Promise.race([work, deadline]); }
    finally {
      retired = true;
      try { clearTimeout(timer); } catch { /* Preserve the original acknowledgement/refusal. */ }
    }
  };
}
export const reportClientError = createClientErrorReporter(process.env.NODE_ENV);

// Caught actions keep their original recovery state even when reporting itself
// throws, rejects or never settles. The reporter receives only the fixed code.
export function observeClientError(code: DiagnosticCode,
  report: (code: DiagnosticCode) => unknown = reportClientError): void {
  void Promise.resolve().then(() => report(code)).catch(() => {});
}

export function installClientErrorListeners(target: Pick<Window, "addEventListener" | "removeEventListener">,
  report: (code: DiagnosticCode) => Promise<unknown> = reportClientError) {
  // Never read event/error fields. Retained or already queued callbacks cannot
  // report after retirement, even if the target refuses listener removal.
  let active = false, retired = false, runtimeAttempted = false, rejectionAttempted = false;
  const currentReport = (code: DiagnosticCode) => active ? report(code) : undefined;
  const runtime = () => { if (active) observeClientError("browser_runtime", currentReport); };
  const rejection = () => { if (active) observeClientError("browser_promise", currentReport); };
  const retire = () => {
    if (retired) return;
    retired = true; active = false;
    try { if (runtimeAttempted) target.removeEventListener("error", runtime, true); } catch { /* Attempt the other listener independently. */ }
    try { if (rejectionAttempted) target.removeEventListener("unhandledrejection", rejection); } catch { /* Retained callbacks are inactive. */ }
  };
  try {
    runtimeAttempted = true;
    target.addEventListener("error", runtime, true);
    rejectionAttempted = true;
    target.addEventListener("unhandledrejection", rejection);
    active = true;
  } catch (error) { retire(); throw error; }
  return retire;
}
