import type { PublicReadOutcome } from "./public-read-outcome.ts";
import { contactFreeCorrectionPolicy } from "./contact-free-correction-policy.ts";
import { checkCorrectionRequest, type CorrectionRequest } from "./correction-request.ts";

// Invented native Request preparation only. No endpoint, write, receipt, address
// identity, attempt accounting or shared-host concurrency is installed here.
const observationMs = 2_000;
const nativeByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
)!.get!;
type PreparedBody = { kind: "prepared"; bodyBytes: number; request: CorrectionRequest };
type BodyOutcome = PreparedBody | { kind: "held" };
const held = (): BodyOutcome => ({ kind: "held" });

export function createInventedContactFreeBodyReader(
  context: "fresh_invented_trial", now: () => number = () => performance.now(),
) {
  let blocked = context !== "fresh_invented_trial", lastClock = -Infinity, observingClock = false;
  const owned = new Set<() => void>();
  function clock(): number {
    if (blocked || observingClock) throw Error("Trial clock context held");
    observingClock = true;
    try {
      const value = now();
      // The supplied clock can synchronously invalidate/reenter this trial.
      if (blocked || !Number.isFinite(value) || value < 0 || value < lastClock) throw Error("Trial clock held");
      lastClock = value;
      return value;
    } finally { observingClock = false; }
  }
  function loseContext() {
    blocked = true;
    for (const stop of owned) stop();
  }

  async function prepare(request: Request, current: () => PublicReadOutcome): Promise<BodyOutcome> {
    if (blocked || owned.size >= contactFreeCorrectionPolicy.concurrentAdmissions) return held();
    let start = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attached = false, retired = false, stopped = false, size = 0;
    let cancellation: Promise<void> | undefined;
    const chunks: Uint8Array[] = [];
    let deliver!: (outcome: BodyOutcome) => void;
    const observed = new Promise<BodyOutcome>(resolve => { deliver = resolve; });
    function wipe() { for (const chunk of chunks) chunk.fill(0); chunks.length = 0; }
    function stop() {
      if (retired || stopped) return;
      stopped = true;
      wipe();
      deliver(held());
      if (reader !== undefined) {
        try {
          cancellation = Promise.resolve(reader.cancel()).then(() => {}, () => { loseContext(); });
        } catch { loseContext(); }
      }
    }
    function live() {
      try {
        const initialAbort = request.signal.aborted;
        if (stopped || blocked || initialAbort) { stop(); return false; }
        const elapsed = clock() - start;
        const finalAbort = request.signal.aborted;
        // Native-object access may itself synchronously invalidate this owner.
        if (stopped || blocked || finalAbort || elapsed >= observationMs) { stop(); return false; }
        return true;
      } catch { loseContext(); stop(); return false; }
    }
    // Reserve ownership before any supplied clock/native-object callback.
    owned.add(stop);
    try {
      start = clock();
      if (!(request instanceof Request) || request.method !== "POST" || request.signal.aborted ||
          request.body === null || request.bodyUsed || request.body.locked ||
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) { stop(); cleanup(); return observed; }
      const declared = request.headers.get("content-length");
      if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) ||
          !Number.isSafeInteger(Number(declared)) || Number(declared) > contactFreeCorrectionPolicy.bodyBytes)) { stop(); cleanup(); return observed; }
    } catch { loseContext(); stop(); cleanup(); return observed; }

    try {
      attached = true;
      request.signal.addEventListener("abort", stop, { once: true });
      timer = setTimeout(stop, observationMs);
      // A parent cancellation during setup must never dispatch a physical read.
      if (!live()) throw Error("Trial setup held");
      reader = request.body!.getReader();
    } catch {
      loseContext();
      stop();
      // Setup failures have no pending read, but cleanup still owns its slot.
      cleanup();
      return observed;
    }

    function cleanup() {
      retired = true;
      wipe();
      let clean = true;
      try { if (timer !== undefined) clearTimeout(timer); } catch { clean = false; }
      try { if (attached) request.signal.removeEventListener("abort", stop); } catch { clean = false; }
      try { reader?.releaseLock(); } catch { clean = false; }
      if (!clean) loseContext();
      owned.delete(stop);
      return clean;
    }
    // The observer can finish while physical read/cancel remains unsettled. Only
    // physical settlement plus cleanup releases the owned slot, never a deadline.
    void (async () => {
      let prepared: PreparedBody | undefined;
      try {
        while (live()) {
          const chunk = await reader!.read();
          if (!live()) break;
          if (chunk.done) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
            let result: BodyOutcome = held();
            try {
              const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
              const packet: unknown = JSON.parse(text);
              if (JSON.stringify(packet) === text && live()) {
                const checked = checkCorrectionRequest(current(), packet);
                if (checked.kind === "prepared" && live()) result = { kind: "prepared", bodyBytes: size, request: checked.request };
              }
            } finally { bytes.fill(0); }
            if (result.kind === "prepared") prepared = result; else stop();
            break;
          }
          const value = chunk.value;
          // A native-result getter can retire this owner before copying.
          if (!live()) break;
          if (!(value instanceof Uint8Array)) { stop(); break; }
          // Read the intrinsic buffer length, not a producer-shadowed property.
          const byteLength: number = Reflect.apply(nativeByteLength, value, []);
          if (byteLength === 0 || byteLength > contactFreeCorrectionPolicy.bodyBytes - size) { stop(); break; }
          // Producer-owned arrays are copied before the next asynchronous read.
          const copy = new Uint8Array(value);
          // Retire a newly owned copy even if construction lost this context.
          if (!live() || copy.byteLength !== byteLength) { copy.fill(0); stop(); break; }
          size += copy.byteLength;
          chunks.push(copy);
        }
      } catch { stop(); }
      finally {
        // A cancel acknowledgement can hang independently of a settled read.
        // Keep this slot occupied until both physical operations have settled.
        if (cancellation !== undefined) await cancellation;
        const clean = cleanup();
        // Cleanup failure or elapsed/cancelled observation cannot expose payload.
        if (prepared !== undefined && clean && live()) deliver(prepared);
        else deliver(held());
      }
    })();
    return observed;
  }
  return Object.freeze({ prepare, loseContext,
    inspection: () => Object.freeze({ activeReads: owned.size, held: blocked }) });
}
