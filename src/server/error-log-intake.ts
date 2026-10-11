import { performance } from "node:perf_hooks";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { diagnosticIntentSchema, diagnosticCodes } from "../error-diagnostics.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { recordDevelopmentError } from "./error-diagnostics.ts";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (status: number) => new Response(null, { status, headers });
async function boundedIntent(request: Request, expired: () => boolean): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 256)) return null;
  if (!request.body || expired()) return null;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire = () => {};
  const deadline = new Promise<null>(resolve => { expire = () => resolve(null); });
  let abortRead: () => void = () => {};
  let subscriptionAttempted = false;
  const cancellation = new Promise<null>(resolve => { abortRead = () => resolve(null); });
  const read = async () => {
    let size = 0;
    const bytes = new Uint8Array(256);
    while (true) {
      const { done, value } = await reader.read();
      if (expired()) return null;
      if (done) break;
      size += copyNativeByteChunk(bytes, size, value);
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    // Two exact fields, no duplicates, escaped aliases, message or payload.
    if (!/^\s*\{\s*"eventId"\s*:\s*"[0-9a-f-]{36}"\s*,\s*"code"\s*:\s*"[a-z_]{1,32}"\s*\}\s*$/.test(raw)) return null;
    const intent = JSON.parse(raw);
    return expired() ? null : intent;
  };
  try {
    // Establish both controls before dispatching a read. Cleanup also covers
    // failed timer creation or a partially installed parent subscription.
    timer = setTimeout(expire, 1_000);
    subscriptionAttempted = true;
    request.signal.addEventListener("abort", abortRead, { once: true });
    if (request.signal.aborted) abortRead();
    return await Promise.race([read().catch(() => null), deadline, cancellation]);
  }
  finally {
    // Each owned resource has its own retirement attempt. Cleanup cannot
    // replace the validated intent/refusal or prevent the remaining cleanup.
    try { if (subscriptionAttempted) request.signal.removeEventListener("abort", abortRead); } catch { /* Attempt timer/body retirement independently. */ }
    try { if (timer !== undefined) clearTimeout(timer); } catch { /* Attempt body retirement independently. */ }
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Lock release still has its own attempt. */ }
    try { reader.releaseLock(); } catch { /* A refused native cancellation cannot guarantee release. */ }
  }
}

export function createDiagnosticIntake(save = recordDevelopmentError, now = () => performance.now()) {
  let start = -Infinity, count = 0, active = false;
  return async (request: Request, environment: string | undefined): Promise<Response> => {
    // Production refusal precedes observing any request or calling the sink.
    if (environment !== "development") return reply(404);
    if (request.method !== "POST") return reply(405);
    if (!hasLocalDevelopmentOrigin(request)) return reply(403);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return reply(415);
    let time: number;
    try { time = now(); } catch { return reply(503); }
    if (!Number.isFinite(time)) return reply(503);
    if (time - start >= 60_000) { start = time; count = 0; }
    if (active || count >= 60) return reply(429);
    count++; active = true;
    const elapsedRead = createElapsedReadClock(now, time);
    const expired = () => {
      const elapsed = elapsedRead();
      return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 1_000;
    };
    try {
      const parsed = diagnosticIntentSchema.safeParse(await boundedIntent(request, expired));
      // Elapsed checks also cover a delayed timer and post-read validation.
      if (expired() || request.signal.aborted || !parsed.success || diagnosticCodes[parsed.data.code].origin !== "browser") return reply(400);
      return reply(await save(parsed.data.code, parsed.data.eventId) === "saved" ? 204 : 503);
    } catch { return reply(503); }
    finally { active = false; }
  };
}
