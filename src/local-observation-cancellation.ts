// The view retires its observation separately. A failed physical abort cannot
// interrupt cleanup or release the awaited response's slot before settlement.
export function cancelLocalObservationRead(controller: AbortController | null): void {
  try { controller?.abort(); } catch { /* Continue the owned observation cleanup. */ }
}
