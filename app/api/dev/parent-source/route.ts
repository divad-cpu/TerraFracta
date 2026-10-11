import { handleCurrentParentSourceObservation } from "../../../../src/server/current-parent-source";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return handleCurrentParentSourceObservation(request, process.env.NODE_ENV);
}
