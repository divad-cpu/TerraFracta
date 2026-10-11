import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { makeDiagnosticEvent, diagnosticCodes, type DiagnosticCode, type DiagnosticEvent } from "../error-diagnostics.ts";
import { ErrorLogStore, type DiagnosticWrite } from "./error-log-store.ts";

// Fixed development location. Production logging is intentionally not enabled
// by an environment variable or browser request; bind the accepted NAS sink
// explicitly when installation is separately authorized.
export const developmentErrorLogDirectory = () => join(process.cwd(), ".local-error-log");
export function createDevelopmentErrorRecorder(save: (event: DiagnosticEvent) => Promise<DiagnosticWrite>,
  environment: () => string | undefined = () => process.env.NODE_ENV, now = () => performance.now()) {
  let active = false;
  return async (code: DiagnosticCode, eventId: string = randomUUID()): Promise<DiagnosticWrite> => {
    if (environment() !== "development") return "unavailable";
    if (active) return "busy";
    let began: number;
    try { began = now(); } catch { return "unavailable"; }
    if (!Number.isFinite(began)) return "unavailable";
    let event;
    try { event = makeDiagnosticEvent(code, eventId); } catch { return "invalid"; }
    active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expire = () => {};
    const deadline = new Promise<DiagnosticWrite>(resolve => { expire = () => resolve("unavailable"); });
    // Install the deadline before dispatching storage. Failed setup has no
    // physical work to retain, so the unused slot can be released.
    try { timer = setTimeout(expire, 1_000); }
    catch { active = false; return "unavailable"; }
    const work = Promise.resolve().then(() => save(event)).then((result): DiagnosticWrite => {
      const elapsed = now() - began;
      return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1_000 ? result : "unavailable";
    }).catch((): DiagnosticWrite => "unavailable")
      .finally(() => { active = false; });
    // The caller stops waiting; unfinished filesystem work still owns the slot.
    // Never start an expanding queue behind an unresponsive disk.
    try { return await Promise.race([work, deadline]); }
    finally {
      // Retirement failure cannot change the saved acknowledgement or create
      // another event. Physical storage retains its own slot until settlement.
      try { clearTimeout(timer); } catch { /* Best-effort timer retirement. */ }
    }
  };
}
export const recordDevelopmentError = createDevelopmentErrorRecorder(event =>
  new ErrorLogStore(developmentErrorLogDirectory()).append(event));
export type DevelopmentErrorRecorder = (code: DiagnosticCode) => Promise<DiagnosticWrite>;
// Fixed technical location only. Never await logging on an operation's failure
// path, or turn logger failure into another diagnostic event.
export function observeDevelopmentError(code: DiagnosticCode, record: DevelopmentErrorRecorder = recordDevelopmentError): void {
  void Promise.resolve().then(() => record(code)).catch(() => {});
}
export function serverErrorCode(routeType: string): DiagnosticCode {
  return routeType === "action" ? "server_action" : routeType === "route" ? "server_route" : "server_render";
}
export async function recordServerError(routeType: string) {
  const code = serverErrorCode(routeType);
  if (diagnosticCodes[code].origin === "server") await recordDevelopmentError(code);
}
