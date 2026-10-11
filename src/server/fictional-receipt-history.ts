import { fictionalReceiptHistorySchema } from "../fictional-receipt-history.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { readRecentFictionalReceipts } from "./fictional-receipt-store.ts";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export async function handleFictionalHistoryRequest(
  request: Request, environment: string | undefined,
  read = readRecentFictionalReceipts,
): Promise<Response> {
  const fail = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (environment !== "development") return fail(404, "not_found");
  if (request.method !== "GET") return fail(405, "method_not_allowed");
  if (!hasLocalDevelopmentOrigin(request, false)) return fail(403, "local_origin_required");
  try {
    const inventory = await read();
    return Response.json(fictionalReceiptHistorySchema.parse({
      archiveKind: "local_fictional_receipts", capacity: 100, ...inventory,
    }), { headers });
  } catch { return fail(503, "fictional_history_unavailable"); }
}
