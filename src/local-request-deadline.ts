// Cancel only this caller's request. Never retry an operation or infer its
// server outcome from a missing response. Browser suspension is not a clock seal.
export async function withLocalRequestDeadline<T>(signal: AbortSignal, milliseconds: number,
  request: (signal: AbortSignal) => Promise<T>, now = () => performance.now(), onDeadline?: () => void): Promise<T> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647) throw new Error("Invalid local request deadline");
  const began = now();
  if (!Number.isFinite(began)) throw new Error("Local request unavailable");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retired = false;
  try {
    // Setup belongs to the same cleanup boundary as the request. A failed
    // deadline must not dispatch work or leave a parent subscription behind.
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) controller.abort();
    timer = setTimeout(() => {
      if (retired || signal.aborted) return;
      cancel();
      // Presentation only: ownership remains with the awaited request until it
      // actually settles. An observer cannot replace the request's outcome.
      try { onDeadline?.(); } catch { /* A failed notice cannot release the request. */ }
    }, milliseconds);
    if (controller.signal.aborted) throw new Error("Local request cancelled");
    const result = await request(controller.signal);
    const finished = now();
    const elapsed = Number.isFinite(finished) ? finished - began : NaN;
    if (controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= milliseconds) throw new Error("Local request cancelled");
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
