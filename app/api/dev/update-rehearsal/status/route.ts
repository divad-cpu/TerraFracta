import { handleWeeklyRehearsalStatus } from "../../../../../src/server/weekly-rehearsal-status";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return handleWeeklyRehearsalStatus(request, process.env.NODE_ENV);
}
