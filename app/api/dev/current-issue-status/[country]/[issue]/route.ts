import { handleCurrentIssueStatus } from "../../../../../../src/server/current-issue-status.ts";
import type { PublicIssueRouteContext } from "../../../../../../src/server/public-issue-reader.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request, context: PublicIssueRouteContext) => handleCurrentIssueStatus(request, context, process.env.NODE_ENV);
