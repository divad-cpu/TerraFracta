// The caller retires presentation separately and retains its physical file-read
// slot until settlement. An abort failure cannot interrupt that bookkeeping.
export function cancelLocalFileRead(controller: AbortController | null): void {
  try { controller?.abort(); } catch { /* Continue the owned presentation cleanup. */ }
}
