import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { interpretPublicReadCandidate } from "../public-read-outcome.ts";
import { decidePublicReadResponse, type PublicReadResponseDecision } from "../public-read-response.ts";
import { publicIssueProjectionSchema } from "../public-issue-projection.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

export type PublicIssueRoute = Readonly<{ jurisdictionSlug: string; issueSlug: string }>;
// The selected custodian must supply one current, consistent SQL JSONB candidate.
// This callback receives no client SQL, path, role, URL or credential selector.
// Its transport/rights/abort behavior still needs selected-deployment acceptance.
export type CurrentIssueCandidateReader = (route: PublicIssueRoute, signal: AbortSignal) => Promise<Uint8Array>;
export type PublicIssueReader = (route: unknown, signal?: AbortSignal) => Promise<PublicReadResponseDecision>;
export const PUBLIC_CANDIDATE_BYTES = 1_310_720; // Existing bounded SQL candidate limit.
export const DEVELOPMENT_READ_TIMEOUT_MS = 3_000; // Development ceiling, not a live service-level decision.
const held = (): PublicReadResponseDecision => ({ status: 503, cacheControl: "no-store" });

export function canonicalPublicIssueRoute(value: unknown): PublicIssueRoute | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const route = value as Record<string, unknown>;
  const keys = Object.keys(route).sort();
  if (keys.length !== 2 || keys[0] !== "issueSlug" || keys[1] !== "jurisdictionSlug") return null;
  // Validate and return one observation; caller getters cannot replace checked scope.
  const jurisdictionSlug = route.jurisdictionSlug;
  if (typeof jurisdictionSlug !== "string") return null;
  const issueSlug = route.issueSlug;
  if (typeof issueSlug !== "string" || jurisdictionSlug.length > 80 || issueSlug.length > 100 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(jurisdictionSlug) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(issueSlug)) return null;
  return Object.freeze({ jurisdictionSlug, issueSlug });
}

