// Cancel only this caller's request. Never retry an operation or infer its
// server outcome from a missing response. Browser suspension is not a clock seal.
export async function withLocalRequestDeadline<T>(signal: AbortSignal, milliseconds: number,
  request: (signal: AbortSignal) => Promise<T>, now = () => performance.now(), onDeadline?: () => void): Promise<T> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647) throw new Error("Invalid local request deadline");
  const began = now();
  if (!Number.isFinite(began)) throw new Error("Local request unavailable");
  const controller = new AbortController();
  let retired = false, cancellationObserved = false;
  const cancel = () => {
    if (retired) return;
    cancellationObserved = true;
    // A failed physical abort cannot reopen a cancelled presentation or escape
    // its callback. The awaited request still owns the slot until settlement.
    try { controller.abort(); } catch { /* Cancellation remains observed. */ }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Setup belongs to the same cleanup boundary as the request. A failed
    // deadline must not dispatch work or leave a parent subscription behind.
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    timer = setTimeout(() => {
      if (retired || signal.aborted) return;
      cancel();
      // Presentation only: ownership remains with the awaited request until it
      // actually settles. An observer cannot replace the request's outcome.
      try { onDeadline?.(); } catch { /* A failed notice cannot release the request. */ }
    }, milliseconds);
    if (cancellationObserved || controller.signal.aborted) throw new Error("Local request cancelled");
    const result = await request(controller.signal);
    const finished = now();
    const elapsed = Number.isFinite(finished) ? finished - began : NaN;
    if (cancellationObserved || controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= milliseconds) throw new Error("Local request cancelled");
    return result;
  } finally {
    retired = true;
    // Bookkeeping failures cannot replace the checked transport outcome or
    // prevent the remaining resources from retiring. Physical work is awaited.
    try { if (timer !== undefined) clearTimeout(timer); } catch { /* Independent cleanup. */ }
    try { signal.removeEventListener("abort", cancel); } catch { /* Independent cleanup. */ }
    try { controller.abort(); } catch { /* Retired deadlines cannot publish. */ }
  }
}
