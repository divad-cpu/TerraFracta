type ReadResult<T> = { kind: "observed"; value: T } | { kind: "failed" };
type Observation<T> = { result: Promise<ReadResult<T>>; reported: boolean };

// One bounded read belongs to the inspector, not to an individual caller.
// This helper neither starts jobs nor cancels a shared child on caller abort.
export function createSharedReadObservation<T>(inspect: () => Promise<unknown>,
  parse: (input: unknown) => T, onFailure: () => void) {
  let pending: Observation<T> | undefined;
  return async function observe(signal: AbortSignal): Promise<ReadResult<T> | { kind: "cancelled" }> {
    if (signal.aborted) return { kind: "cancelled" };
    let current: Observation<T> | undefined;
    let retired = false, callerCancelled = false, reported = false;
    let cancel: () => void = () => {};
    const cancelled = new Promise<null>(resolve => { cancel = () => { if (!retired) resolve(null); }; });
    const cancelResult = () => { callerCancelled = true; return { kind: "cancelled" as const }; };
    const reportFailure = () => {
      if (callerCancelled || signal.aborted || reported || current?.reported) return;
      reported = true;
      if (current) current.reported = true;
      try { onFailure(); } catch { /* Logging cannot change the read outcome. */ }
    };
    try {
      // Complete caller setup before dispatch. An attached-then-throwing
      // listener is retired by the same finally path as a completed read.
      try { signal.addEventListener("abort", cancel, { once: true }); }
      catch {
        if (signal.aborted) return cancelResult();
        reportFailure();
        return { kind: "failed" };
      }
      if (signal.aborted) return cancelResult();
      if (!pending) {
        const flight: Observation<T> = { reported: false,
          result: Promise.resolve().then(inspect).then(parse)
            .then(value => ({ kind: "observed" as const, value }))
            .catch(() => ({ kind: "failed" as const })) };
        pending = flight;
        // Keep ownership when all consumers leave; release only on settlement.
        void flight.result.then(() => { if (pending === flight) pending = undefined; });
      }
      current = pending;
      const result = await Promise.race([current.result, cancelled]);
      if (result === null || signal.aborted) return cancelResult();
      // A fault needs a still-active consumer; report once per shared read.
      if (result.kind === "failed") reportFailure();
      return result;
    } finally {
      retired = true;
      try { signal.removeEventListener("abort", cancel); }
      catch { reportFailure(); }
    }
  };
}
