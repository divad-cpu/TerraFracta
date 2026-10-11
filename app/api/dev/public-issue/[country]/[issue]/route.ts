import { handleDevelopmentPublicIssueRead, type PublicIssueRouteContext } from "../../../../../../src/server/public-issue-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: PublicIssueRouteContext) {
  return handleDevelopmentPublicIssueRead(request, context, process.env.NODE_ENV);
}
