import { handleFictionalHistoryPageRequest } from "../../../../../../src/server/fictional-receipt-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleFictionalHistoryPageRequest(request, process.env.NODE_ENV);
}
