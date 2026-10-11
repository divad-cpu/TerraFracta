import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { readDevelopmentDiagnostics, type DiagnosticRead } from "./diagnostic-reader.ts";
import { performance } from "node:perf_hooks";
import { parseDiagnosticReport } from "../diagnostic-report.ts";

const privateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; sandbox" };
const refusal = (status: number) => new Response(null, { status, headers: privateHeaders });
export function createDiagnosticDownload(read: () => Promise<DiagnosticRead> = readDevelopmentDiagnostics, now = () => performance.now()) {
  let windowStart = -Infinity, count = 0, active = false;
  return async (request: Request, environment: string | undefined): Promise<Response> => {
    if (environment !== "development") return refusal(404);
    try {
      if (request.method !== "GET") return refusal(405);
      if (!hasLocalDevelopmentOrigin(request, false)) return refusal(403);
      if (request.signal.aborted) return refusal(400);
      const time = now();
      if (!Number.isFinite(time) || time < windowStart) return refusal(503);
      if (time - windowStart >= 60_000) { windowStart = time; count = 0; }
      if (active || count >= 30) return refusal(429);
      count++; active = true;
      try {
        const result = await read();
        if (request.signal.aborted) return refusal(400);
        if (result.kind !== "available") return refusal(result.kind === "busy" ? 429 : 503);
        return Response.json(parseDiagnosticReport(result.report), { headers: { ...privateHeaders, "content-disposition": 'attachment; filename="terrafracta-errors.json"' } });
      } finally { active = false; }
    } catch { return refusal(503); }
  };
}
