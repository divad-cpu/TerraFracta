import { handleFictionalHistoryRequest } from "../../../../../src/server/fictional-receipt-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleFictionalHistoryRequest(request, process.env.NODE_ENV);
}
