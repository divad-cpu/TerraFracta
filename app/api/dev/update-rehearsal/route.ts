import { handleFictionalUpdateRequest } from "../../../../src/server/fictional-update-operation";
import { persistFictionalReceipt } from "../../../../src/server/fictional-receipt-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleFictionalUpdateRequest(request, process.env.NODE_ENV, undefined, persistFictionalReceipt);
}
