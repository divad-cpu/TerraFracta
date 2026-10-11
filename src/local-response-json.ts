import { copyNativeByteChunk } from "./native-byte-chunk.ts";

// Fixed local development contracts, derived from existing receipt/page/worker
// limits. Callers select constants in code; no browser-supplied budget is used.
export const localResponseBytes = Object.freeze({
  status: 1_024, refusal: 1_024, update: 64 * 1_024,
  history: 8 * 64 * 1_024 + 1_024, custodian: 16 * 1_024, observation: 16 * 1_024,
});
const unavailable = () => new Error("Local response unavailable");

export function discardLocalResponse(response: Response): void {
  // Never cancel a reader owned by another caller; failed acknowledgement is
  // independent of refusal and is not exposed in diagnostics.
  try { if (response.body && !response.body.locked) void response.body.cancel().catch(() => {}); }
  catch { /* No owned reader. */ }
}

// Reuses the existing status reader's native stream/cancellation boundary.
// Limits apply to delivered decoded bytes, not compressed network traffic.
export async function readLocalResponseJson(response: Response, signal: AbortSignal, bytesLimit: number): Promise<unknown> {
  if (!Number.isSafeInteger(bytesLimit) || bytesLimit < 1 || bytesLimit > localResponseBytes.history || signal.aborted) {
    discardLocalResponse(response); throw unavailable();
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancellationStarted = false;
  const cancel = () => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    // Refusal does not depend on the producer acknowledging cancellation.
    if (!reader) { discardLocalResponse(response); return; }
    try { void reader.cancel().catch(() => {}); } catch { /* Independent release. */ }
  };
  try {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > bytesLimit)) throw unavailable();
    if (!response.body) throw unavailable();
    reader = response.body.getReader();
    const bytes = new Uint8Array(bytesLimit); let size = 0;
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) throw unavailable();
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw unavailable();
      if (done) break;
      // Charge/copy intrinsic native bytes before another read. Producer
      // properties cannot hide a tail or substitute the delivered payload.
      size += copyNativeByteChunk(bytes, size, value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } catch {
    throw unavailable();
  } finally {
    try { signal.removeEventListener("abort", cancel); } catch { /* Independent cleanup. */ }
    cancel();
    try { reader?.releaseLock(); } catch { /* Pending cancellation still owns the read. */ }
  }
}
