import { buildDiagnosticReport, type DiagnosticReport } from "../diagnostic-report.ts";
import { ErrorLogStore } from "./error-log-store.ts";
import { developmentErrorLogDirectory } from "./error-diagnostics.ts";
import { performance } from "node:perf_hooks";

export type DiagnosticRead = { kind: "available"; report: DiagnosticReport } | { kind: "disabled" | "busy" | "unavailable" };
export function createDevelopmentDiagnosticReader(inspect: () => Promise<unknown>,
  environment = () => process.env.NODE_ENV, now = () => new Date(), elapsedNow = () => performance.now()) {
  let active = false;
  return async (): Promise<DiagnosticRead> => {
    if (environment() !== "development") return { kind: "disabled" };
    if (active) return { kind: "busy" };
    let began: number;
    try { began = elapsedNow(); } catch { return { kind: "unavailable" }; }
    if (!Number.isFinite(began)) return { kind: "unavailable" };
    active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expire = () => {};
    const timeout = new Promise<DiagnosticRead>(resolve => { expire = () => resolve({ kind: "unavailable" }); });
    // Install the caller's ceiling before dispatching any archive inspection.
    // A setup failure owns no physical work and must release its unused slot.
    try { timer = setTimeout(expire, 1_500); }
    catch { active = false; return { kind: "unavailable" }; }
    const work = Promise.resolve().then(inspect).then((value): DiagnosticRead => {
      const report = buildDiagnosticReport(value, now()), elapsed = elapsedNow() - began;
      return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1_500 ? { kind: "available", report } : { kind: "unavailable" };
    })
      .catch((): DiagnosticRead => ({ kind: "unavailable" }))
      .finally(() => { active = false; });
    // An unfinished disk read retains its slot after the caller's deadline.
    // No stale report, background retry, queue, or recursive logging.
    try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
  };
}
export const readDevelopmentDiagnostics = createDevelopmentDiagnosticReader(async () => {
  try { return await new ErrorLogStore(developmentErrorLogDirectory()).inspect(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
});
