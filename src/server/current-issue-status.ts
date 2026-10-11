import { currentIssueStatusPayload } from "../current-issue-status.ts";
import { publicIssueProjectionSchema } from "../public-issue-projection.ts";
import { canonicalPublicIssueRoute, readPublicIssue, type PublicIssueReader, type PublicIssueRouteContext } from "./public-issue-reader.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const failure = (status: number) => Response.json({ schemaVersion: 1, kind: "unavailable" }, { status, headers });
export function createCurrentIssueStatusHandler(read: PublicIssueReader = readPublicIssue,
  record: DevelopmentErrorRecorder = recordDevelopmentError) {
  return async (request: Request, context: PublicIssueRouteContext, environment: string | undefined): Promise<Response> => {
    if (environment !== "development") return failure(404);
    try {
      if (request.method !== "GET") return failure(405);
      if (!hasLocalDevelopmentOrigin(request, false) || new URL(request.url).hash) return failure(403);
      if (request.signal.aborted) return failure(503);
      const params = await context.params;
      if (Object.keys(params).sort().join(",") !== "country,issue") return failure(404);
      const route = canonicalPublicIssueRoute({ jurisdictionSlug: params.country, issueSlug: params.issue });
      if (!route || new URL(request.url).pathname !== `/api/dev/current-issue-status/${route.jurisdictionSlug}/${route.issueSlug}`) return failure(404);
      if (request.signal.aborted) return failure(503);
      const decision = await read(route, request.signal);
      if (request.signal.aborted) return failure(503);
      if (decision.status === 404) return Response.json(currentIssueStatusPayload(decision), { headers });
      if (decision.status !== 200) return failure(503);
      const issue = publicIssueProjectionSchema.parse(decision.issue);
      if (issue.jurisdictionSlug !== route.jurisdictionSlug || issue.issueSlug !== route.issueSlug) return failure(503);
      return Response.json(currentIssueStatusPayload({ ...decision, issue }), { headers });
    } catch {
      if (!request.signal.aborted) observeDevelopmentError("public_issue_read", record);
      return failure(503);
    }
  };
}
export const handleCurrentIssueStatus = createCurrentIssueStatusHandler();
