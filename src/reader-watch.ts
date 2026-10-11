export type ReaderWatchControls = {
  visible: () => boolean;
  interval: typeof setInterval; clearInterval: typeof clearInterval;
  timeout: typeof setTimeout; clearTimeout: typeof clearTimeout;
  now?: () => number;
};

// Shared lifecycle for the existing fictional reader and current publications.
// A withheld view stays terminal until its owner explicitly remounts/reloads.
export function startReaderWatch<Verdict extends { kind: string }>(
  changed: (status: Verdict) => void, verify: (signal: AbortSignal) => Promise<Verdict>,
  controls: ReaderWatchControls, unavailable: () => Verdict,
) {
  let stopped = false, inFlight = false;
  let controller: AbortController | null = null;
  let requestTimeout: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  function cancelOwnedRead() {
    const timeout = requestTimeout; requestTimeout = null;
    try { if (timeout !== null) controls.clearTimeout(timeout); } catch { /* Abort still has its own attempt. */ }
    try { controller?.abort(); } catch { /* The stopped owner denies late results. */ }
  }
  function retire() {
    const interval = timer; timer = null;
    try { if (interval !== null) controls.clearInterval(interval); } catch { /* Retained callbacks cannot dispatch. */ }
    cancelOwnedRead();
  }
  function withhold(status: Verdict) {
    if (stopped) return;
    stopped = true;
    // Presentation cannot depend on a successful timer/listener cleanup.
    retire();
    try { changed(status); } catch { /* An observer cannot revive or retry the watch. */ }
  }
  async function check() {
    if (stopped || inFlight) return;
    try { if (!controls.visible()) return; } catch { withhold(unavailable()); return; }
    inFlight = true;
    let current: AbortController | null = null;
    const now = controls.now ?? (() => performance.now());
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      current = new AbortController(); controller = current;
      const began = now();
      if (!Number.isFinite(began)) { withhold(unavailable()); return; }
      timeout = controls.timeout(() => withhold(unavailable()), 3_000);
      requestTimeout = timeout;
      const verdict = await verify(current.signal);
      if (stopped || current.signal.aborted) return;
      const elapsed = now() - began;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 3_000) { withhold(unavailable()); return; }
      if (verdict.kind !== "current") withhold(verdict);
    } catch { withhold(unavailable()); }
    finally {
      if (requestTimeout === timeout) {
        requestTimeout = null;
        try { if (timeout !== null) controls.clearTimeout(timeout); } catch { withhold(unavailable()); }
      }
      inFlight = false;
      if (controller === current) controller = null;
    }
  }
  try { timer = controls.interval(() => { void check(); }, 15_000); }
  catch { withhold(unavailable()); }
  void check();
  return { check, stop: () => { stopped = true; retire(); } };
}