export function createPublicIssueReader(
  provider?: CurrentIssueCandidateReader,
  now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError,
): PublicIssueReader {
  return async (input, parentSignal) => {
    const route = canonicalPublicIssueRoute(input);
    if (route === null) return { status: 404, cacheControl: "no-store" };
    if (provider === undefined || parentSignal?.aborted) return held();
    let reported = false;
    const reportFailure = () => {
      if (!parentSignal?.aborted && !reported) {
        reported = true;
        observeDevelopmentError("public_issue_read", record);
      }
    };
    const failed = (): PublicReadResponseDecision => {
      reportFailure();
      return held();
    };
    const controller = new AbortController();
    let retired = false, cancellationObserved = false;
    const cancel = () => {
      if (retired || cancellationObserved) return;
      cancellationObserved = true;
      rejectCancelled?.();
      try { controller.abort(); } catch { /* Observation ends even if physical abort refuses. */ }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled: (() => void) | undefined;
    let began: number;
    try { began = now(); } catch { return failed(); }
    if (!Number.isFinite(began)) return failed();
    const elapsedRead = createElapsedReadClock(now, began);
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(new Error("read_unavailable"));
    });
    void cancelled.catch(() => {});
    const onAbort = () => {
      if (retired) return;
      cancellationObserved = true;
      rejectCancelled?.();
    };
    try {
      controller.signal.addEventListener("abort", onAbort, { once: true });
      parentSignal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(cancel, DEVELOPMENT_READ_TIMEOUT_MS);
      // One fresh call per request; no completed/pending candidate cache.
      const raw = await Promise.race([Promise.resolve().then(() => {
        if (cancellationObserved || controller.signal.aborted || parentSignal?.aborted) throw new Error("read_unavailable");
        return provider(route, controller.signal);
      }), cancelled]);
      const elapsed = elapsedRead();
      if (cancellationObserved || controller.signal.aborted || parentSignal?.aborted || !Number.isFinite(elapsed) ||
          elapsed < 0 || elapsed >= DEVELOPMENT_READ_TIMEOUT_MS) return failed();
      // Copy actual native bytes into this reader's existing fixed budget.
      // A producer-owned property must not change admission or interpretation.
      const bytes = new Uint8Array(PUBLIC_CANDIDATE_BYTES);
      const size = copyNativeByteChunk(bytes, 0, raw);
      if (size < 4) return failed();
      // Provider JSON originates in the fixed JSONB read, never the HTTP body.
      const candidate: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
      const outcome = interpretPublicReadCandidate(candidate);
      if (outcome.kind === "issue") {
        const requested = (candidate as { requestedRoute?: PublicIssueRoute }).requestedRoute;
        if (requested?.jurisdictionSlug !== route.jurisdictionSlug || requested?.issueSlug !== route.issueSlug ||
            outcome.issue.jurisdictionSlug !== route.jurisdictionSlug || outcome.issue.issueSlug !== route.issueSlug) return failed();
      }
      const after = elapsedRead();
      if (cancellationObserved || controller.signal.aborted || parentSignal?.aborted || !Number.isFinite(after) ||
          after < 0 || after >= DEVELOPMENT_READ_TIMEOUT_MS) return failed();
      // Rejected candidates include expected rights/editorial/head holds;
      // that private outcome alone cannot establish a technical fault.
      return decidePublicReadResponse(outcome);
    } catch {
      // Provider/candidate failures never disclose errors, private rows or paths.
      return failed();
    } finally {
      retired = true;
      // A failed retirement cannot replace the checked decision or prevent the
      // other resources from retiring. No exception details cross this reader.
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort", cancel); } catch { reportFailure(); }
      try { controller.signal.removeEventListener("abort", onAbort); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
  };
}

// Intentionally unconfigured. No environment switch, fixture, file or owner
// SQL bridge silently becomes a production/current-rights provider.
export const readPublicIssue = createPublicIssueReader();
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", allow: "GET" };
export type PublicIssueRouteContext = { params: Promise<{ country: string; issue: string }> };

export function createDevelopmentPublicIssueHandler(read: PublicIssueReader = readPublicIssue,
  record: DevelopmentErrorRecorder = recordDevelopmentError) {
  return async (request: Request, context: PublicIssueRouteContext, environment: string | undefined): Promise<Response> => {
    const fail = (status: number, error: string) => Response.json({ error }, { status, headers });
    if (environment !== "development") return fail(404, "not_found");
    if (request.method !== "GET") return fail(405, "method_not_allowed");
    if (!hasLocalDevelopmentOrigin(request, false) || new URL(request.url).hash) return fail(403, "local_origin_required");
    if (request.signal.aborted) return fail(503, "read_unavailable");
    try {
      const params = await context.params;
      if (Object.keys(params).sort().join(",") !== "country,issue") return fail(404, "not_found");
      const route = canonicalPublicIssueRoute({ jurisdictionSlug: params.country, issueSlug: params.issue });
      if (route === null || new URL(request.url).pathname !== `/api/dev/public-issue/${route.jurisdictionSlug}/${route.issueSlug}`) {
        return fail(404, "not_found");
      }
      const decision = await read(route, request.signal);
      if (request.signal.aborted || decision.status === 503) return fail(503, "read_unavailable");
      if (decision.status === 404) return fail(404, "not_found");
      if (decision.status !== 200) return fail(503, "read_unavailable");
      // The handler owns its exposure boundary even when a later server adapter
      // supplies the reader function. Recheck the closed projection and route.
      const issue = publicIssueProjectionSchema.parse(decision.issue);
      if (issue.jurisdictionSlug !== route.jurisdictionSlug || issue.issueSlug !== route.issueSlug) {
        return fail(503, "read_unavailable");
      }
      return Response.json({ issue }, { status: 200, headers });
    } catch {
      if (!request.signal.aborted) observeDevelopmentError("public_issue_read", record);
      return fail(503, "read_unavailable");
    }
  };
}
export const handleDevelopmentPublicIssueRead = createDevelopmentPublicIssueHandler();
